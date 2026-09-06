import { applyDiagnosticLifecycle } from "./history.ts";
import { compilationColor } from "./status.ts";
import {
  COMPILATION_REPORT_VERSION,
  type CompilationEvaluationResult,
  type CompilationReport,
  type CompilerDiagnostic,
  type StageReport,
} from "./types.ts";

export interface CompilationReportInput extends
  Omit<
    CompilationReport,
    "reportVersion" | "status" | "diagnostics"
  > {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly stages: readonly StageReport[];
  readonly previous?: CompilationReport;
}

// @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol interface,logic,constraints,cases
export function constructCompilationReport(
  input: CompilationReportInput,
): CompilationReport {
  const diagnostics = applyDiagnosticLifecycle(
    input.diagnostics,
    input.previous,
  );
  const { previous: _previous, ...report } = input;
  return {
    ...report,
    reportVersion: COMPILATION_REPORT_VERSION,
    status: compilationColor(diagnostics, input.stages),
    diagnostics,
  };
}

export interface SessionReportIdentity {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly sessionIdentity: string;
  readonly baseEpoch: number;
  readonly generation: number;
  readonly baseFingerprint: string;
  readonly proposalFingerprint: string;
}

// @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::CompilationReport interface,cases
export function constructSessionCompilationReport(
  evaluation: CompilationEvaluationResult,
  identity: SessionReportIdentity,
  previous?: CompilationReport,
): CompilationReport {
  return constructCompilationReport({
    ...evaluation,
    diagnostics: evaluation.diagnostics ?? [],
    stages: evaluation.stages ?? [],
    runId: identity.runId,
    workspaceRoot: identity.workspaceRoot,
    previous,
    session: {
      sessionIdentity: identity.sessionIdentity,
      baseEpoch: identity.baseEpoch,
      generation: identity.generation,
      baseFingerprint: identity.baseFingerprint,
      proposalFingerprint: identity.proposalFingerprint,
    },
  });
}

// @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::ReportWireValidation interface
export function validateCompilationReportWire(
  value: unknown,
): value is CompilationReport {
  if (!record(value)) return false;
  return value.reportVersion === COMPILATION_REPORT_VERSION &&
    nonempty(value.runId) && nonempty(value.workspaceRoot) &&
    validTarget(value.target) && validScope(value.requestedScope) &&
    validSelection(value.selection) && stringArray(value.componentNames) &&
    ["red", "yellow", "green"].includes(String(value.status)) &&
    date(value.startedAt) && date(value.completedAt) &&
    nonempty(value.sourceFingerprint) && validProfile(value.profile) &&
    validSemanticScope(value.semanticScope) &&
    validWorkspaceDrift(value.workspaceDrift) &&
    Array.isArray(value.stages) && value.stages.every(validStageReport) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(validDiagnostic) &&
    (value.requestedStage === undefined || nonempty(value.requestedStage)) &&
    (value.focus === undefined || value.focus === "design" ||
      value.focus === "implementation") &&
    validSession(value.session) && validArtifacts(value.artifacts) &&
    validReturnedImplementation(value.returnedImplementation);
}

function validSemanticScope(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value) || Object.keys(value).some((key) => key !== "entities")) {
    return false;
  }
  const entities = value.entities;
  if (!Array.isArray(entities) || !entities.every(nonempty)) return false;
  const ordered = entities as string[];
  return ordered.every((item, index, all) =>
    item.length > 0 && (index === 0 || all[index - 1] < item)
  );
}

function validWorkspaceDrift(value: unknown): boolean {
  if (value === undefined) return true;
  if (
    !record(value) ||
    Object.keys(value).some((key) =>
      !["authoredSourceChanged", "views"].includes(key)
    ) || typeof value.authoredSourceChanged !== "boolean"
  ) return false;
  const views = value.views;
  if (
    !record(views) || views.version !== 1 ||
    ![
      "not-installed",
      "current",
      "stale",
      "edited",
      "incomplete",
      "unsupported-version",
    ].includes(String(views.state)) ||
    (views.worldRevision !== null && !hash(views.worldRevision)) ||
    (views.recordedWorldRevision !== null &&
      !hash(views.recordedWorldRevision)) ||
    !Array.isArray(views.transactions) ||
    !views.transactions.every((item) => hash(item)) ||
    !Array.isArray(views.differences) ||
    !views.differences.every((item) =>
      record(item) &&
      typeof item.path === "string" && item.path.length > 0 &&
      ["missing", "changed", "unexpected", "metadata"].includes(
        String(item.kind),
      )
    )
  ) return false;
  return Object.keys(views).every((key) =>
    [
      "version",
      "state",
      "worldRevision",
      "recordedWorldRevision",
      "transactions",
      "differences",
    ].includes(key)
  );
}

