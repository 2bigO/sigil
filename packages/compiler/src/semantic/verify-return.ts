import { resolve } from "node:path";
import type { ResolvedSigilWorkspace } from "@qoherent/sigil-core";
import type { CommandCheckEvidence } from "./checks.ts";
import {
  artifactPayload,
  recordCompilationRun,
  recordSemanticStage,
} from "./artifact-recording.ts";
import { artifactJson } from "./artifacts.ts";
import { compileSemanticWorld } from "./compile.ts";
import type { SemanticCompilation } from "./compile.ts";
import type { SemanticEngineOptions } from "./engine.ts";
import type { MechanicalCheck } from "./engine.ts";
import type { ImplementationEvidence } from "./evidence.ts";
import {
  type ExecutionBudget,
  withExecutionBudget,
} from "./execution-budget.ts";
import { collectVerificationEvidence } from "./verification.ts";
import {
  readImplementationHandoff,
  validateHandoffSnapshot,
} from "./handoff.ts";
import type { ReceiptLocationResult } from "./receipt-locations.ts";
import { receiptWitnessInputs } from "./receipt-witnesses.ts";
import { parseReceiptSubmission, readReceiptSubmission } from "./receipts.ts";
import { SemanticInputError, serializeSemanticWorld } from "./turtle.ts";

export interface ReturnedImplementationOptions {
  readonly root: string;
  readonly handoff: string;
  readonly receipts?: string;
  readonly handoffRoot?: string;
  readonly resolved?: ResolvedSigilWorkspace;
  /** Total verification time; individual engine and command limits also apply. */
  readonly timeoutMs?: number;
  readonly engine?: Pick<
    SemanticEngineOptions,
    "binaryPath" | "runtimeDirectory" | "signal" | "timeoutMs"
  >;
}

interface ReturnedObligation {
  readonly id: string;
  readonly kernelId: string;
  readonly subject: string;
  readonly relation: string;
  readonly target: string;
  readonly expected: boolean;
  readonly status: "violated" | "covered" | "unresolved";
  readonly evidence: readonly string[];
  readonly violations: readonly string[];
}

interface ReturnedReceiptResult {
  readonly receipt: string;
  readonly obligation: string;
  readonly status: "contradicted" | "supported" | "unresolved";
  readonly evidence: readonly string[];
  readonly witness: string;
  readonly locations: readonly ReceiptLocationResult[];
}

interface ReturnedImplementationReportData {
  readonly version: 1;
  readonly status: "green" | "yellow" | "red";
  readonly handoff: string;
  readonly receiptSubmission: string | null;
  readonly worldFingerprint: string;
  readonly sliceFingerprint: string;
  readonly codeFingerprint: string;
  readonly scope: readonly string[];
  readonly obligations: readonly ReturnedObligation[];
  readonly receiptResults: readonly ReturnedReceiptResult[];
  readonly diagnostics: SemanticCompilation["diagnostics"];
  readonly closure: SemanticCompilation["closure"];
  readonly checks: readonly MechanicalCheck[];
  readonly requiredChecks: readonly string[];
  readonly evidence: Omit<ImplementationEvidence, "world"> & {
    readonly world: undefined;
    readonly turtle: string;
  };
  readonly commandEvidence: Omit<CommandCheckEvidence, "world"> & {
    readonly world: undefined;
    readonly turtle: string;
  };
  readonly artifacts: {
    readonly stages: Readonly<Record<string, string>>;
    readonly checks: Readonly<Record<string, string>>;
    readonly run: string;
  };
}

interface ReturnedImplementationResult {
  readonly compilation: SemanticCompilation;
  readonly evidence: ImplementationEvidence;
  readonly report: ReturnedImplementationReportData;
}

/** Verify one returned snapshot. No candidate generation, patching or repair loop. */
// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationHandoff::ReceiptVerification interface
export async function verifyReturnedImplementation(
  options: ReturnedImplementationOptions,
): Promise<ReturnedImplementationResult> {
  return await withExecutionBudget(
    { timeoutMs: options.timeoutMs, signal: options.engine?.signal },
    (budget) => verifyReturnedSnapshot(options, budget),
  );
}

