import { AdapterFailure } from "./adapter-execution-coordinator.ts";
import type {
  AdapterCleanupRecoveryEvidence,
  AdapterFailureKind,
} from "./types.ts";

export interface AdapterSubprocessInvocation {
  readonly implementationIdentity: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly input: string;
  readonly signal: AbortSignal;
  readonly providerCleanupMs: number;
  readonly onStdoutChunk?: (chunk: string) => void;
}

export interface AdapterSubprocessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

// @sigil implements packages/compiler/src/adapter-subprocess.sigil::SigilAgentAdapterSubprocess::AgentAdapterSubprocess interface,logic,constraints,cases
export async function runAdapterSubprocess(
  invocation: AdapterSubprocessInvocation,
): Promise<AdapterSubprocessResult> {
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(invocation.command, {
      args: [...invocation.args],
      cwd: invocation.cwd,
      env: invocation.env ? { ...invocation.env } : undefined,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (error) {
    throw new AdapterFailure(
      "execution",
      `Could not start ${invocation.command}.`,
      undefined,
      { cause: error },
    );
  }

  const resourceIdentity = `process:${child.pid}`;
  const stdout = readOutput(child.stdout, invocation.onStdoutChunk);
  const stderr = new Response(child.stderr).text();
  const status = child.status;
  try {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(invocation.input));
    await writer.close();

    const settled = await Promise.race([
      status.then((value) => ({ kind: "status" as const, value })),
      abortResult(invocation.signal),
    ]);
    if (settled.kind === "abort") {
      const initiatingKind: AdapterFailureKind = failureKind(
        invocation.signal.reason,
      );
      const cleanup = await terminateAndVerify(
        child,
        status,
        invocation,
        resourceIdentity,
        initiatingKind,
      );
      if (cleanup.cleanupDeadlineOutcome !== "completed") {
        throw new AdapterFailure(
          "cleanup",
          "Provider subprocess cleanup could not be verified.",
          cleanup,
        );
      }
      throw new AdapterFailure(
        initiatingKind,
        initiatingKind === "cancelled"
          ? "Evaluation was cancelled."
          : "Evaluation elapsed-time budget expired.",
        cleanup,
      );
    }
    const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
    if (!settled.value.success) {
      throw new AdapterFailure(
        "execution",
        `${invocation.command} exited with ${settled.value.code}: ${stderrText.trim()}`,
      );
    }
    return { stdout: stdoutText, stderr: stderrText, code: settled.value.code };
  } catch (error) {
    if (error instanceof AdapterFailure) throw error;
    const cleanup = await terminateAndVerify(
      child,
      status,
      invocation,
      resourceIdentity,
      "execution",
    );
    if (cleanup.cleanupDeadlineOutcome !== "completed") {
      throw new AdapterFailure(
        "cleanup",
        "Provider subprocess cleanup could not be verified.",
        cleanup,
        { cause: error },
      );
    }
    throw new AdapterFailure(
      "execution",
      `Provider subprocess failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      undefined,
      { cause: error },
    );
  }
}

async function readOutput(
  stream: ReadableStream<Uint8Array>,
  onChunk: ((chunk: string) => void) | undefined,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let retained = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (onChunk) onChunk(text);
    else retained += text;
  }
  const tail = decoder.decode();
  if (tail) {
    if (onChunk) onChunk(tail);
    else retained += tail;
  }
  return retained;
}

function abortResult(signal: AbortSignal): Promise<{ readonly kind: "abort" }> {
  if (signal.aborted) return Promise.resolve({ kind: "abort" });
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ kind: "abort" }), {
      once: true,
    });
  });
}

async function terminateAndVerify(
  child: Deno.ChildProcess,
  status: Promise<Deno.CommandStatus>,
  invocation: AdapterSubprocessInvocation,
  resourceIdentity: string,
  initiatingKind: AdapterFailureKind,
): Promise<AdapterCleanupRecoveryEvidence> {
  const attempts: string[] = [];
  const observations: string[] = [];
  attempts.push("graceful:SIGTERM");
  try {
    child.kill("SIGTERM");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      observations.push(String(error));
    }
  }
  let settled = await within(status, invocation.providerCleanupMs);
  if (!settled) {
    attempts.push("forced:SIGKILL");
    try {
      child.kill("SIGKILL");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        observations.push(String(error));
      }
    }
    settled = await within(status, invocation.providerCleanupMs);
  }
  if (!settled) child.unref();
  return {
    implementationIdentity: invocation.implementationIdentity,
    resources: [{
      identity: resourceIdentity,
      latestState: settled ? "terminal" : "unknown",
    }],
    resultInputs: [
      { identity: "stdout", latestState: settled ? "cancelled" : "unknown" },
      { identity: "stderr", latestState: settled ? "cancelled" : "unknown" },
    ],
    initiatingTerminalKind: initiatingKind,
    observationFailures: observations,
    cleanupAttempts: attempts,
    cleanupDeadlineOutcome: settled ? "completed" : "expired",
    operatorRecoveryAction: settled
      ? "No operator action is required."
      : `Inspect and terminate provider process ${child.pid} before retrying.`,
  };
}

async function within<T>(promise: Promise<T>, ms: number): Promise<boolean> {
  const timeout = Symbol("timeout");
  const value = await Promise.race([
    promise,
    new Promise<typeof timeout>((resolve) =>
      setTimeout(() => resolve(timeout), ms)
    ),
  ]);
  return value !== timeout;
}

function failureKind(reason: unknown): "cancelled" | "elapsed-time" {
  return reason instanceof AdapterFailure && reason.kind === "elapsed-time"
    ? "elapsed-time"
    : "cancelled";
}
