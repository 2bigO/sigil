import { resolve } from "node:path";
import type { ResolvedSigilWorkspace } from "@qoherent/sigil-core";
import {
  artifactPayload,
  recordCompilationRun,
  recordSemanticStage,
} from "./artifact-recording.ts";
import { artifactJson } from "./artifacts.ts";
import { runImplementationChecks } from "./checks.ts";
import { compileSemanticWorld } from "./compile.ts";
import type { SemanticEngineOptions } from "./engine.ts";
import { collectImplementationEvidence } from "./evidence.ts";
import {
  readImplementationHandoff,
  validateHandoffSnapshot,
} from "./handoff.ts";
import { receiptWitnessInputs } from "./receipt-witnesses.ts";
import { parseReceiptSubmission, readReceiptSubmission } from "./receipts.ts";
import {
  digest,
  SemanticInputError,
  serializeSemanticWorld,
} from "./turtle.ts";

export interface ReturnedImplementationOptions {
  readonly root: string;
  readonly handoff: string;
  readonly receipts?: string;
  readonly handoffRoot?: string;
  readonly resolved?: ResolvedSigilWorkspace;
  readonly engine?: Pick<
    SemanticEngineOptions,
    "binaryPath" | "signal" | "timeoutMs"
  >;
}

/** Verify one returned snapshot. No candidate generation, patching or repair loop. */
// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationHandoff::ReceiptVerification interface
export async function verifyReturnedImplementation(
  options: ReturnedImplementationOptions,
) {
  const root = resolve(options.root);
  const engine = {
    binaryPath: options.engine?.binaryPath,
    signal: options.engine?.signal,
    timeoutMs: options.engine?.timeoutMs,
  };
  const handoff = await readImplementationHandoff(
    options.handoffRoot ?? root,
    options.handoff,
    engine,
  );
  const submission = options.receipts
    ? await readReceiptSubmission(root, handoff, options.receipts, engine)
    : await parseReceiptSubmission(handoff, "", {
      version: 1,
      handoff: handoff.id,
      receipts: {},
    });
  const before = await validateHandoffSnapshot(root, handoff, engine.signal);
  const evidence = await collectImplementationEvidence({
    root,
    policy: handoff.manifest.policy,
    resolved: options.resolved,
    signal: engine.signal,
    timeoutMs: engine.timeoutMs,
  });
  const witnesses = receiptWitnessInputs(handoff, submission, evidence);
  const commands = await runImplementationChecks(
    root,
    handoff.manifest.policy.checks ?? [],
    before.fingerprint,
    { signal: engine.signal, timeoutMs: engine.timeoutMs, snapshot: before },
  );
  const mechanical = {
    ...engine,
    ...witnesses.mechanical,
    observations: evidence.observations,
    completeScopes: evidence.completeScopes,
    requiredChecks: handoff.manifest.requiredChecks,
    checks: [...evidence.checks, ...commands.checks],
    focus: "implementation" as const,
  };
  const compilation = await compileSemanticWorld(handoff.slice, mechanical);
  if (
    compilation.closure.kernelFingerprint !== handoff.manifest.kernelFingerprint
  ) {
    throw new SemanticInputError(
      "STALE_HANDOFF_KERNEL",
      "The kernel changed during returned implementation verification.",
    );
  }
  // Current workspace and all files consumed by TypeScript must remain the same
  // through the last tool call, including external non-default declaration inputs.
  const after = await validateHandoffSnapshot(root, handoff, engine.signal);
  if (after.fingerprint !== before.fingerprint) {
    throw new Error("Returned implementation changed during verification.");
  }
  for (const file of evidence.analysis.files) {
    engine.signal?.throwIfAborted();
    if (
      await digest(await Deno.readTextFile(resolve(root, file.file))) !==
        file.fingerprint
    ) {
      throw new Error(
        `TypeScript input changed during verification: ${file.file}.`,
      );
    }
  }
  const obligations = handoff.manifest.obligations.map((obligation) => {
    const violations = compilation.closure.tables.violation.filter((row) =>
      row[1] === obligation.kernelId
    );
    const support = compilation.closure.tables["implementation-satisfied"]
      .filter((row) => row[0] === obligation.kernelId).map((row) =>
        String(row[1])
      );
    return {
      ...obligation,
      status: violations.length
        ? "violated" as const
        : support.length
        ? "covered" as const
        : "unresolved" as const,
      evidence: support,
      violations: violations.map((row) => String(row[0])),
    };
  });
  const receiptResults = submission.claims.flatMap((claim) =>
    claim.obligations.map((id) => {
      const obligation = handoff.manifest.obligations.find((o) => o.id === id)!;
      const rows = compilation.closure.tables["receipt-result"].filter((row) =>
        row[0] === claim.id && row[1] === obligation.kernelId
      );
      if (!rows.length) {
        throw new Error("The kernel omitted a required receipt outcome.");
      }
      const status = rows.some((row) => row[2] === "contradicted")
        ? "contradicted" as const
        : rows.some((row) => row[2] === "supported")
        ? "supported" as const
        : "unresolved" as const;
      return {
        receipt: claim.id,
        obligation: id,
        status,
        evidence: rows.filter((row) => row[2] === status && row[3]).map((row) =>
          String(row[3])
        ),
        witness: `receipt|${claim.id}|${obligation.kernelId}`,
        locations: witnesses.locations.filter((location) =>
          location.receipt === claim.id
        ),
      };
    })
  );
  const stage = await recordSemanticStage(root, compilation, {
    stage: "returned-implementation",
    sourceFingerprint: before.fingerprint,
    evidence,
    mechanical,
    extraFiles: {
      "receipt-locations.json": artifactPayload(witnesses.locations),
      "command-checks.json": artifactPayload({ ...commands, world: undefined }),
      "assignment.json": artifactJson({
        handoff: handoff.id,
        receipts: options.receipts ?? null,
        claims: submission.fingerprint,
      }),
    },
  });
  const report = {
    version: 1,
    status: compilation.status,
    handoff: handoff.id,
    receiptSubmission: options.receipts ?? null,
    worldFingerprint: handoff.world.fingerprint,
    sliceFingerprint: handoff.slice.fingerprint,
    codeFingerprint: before.fingerprint,
    scope: handoff.manifest.boundary,
    obligations,
    receiptResults,
    diagnostics: compilation.diagnostics,
    closure: compilation.closure,
    checks: mechanical.checks,
    requiredChecks: handoff.manifest.requiredChecks,
    evidence: {
      ...evidence,
      world: undefined,
      turtle: serializeSemanticWorld(evidence.world),
    },
    commandEvidence: {
      ...commands,
      world: undefined,
      turtle: serializeSemanticWorld(commands.world),
    },
    artifacts: {
      stages: { "returned-implementation": stage },
      checks: commands.artifacts,
    },
  };
  const run = await recordCompilationRun(root, report, {
    handoff: handoff.id,
    claims: submission.fingerprint,
    code: before.fingerprint,
    stage,
  });
  engine.signal?.throwIfAborted();
  return {
    compilation,
    evidence,
    report: { ...report, artifacts: { ...report.artifacts, run } },
  };
}
