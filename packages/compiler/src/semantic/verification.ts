import { resolve } from "node:path";
import { recordImplementationEvidence } from "./artifact-recording.ts";
import type { ResolvedSigilWorkspace } from "@qoherent/sigil-core";
import { runImplementationChecks } from "./checks.ts";
import type { CommandCheckEvidence } from "./checks.ts";
import { compileSemanticWorld } from "./compile.ts";
import type { SemanticCompilation } from "./compile.ts";
import type { SemanticEngineOptions } from "./engine.ts";
import {
  collectImplementationEvidence,
  type ImplementationEvidence,
  type ImplementationPolicy,
  parseImplementationPolicy,
} from "./evidence.ts";
import {
  type ExecutionBudget,
  withExecutionBudget,
} from "./execution-budget.ts";
import {
  captureImplementationSnapshot,
  type ImplementationSnapshot,
} from "./implementation-workspace.ts";
import { readSemanticState } from "./store.ts";
import { digest, type SemanticWorld } from "./turtle.ts";

interface VerificationInputs {
  readonly root: string;
  readonly policy?: ImplementationPolicy;
  readonly resolved?: ResolvedSigilWorkspace;
  readonly engine?: SemanticEngineOptions;
  readonly snapshot?: ImplementationSnapshot;
  readonly canonicalRevision?: string | null;
}

export interface VerificationEvidenceCollection {
  readonly evidence: ImplementationEvidence | undefined;
  readonly commands: CommandCheckEvidence;
  readonly snapshot: ImplementationSnapshot;
  readonly nativeArtifact: string | undefined;
  readonly assertCurrent: () => Promise<void>;
}

/** Shared independent tools and freshness checks for both verification entry paths. */
// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationEvidence::EvidenceCollection interface
export async function collectVerificationEvidence(
  options: VerificationInputs,
  budget: ExecutionBudget,
): Promise<VerificationEvidenceCollection> {
  const engine = () => ({
    binaryPath: options.engine?.binaryPath,
    runtimeDirectory: options.engine?.runtimeDirectory,
    signal: budget.signal,
    timeoutMs: Math.min(
      options.engine?.timeoutMs ?? 30_000,
      budget.remainingMs(),
    ),
  });
  const policy = options.policy
    ? parseImplementationPolicy(structuredClone(options.policy))
    : undefined;
  const canonical = await readSemanticState(options.root, engine());
  if (
    options.canonicalRevision !== undefined &&
    options.canonicalRevision !== (canonical?.revision ?? null)
  ) {
    throw new Error(
      "Canonical world changed before implementation verification.",
    );
  }
  const snapshot = options.snapshot ??
    await captureImplementationSnapshot(options.root, budget.signal);
  if (policy) {
    const required = [
      policy.project,
      ...policy.protectedFiles ?? [],
      ...(policy.checks ?? []).flatMap((c) => c.files),
    ];
    for (const file of required) {
      if (!snapshot.files.some((f) => f.path === file)) {
        throw new Error(
          `Required verification input is absent from its snapshot: ${file}.`,
        );
      }
    }
  }
  const evidence = policy
    ? await collectImplementationEvidence({
      root: options.root,
      policy,
      resolved: options.resolved,
      signal: budget.signal,
      timeoutMs: engine().timeoutMs,
      runtimeDirectory: engine().runtimeDirectory,
    })
    : undefined;
  const nativeArtifact = evidence
    ? await recordImplementationEvidence(
      options.root,
      snapshot.fingerprint,
      evidence,
    )
    : undefined;
  const commands = await runImplementationChecks(
    options.root,
    policy?.checks ?? [],
    snapshot.fingerprint,
    {
      snapshot,
      signal: budget.signal,
      timeoutMs: budget.remainingMs(),
    },
  );
  async function assertCurrent() {
    budget.remainingMs();
    const after = await captureImplementationSnapshot(
      options.root,
      budget.signal,
    );
    if (snapshot.fingerprint !== after.fingerprint) {
      throw new Error("Implementation changed during verification.");
    }
    for (const file of evidence?.analysis.files ?? []) {
      budget.remainingMs();
      if (
        await digest(
          await Deno.readTextFile(resolve(options.root, file.file)),
        ) !== file.fingerprint
      ) {
        throw new Error(
          `TypeScript input changed during verification: ${file.file}.`,
        );
      }
    }
    if (
      (await readSemanticState(options.root, engine()))?.revision !==
        canonical?.revision
    ) {
      throw new Error(
        "Canonical world changed during implementation verification.",
      );
    }
    budget.remainingMs();
  }
  return { evidence, commands, snapshot, nativeArtifact, assertCurrent };
}

/** Verify the entire supplied current world, without deriving a smaller assignment. */
// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationEvidence::EvidenceCollection interface
export async function verifyImplementationWorld(
  options: VerificationInputs & {
    readonly world: SemanticWorld;
    readonly timeoutMs?: number;
  },
): Promise<{
  readonly compilation: SemanticCompilation;
  readonly evidence: ImplementationEvidence | undefined;
  readonly commands: CommandCheckEvidence;
  readonly snapshot: ImplementationSnapshot;
  readonly mechanical: SemanticEngineOptions;
  readonly nativeArtifact: string | undefined;
}> {
  return await withExecutionBudget({
    timeoutMs: options.timeoutMs,
    signal: options.engine?.signal,
  }, async (budget) => {
    const collected = await collectVerificationEvidence(options, budget);
    const { evidence, commands } = collected;
    const mechanical: SemanticEngineOptions = {
      ...options.engine,
      observations: [
        ...options.engine?.observations ?? [],
        ...evidence?.observations ?? [],
      ],
      completeScopes: [
        ...options.engine?.completeScopes ?? [],
        ...evidence?.completeScopes ?? [],
      ],
      requiredChecks: [
        ...options.engine?.requiredChecks ?? [],
        ...evidence?.requiredChecks ?? [],
        ...commands.requiredChecks,
      ],
      checks: [
        ...options.engine?.checks ?? [],
        ...evidence?.checks ?? [],
        ...commands.checks,
      ],
      focus: "implementation",
      signal: budget.signal,
      timeoutMs: Math.min(
        options.engine?.timeoutMs ?? 30_000,
        budget.remainingMs(),
      ),
    };
    const compilation = await compileSemanticWorld(options.world, mechanical);
    await collected.assertCurrent();
    return {
      compilation,
      evidence,
      commands,
      snapshot: collected.snapshot,
      mechanical,
      nativeArtifact: collected.nativeArtifact,
    };
  });
}