function validReturnedImplementation(value: unknown): boolean {
  const hash = (v: unknown) =>
    typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (value === undefined) return true;
  return record(value) && hash(value.handoff) && hash(value.run) &&
    hash(value.worldFingerprint) && hash(value.sliceFingerprint) &&
    hash(value.codeFingerprint) &&
    (value.receiptSubmission === null || hash(value.receiptSubmission)) &&
    ["green", "yellow", "red"].includes(String(value.status)) &&
    stringArray(value.scope) && stringArray(value.requiredChecks) &&
    Array.isArray(value.obligations) &&
    value.obligations.every((o) =>
      record(o) && nonempty(o.id) && nonempty(o.proposition) &&
      ["covered", "violated", "unresolved"].includes(String(o.status)) &&
      stringArray(o.evidence) && stringArray(o.violations)
    ) &&
    Array.isArray(value.receipts) &&
    value.receipts.every((r) =>
      record(r) && nonempty(r.receipt) && nonempty(r.obligation) &&
      nonempty(r.witness) &&
      ["supported", "contradicted", "unresolved"].includes(String(r.status)) &&
      stringArray(r.evidence) && stringArray(r.locations)
    ) &&
    Array.isArray(value.checks) &&
    value.checks.every((c) =>
      record(c) && nonempty(c.id) && typeof c.passed === "boolean" &&
      nonempty(c.evidence)
    );
}

function validArtifacts(value: unknown): boolean {
  const hash = (value: unknown) =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  return value === undefined || record(value) && record(value.stages) &&
      Object.values(value.stages).every(hash) &&
      (value.run === undefined || hash(value.run));
}

// @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::ReportWireValidation interface
export function equalReportWireValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length &&
      left.every((item, index) => equalReportWireValue(item, right[index]));
  }
  if (!record(left) || !record(right)) return false;
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined)
    .sort();
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined)
    .sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && equalReportWireValue(left[key], right[key])
    );
}

export function validStageReport(value: unknown): value is StageReport {
  return record(value) && nonempty(value.id) &&
    typeof value.required === "boolean" &&
    [
      "pending",
      "running",
      "completed",
      "failed",
      "skipped-by-dependency",
      "disabled",
      "cancelled",
    ].includes(String(value.state)) && nonempty(value.evaluator) &&
    nonnegativeInteger(value.diagnosticCount) &&
    (value.startedAt === undefined || date(value.startedAt)) &&
    (value.completedAt === undefined || date(value.completedAt)) &&
    (value.evaluations === undefined || Array.isArray(value.evaluations));
}

export function validDiagnostic(
  value: unknown,
): value is CompilerDiagnostic {
  return record(value) && nonempty(value.code) && nonempty(value.fingerprint) &&
    ["error", "warning", "optimization", "information"].includes(
      String(value.severity),
    ) && nonempty(value.stage) && nonempty(value.skill) &&
    typeof value.message === "string" &&
    Array.isArray(value.semanticSubjects) &&
    typeof value.evidence === "string" && typeof value.impact === "string" &&
    typeof value.correction === "string" && nonempty(value.evaluator) &&
    ["new", "unchanged", "resolved", "regressed"].includes(
      String(value.lifecycle),
    );
}

function validProfile(value: unknown): boolean {
  return record(value) && nonempty(value.name) &&
    typeof value.criticalSystem === "boolean" &&
    positiveInteger(value.contextBudgetChars) &&
    positiveInteger(value.agentInputBudgetChars) && record(value.limits) &&
    record(value.executionBudgets) && Array.isArray(value.stages) &&
    Array.isArray(value.evaluators) && nonempty(value.fingerprint);
}

function validTarget(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === "workspace") return true;
  if (value.kind === "file") return nonempty(value.filePath);
  if (value.kind === "component") {
    return nonempty(value.name) &&
      (value.declarationPath === undefined || nonempty(value.declarationPath));
  }
  return value.kind === "location" && nonempty(value.filePath) &&
    positiveInteger(value.line) && positiveInteger(value.column);
}

function validSession(value: unknown): boolean {
  return value === undefined || (record(value) &&
    nonempty(value.sessionIdentity) && positiveInteger(value.baseEpoch) &&
    positiveInteger(value.generation) && nonempty(value.baseFingerprint) &&
    nonempty(value.proposalFingerprint));
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function stringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(nonempty);
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonnegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function date(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validScope(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === "workspace") return true;
  if (value.kind === "component") return nonempty(value.componentName);
  if (value.kind === "file") return nonempty(value.filePath);
  if (value.kind === "directory") return nonempty(value.directoryPath);
  if (value.kind === "location") {
    return nonempty(value.filePath) && typeof value.line === "number" &&
      typeof value.column === "number";
  }
  return false;
}

function validSelection(value: unknown): boolean {
  if (!record(value)) return false;
  return [
    "exact-target",
    "nearest-covering-module-index",
    "covering-component",
    "workspace-fallback",
  ].includes(String(value.strategy)) &&
    stringArray(value.affectedSemanticUnits) &&
    stringArray(value.coveredSemanticUnits) &&
    stringArray(value.uncoveredSemanticUnits);
}
