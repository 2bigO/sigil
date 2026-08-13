import {
  type AdapterExecutionHandle,
  type AdapterExecutionResources,
  AdapterFailure,
} from "./adapter-execution-coordinator.ts";
import type { AdapterFailureKind } from "./types.ts";

export interface AdapterSubprocessInvocation {
  readonly implementationIdentity: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly input: string;
  readonly signal: AbortSignal;
  /** Retained only for direct test timing compatibility; cleanup is coordinator-owned. */
  readonly providerCleanupMs?: number;
  readonly maxInitialRequestChars: number;
  readonly maxProviderFrameChars: number;
  readonly handle: AdapterSubprocessHandle;
  readonly resources: AdapterExecutionResources;
  readonly terminationControl:
    import("./adapter-execution-coordinator.ts").AdapterTerminationControl;
  readonly onFrame?: (
    frame: AdapterSubprocessFrame,
  ) => void | Promise<void>;
}

export interface AdapterSubprocessFrame {
  readonly channel: "stdout" | "stderr";
  readonly text: string;
}

export interface AdapterSubprocessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export function createAdapterSubprocessHandle(
  identity: string,
): AdapterSubprocessHandle {
  return new AdapterSubprocessHandle(identity);
}

// @sigil implements packages/compiler/src/adapter-subprocess.sigil::SigilAgentAdapterSubprocess::AdapterSubprocess interface,logic,cases
export function validateAdapterSubprocessInput(
  input: string,
  maxInitialRequestChars: number,
): void {
  if (input.length > maxInitialRequestChars) {
    throw new AdapterFailure(
      "operational-limit",
      `Provider input exceeds the ${maxInitialRequestChars}-character limit.`,
    );
  }
}

interface AttachedSubprocess {
  readonly child: Deno.ChildProcess;
  readonly status: Promise<Deno.CommandStatus>;
  readonly stdout: ChannelOutput;
  readonly stderr: ChannelOutput;
  readonly resources: AdapterExecutionResources;
  readonly identities: readonly string[];
}

interface ChannelOutput {
  readonly promise: Promise<string>;
  readonly cancel: () => Promise<void>;
}

function asChannelOutput(
  output: ChannelOutput | Promise<string>,
): ChannelOutput {
  return "promise" in output
    ? output
    : { promise: output, cancel: () => Promise.resolve() };
}

// @sigil implements packages/compiler/src/adapter-subprocess.sigil::SigilAgentAdapterSubprocess::AdapterSubprocess interface,logic
export class AdapterSubprocessHandle implements AdapterExecutionHandle {
  #attached?: AttachedSubprocess;
  #identities?: readonly string[];

  constructor(readonly identity: string) {}

  declare(identities: readonly string[]): void {
    this.#identities = identities;
  }

