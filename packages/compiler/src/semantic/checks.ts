import {
  AdapterFailure,
  coordinateAdapterExecution,
} from "../adapter-execution-coordinator.ts";
import {
  createAdapterSubprocessHandle,
  runAdapterSubprocess,
} from "../adapter-subprocess.ts";
import { TurtleBuilder } from "./builder.ts";
import type { MechanicalCheck } from "./engine.ts";
import { digest, parseSemanticWorld, type SemanticWorld } from "./turtle.ts";

import type { ImplementationCheckCommand } from "./evidence.ts";
import { artifactJson, writeCompileArtifact } from "./artifacts.ts";
import {
  bytesHash,
  captureImplementationSnapshot,
  type ImplementationSnapshot,
  withImplementationSnapshot,
} from "./implementation-workspace.ts";
import { resolve } from "node:path";
import {
  type ExecutionBudget,
  withExecutionBudget,
} from "./execution-budget.ts";

export interface CommandCheckReceipt {
  readonly producer: "command";
  readonly inputFingerprint: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputFingerprint: string;
}
export interface CommandCheckEvidence {
  readonly world: SemanticWorld;
  readonly requiredChecks: readonly string[];
  readonly checks: readonly MechanicalCheck[];
  readonly receipts: Readonly<Record<string, CommandCheckReceipt>>;
  readonly artifacts: Readonly<Record<string, string>>;
}

/** Run only host-selected commands, in a disposable workspace owned by the caller. */
// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationEvidence::MechanicalCoverage interface
export async function runImplementationChecks(
  root: string,
  commands: readonly ImplementationCheckCommand[],
  inputFingerprint: string,
  options: {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly snapshot?: ImplementationSnapshot;
  } = {},
): Promise<CommandCheckEvidence> {
  return await withExecutionBudget(
    options,
    (budget) =>
      runCheckBatch(root, commands, inputFingerprint, options.snapshot, budget),
  );
}

async function runCheckBatch(
  root: string,
  commands: readonly ImplementationCheckCommand[],
  inputFingerprint: string,
  suppliedSnapshot: ImplementationSnapshot | undefined,
  budget: ExecutionBudget,
): Promise<CommandCheckEvidence> {
  if (
    commands.length > 32 ||
    new Set(commands.map((command) => command.id)).size !== commands.length
  ) {
    throw new Error(
      "Check commands must have unique ids and at most 32 entries.",
    );
  }
  const builder = new TurtleBuilder();
  const checks: MechanicalCheck[] = [];
  const receipts: Record<string, CommandCheckReceipt> = {};
  const artifacts: Record<string, string> = {};
  const snapshot = suppliedSnapshot ??
    await captureImplementationSnapshot(root, budget.signal);
  if (inputFingerprint !== snapshot.fingerprint) {
    throw new Error("Check input fingerprint does not match its snapshot.");
  }
  for (const command of commands) {
    budget.remainingMs();
    const timeoutMs = Math.min(
      command.timeoutMs ?? 120_000,
      budget.remainingMs(),
    );
    if (
      !command.id || !command.command || !Array.isArray(command.args) ||
      command.args.some((arg) => typeof arg !== "string") ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
      timeoutMs > 2_147_483_647
    ) {
      throw new Error("Invalid implementation check command.");
    }
    const identity = `check:${command.id}`;
    const handle = createAdapterSubprocessHandle(identity);
    let stdout = "";
    let stderr = "";
    const result = await withImplementationSnapshot(snapshot, async (copy) => {
      const result = await coordinateAdapterExecution({
        elapsedOrigin: performance.now(),
        elapsedTimeMs: timeoutMs,
        providerCleanupMs: 3000,
        implementationIdentity: identity,
        handle,
        signal: budget.signal,
        invoke: (signal, resources, terminationControl) =>
          runAdapterSubprocess({
            implementationIdentity: identity,
            command: command.command,
            args: command.args,
            cwd: copy,
            input: "",
            signal,
            handle,
            resources,
            terminationControl,
            maxInitialRequestChars: 1,
            maxProviderFrameChars: 1024 * 1024,
            acceptNonzeroExit: true,
            onFrame(frame) {
              if (frame.channel === "stdout") stdout += frame.text;
              else stderr += frame.text;
              if (stdout.length + stderr.length > 1024 * 1024) {
                throw new AdapterFailure(
                  "operational-limit",
                  "Check output exceeds the 1 MiB character limit.",
                );
              }
            },
          }),
      });
      for (const file of snapshot.files) {
        budget.remainingMs();
        const path = resolve(copy, file.path);
        const stat = await Deno.lstat(path);
        const hash = file.symlink
          ? await digest(await Deno.readLink(path))
          : await bytesHash(await Deno.readFile(path));
        if (
          hash !== file.hash || stat.isSymlink !== !!file.symlink ||
          !file.symlink &&
            (!stat.isFile || !!((stat.mode ?? 0) & 0o111) !== file.executable)
        ) {
          throw new Error(
            `Verification input changed during check: ${file.path}.`,
          );
        }
      }
      return result;
    }, budget.signal);
    const receipt: CommandCheckReceipt = {
      producer: "command",
      inputFingerprint,
      command: command.command,
      args: command.args,
      exitCode: result.code,
      stdout,
      stderr,
      outputFingerprint: await digest(JSON.stringify([stdout, stderr])),
    };
    const id = `urn:sigil:evidence:${await digest(JSON.stringify(receipt))}`;
    receipts[id] = receipt;
    artifacts[command.id] = (await writeCompileArtifact(root, {
      kind: "cache",
      dependencies: {
        snapshot: snapshot.fingerprint,
        command: await digest(artifactJson(command)),
      },
      files: { "check.json": artifactJson(receipt) },
      metadata: { stage: "command-check", check: command.id },
    })).id;
    checks.push({ id: command.id, passed: result.code === 0, evidence: id });
    builder.type(id, "Evidence").value(id, "passes", result.code === 0)
      .edge(
        id,
        "evidenceFor",
        `urn:sigil:check:${encodeURIComponent(command.id)}`,
      );
  }
  return {
    world: await parseSemanticWorld([{
      sourceId: `checks:${inputFingerprint}`,
      turtle: builder.toString(),
    }]),
    requiredChecks: commands.map((command) => command.id),
    checks,
    receipts,
    artifacts,
  };
}