async function verifyReturnedSnapshot(
  options: ReturnedImplementationOptions,
  budget: ExecutionBudget,
): Promise<ReturnedImplementationResult> {
  const root = resolve(options.root);
  const engine = {
    binaryPath: options.engine?.binaryPath,
    runtimeDirectory: options.engine?.runtimeDirectory,
    signal: budget.signal,
    timeoutMs: Math.min(
      options.engine?.timeoutMs ?? 30_000,
      budget.remainingMs(),
    ),
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
  const collected = await collectVerificationEvidence({
    root,
    policy: handoff.manifest.policy,
    resolved: options.resolved,
    engine,
    snapshot: before,
  }, budget);
  const evidence = collected.evidence!;
  const commands = collected.commands;
  const witnesses = receiptWitnessInputs(handoff, submission, evidence);
  const mechanical = {
    ...engine,
    ...witnesses.mechanical,
    observations: evidence.observations,
    completeScopes: evidence.completeScopes,
    requiredChecks: handoff.manifest.requiredChecks,
    checks: [...evidence.checks, ...commands.checks],
    focus: "implementation" as const,
    timeoutMs: Math.min(engine.timeoutMs, budget.remainingMs()),
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
  await collected.assertCurrent();
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
    version: 1 as const,
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
      stages: {
        "returned-implementation": stage,
        ...(collected.nativeArtifact
          ? { "native-evidence": collected.nativeArtifact }
          : {}),
      },
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

export type ReturnedImplementationReport =
  ReturnedImplementationResult["report"];

export interface ReturnedImplementationSummary {
  readonly status: ReturnedImplementationReport["status"];
  readonly handoff: ReturnedImplementationReport["handoff"];
  readonly receiptSubmission: ReturnedImplementationReport["receiptSubmission"];
  readonly codeFingerprint: ReturnedImplementationReport["codeFingerprint"];
  readonly worldFingerprint: ReturnedImplementationReport["worldFingerprint"];
  readonly sliceFingerprint: ReturnedImplementationReport["sliceFingerprint"];
  readonly scope: ReturnedImplementationReport["scope"];
  readonly run: ReturnedImplementationReport["artifacts"]["run"];
  readonly obligations: readonly {
    readonly id: string;
    readonly status:
      ReturnedImplementationReport["obligations"][number]["status"];
    readonly proposition: string;
    readonly evidence: readonly string[];
    readonly violations: readonly string[];
  }[];
  readonly receipts: readonly {
    readonly receipt: string;
    readonly obligation: string;
    readonly status:
      ReturnedImplementationReport["receiptResults"][number]["status"];
    readonly evidence: readonly string[];
    readonly witness: string;
    readonly locations: readonly string[];
  }[];
  readonly requiredChecks: ReturnedImplementationReport["requiredChecks"];
  readonly checks: ReturnedImplementationReport["checks"];
}

/** Compact report projection; the run bundle retains primitive source/rule witnesses. */
export function summarizeReturnedImplementation(
  report: ReturnedImplementationReport,
): ReturnedImplementationSummary {
  return {
    status: report.status,
    handoff: report.handoff,
    receiptSubmission: report.receiptSubmission,
    codeFingerprint: report.codeFingerprint,
    worldFingerprint: report.worldFingerprint,
    sliceFingerprint: report.sliceFingerprint,
    scope: report.scope,
    run: report.artifacts.run,
    obligations: report.obligations.map((o) => ({
      id: o.id,
      status: o.status,
      proposition: `${o.subject} ${
        o.expected ? "" : "never "
      }${o.relation} ${o.target}`,
      evidence: o.evidence,
      violations: o.violations,
    })),
    receipts: report.receiptResults.map((r) => ({
      receipt: r.receipt,
      obligation: r.obligation,
      status: r.status,
      evidence: r.evidence,
      witness: r.witness,
      locations: r.locations.map((l) =>
        l.symbol
          ? `${l.symbol.file}:${l.symbol.line}:${l.symbol.column} ${l.symbol.selector}`
          : `location ${l.location + 1}: ${l.status}`
      ),
    })),
    requiredChecks: report.requiredChecks,
    checks: report.checks,
  };
}