  attach(
    child: Deno.ChildProcess,
    status: Promise<Deno.CommandStatus>,
    stdout: ChannelOutput | Promise<string>,
    stderr: ChannelOutput | Promise<string>,
    resources: AdapterExecutionResources,
    identities: readonly string[],
  ): void {
    if (this.#attached) {
      throw new AdapterFailure(
        "execution",
        `Subprocess handle ${this.identity} already has an attached process.`,
      );
    }
    this.#attached = {
      child,
      status,
      stdout: asChannelOutput(stdout),
      stderr: asChannelOutput(stderr),
      resources,
      identities,
    };
  }

  async cleanup(
    _winningCondition: AdapterFailureKind,
    cleanupDeadline: number,
    resources: AdapterExecutionResources,
  ): Promise<void> {
    const attached = this.#attached;
    if (!attached) {
      resources.cleanupAttempt("unstarted");
      for (const [index, identity] of (this.#identities ?? []).entries()) {
        if (index === 0) resources.observeResource(identity, "released");
        else resources.observeResultInput(identity, "cancelled");
      }
      return;
    }
    resources.cleanupAttempt("graceful:SIGTERM");
    try {
      attached.child.kill("SIGTERM");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        resources.reportResourceObservation(
          attached.identities[0],
          "failed",
          String(error),
        );
      }
    }
    if (!await settleBeforeDeadline(attached, cleanupDeadline, resources)) {
      resources.cleanupAttempt("forced:SIGKILL");
      try {
        attached.child.kill("SIGKILL");
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          resources.reportResourceObservation(
            attached.identities[0],
            "failed",
            String(error),
          );
        }
      }
      if (!await settleBeforeDeadline(attached, cleanupDeadline, resources)) {
        await Promise.allSettled([
          attached.stdout.cancel(),
          attached.stderr.cancel(),
        ]);
        attached.child.unref();
        resources.reportResourceObservation(
          attached.identities[0],
          "incomplete",
          "Provider cleanup deadline expired.",
        );
        for (const identity of attached.identities.slice(1)) {
          resources.reportResultInputObservation(
            identity,
            "incomplete",
            "Provider cleanup deadline expired.",
          );
        }
        return;
      }
    }
    resources.observeResource(attached.identities[0], "terminal");
    resources.observeResource(attached.identities[0], "released");
    for (const identity of attached.identities.slice(1)) {
      resources.observeResultInput(identity, "cancelled");
    }
  }
}

// @sigil implements packages/compiler/src/adapter-subprocess.sigil::SigilAgentAdapterSubprocess::AdapterSubprocess interface,logic,cases
export async function runAdapterSubprocess(
  invocation: AdapterSubprocessInvocation,
): Promise<AdapterSubprocessResult> {
  const { resources, handle } = invocation;
  const resourceIdentity = `process:${handle.identity}`;
  const identities = [
    resourceIdentity,
    "result-input:stdout",
    "result-input:stderr",
  ];
  validateAdapterSubprocessInput(
    invocation.input,
    invocation.maxInitialRequestChars,
  );
  if (invocation.signal.aborted) {
    throw new AdapterFailure(
      "cancelled",
      "Evaluation was cancelled before launch.",
    );
  }
  resources.declareResource(resourceIdentity);
  resources.declareResultInput(identities[1]);
  resources.declareResultInput(identities[2]);
  handle.declare(identities);
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
      "process",
      `Could not start ${invocation.command}.`,
      undefined,
      { cause: error },
    );
  }

  resources.observeResource(resourceIdentity, "active");
  resources.observeResultInput(identities[1], "open");
  resources.observeResultInput(identities[2], "open");
  const stdout = readOutput(
    child.stdout,
    "stdout",
    invocation.onFrame,
    invocation.maxProviderFrameChars,
  );
  const stderr = readOutput(
    child.stderr,
    "stderr",
    invocation.onFrame,
    invocation.maxProviderFrameChars,
  );
  const status = child.status;
  handle.attach(
    child,
    status,
    stdout,
    stderr,
    resources,
    identities,
  );
  try {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(invocation.input));
    await writer.close();

    const settled = await Promise.race([
      status.then((value) => ({ kind: "status" as const, value })),
      abortResult(invocation.signal),
      outputFailure(stdout.promise),
      outputFailure(stderr.promise),
    ]);
    if (settled.kind === "abort") {
      const initiatingKind: AdapterFailureKind = failureKind(
        invocation.signal.reason,
      );
      throw new AdapterFailure(
        initiatingKind,
        initiatingKind === "cancelled"
          ? "Evaluation was cancelled."
          : "Evaluation elapsed-time budget expired.",
      );
    }
    if (settled.kind === "output-failure") {
      const initiatingKind = failureKindForOutput(settled.error);
      throw new AdapterFailure(
        initiatingKind,
        settled.error.message,
        undefined,
        { cause: settled.error },
      );
    }
    const [stdoutText, stderrText] = await Promise.all([
      stdout.promise,
      stderr.promise,
    ]);
    resources.observeResource(resourceIdentity, "terminal");
    resources.observeResource(resourceIdentity, "released");
    resources.observeResultInput(identities[1], "closed");
    resources.observeResultInput(identities[2], "closed");
    if (!settled.value.success) {
      throw new AdapterFailure(
        "process",
        `${invocation.command} exited with ${settled.value.code}: ${stderrText.trim()}`,
      );
    }
    return { stdout: stdoutText, stderr: stderrText, code: settled.value.code };
  } catch (error) {
    if (error instanceof AdapterFailure) throw error;
    throw new AdapterFailure(
      "process",
      `Provider subprocess failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      undefined,
      { cause: error },
    );
  }
}

async function settleBeforeDeadline(
  attached: AttachedSubprocess,
  cleanupDeadline: number,
  resources: AdapterExecutionResources,
): Promise<boolean> {
  const remaining = Math.max(0, cleanupDeadline - performance.now());
  const timeout = Symbol("deadline");
  const settled = await Promise.race([
    Promise.all([
      attached.status,
      attached.stdout.promise,
      attached.stderr.promise,
    ]).then(
      () => true,
      (error) => {
        resources.reportResourceObservation(
          attached.identities[0],
          "failed",
          `Provider lifecycle observation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return false;
      },
    ),
    new Promise<typeof timeout>((resolve) =>
      setTimeout(() => resolve(timeout), remaining)
    ),
  ]);
  return settled !== timeout && settled;
}

function readOutput(
  stream: ReadableStream<Uint8Array>,
  channel: AdapterSubprocessFrame["channel"],
  onFrame:
    | ((frame: AdapterSubprocessFrame) => void | Promise<void>)
    | undefined,
  maxFrameChars: number,
): ChannelOutput {
  const reader = stream.getReader();
  const promise = (async () => {
    const decoder = new TextDecoder();
    let retained = "";
    let openFrame = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      assertFrameLimit(text, maxFrameChars, openFrame);
      const lastBreak = Math.max(
        text.lastIndexOf("\n"),
        text.lastIndexOf("\r"),
      );
      openFrame = lastBreak < 0 ? openFrame + text : text.slice(lastBreak + 1);
      if (onFrame) await onFrame({ channel, text });
      else retained += text;
    }
    const tail = decoder.decode();
    if (tail) {
      assertFrameLimit(tail, maxFrameChars, openFrame);
      if (onFrame) await onFrame({ channel, text: tail });
      else retained += tail;
    }
    return retained;
  })();
  return { promise, cancel: () => reader.cancel() };
}

function assertFrameLimit(
  chunk: string,
  maxFrameChars: number,
  prefix: string,
): void {
  for (const frame of `${prefix}${chunk}`.split(/\r?\n/)) {
    if (frame.length > maxFrameChars) {
      throw new AdapterFailure(
        "operational-limit",
        `Provider output frame exceeds the ${maxFrameChars}-character limit.`,
      );
    }
  }
}

function abortResult(signal: AbortSignal): Promise<{ readonly kind: "abort" }> {
  if (signal.aborted) return Promise.resolve({ kind: "abort" });
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ kind: "abort" }), {
      once: true,
    });
  });
}

async function outputFailure(
  output: Promise<string>,
): Promise<
  { readonly kind: "output-failure"; readonly error: AdapterFailure }
> {
  try {
    await output;
    return await new Promise(() => {});
  } catch (error) {
    return {
      kind: "output-failure",
      error: error instanceof AdapterFailure ? error : new AdapterFailure(
        "process",
        error instanceof Error ? error.message : String(error),
        undefined,
        { cause: error },
      ),
    };
  }
}

function failureKindForOutput(error: AdapterFailure): AdapterFailureKind {
  return error.kind === "operational-limit" ? "operational-limit" : "process";
}

function failureKind(reason: unknown): "cancelled" | "elapsed-time" {
  return reason instanceof AdapterFailure && reason.kind === "elapsed-time"
    ? "elapsed-time"
    : "cancelled";
}
