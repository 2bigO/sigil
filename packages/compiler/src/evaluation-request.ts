import type { PurposeRetrievalResult } from "@qoherent/sigil-core";
import { deriveBudgetOutcome } from "./evaluation-execution.ts";
import type { AgentEvaluationRequest, AgentEvaluationResult } from "./types.ts";

// @sigil implements packages/compiler/src/evaluation-request.sigil::SigilAgentEvaluationRequest::AgentEvaluationRequest interface,cases
export function validateAgentEvaluationRequest(
  request: AgentEvaluationRequest,
): void {
  const retrieval = request.target.retrieval as
    | PurposeRetrievalResult
    | undefined;
  if (!retrieval) {
    throw new Error("Purpose retrieval is required.");
  }
  if (
    retrieval.schema !== "sigil-purpose-retrieval/v1" ||
    retrieval.policyVersion !== 1 ||
    retrieval.purpose !== request.purpose ||
    retrieval.workspaceSnapshotIdentity !== request.workspaceSnapshotIdentity ||
    retrieval.target.kind !== "component" ||
    retrieval.target.componentName !== request.target.componentName ||
    retrieval.target.pathStatus !== "accepted" ||
    retrieval.target.path !== request.target.sigilFile
  ) {
    throw new Error("Purpose retrieval does not match the evaluation request.");
  }
  if (retrieval.diagnostics.some((item) => item.severity === "error")) {
    throw new Error("Purpose retrieval contains an error diagnostic.");
  }
  if (
    !retrieval.fingerprint || !Array.isArray(retrieval.graph.nodes) ||
    !Array.isArray(retrieval.graph.edges) ||
    !Array.isArray(retrieval.evidence) ||
    !Array.isArray(retrieval.context.sections)
  ) {
    throw new Error("Purpose retrieval is incomplete.");
  }
}

// @sigil implements packages/compiler/src/evaluation-request.sigil::SigilAgentEvaluationRequest::AgentEvaluationResult interface,cases
export function validateAgentEvaluationResult(
  request: AgentEvaluationRequest,
  result: AgentEvaluationResult,
): AgentEvaluationResult {
  assertEvaluationResult(result);
  const derived = deriveBudgetOutcome(
    request.budgets,
    request.observability,
    result.usage,
    result.usageAvailability,
    result.cost,
    result.costAvailability,
  );
  if (
    result.budgetOutcome &&
    JSON.stringify(result.budgetOutcome) !== JSON.stringify(derived)
  ) {
    throw new Error("Adapter supplied an invalid budget outcome.");
  }
  return { ...result, budgetOutcome: derived };
}

function assertEvaluationResult(result: AgentEvaluationResult): void {
  if (
    !isRecord(result) || !Array.isArray(result.findings) ||
    !Array.isArray(result.commands)
  ) {
    throw new Error("Adapter returned a malformed evaluation result envelope.");
  }
  for (const finding of result.findings) assertFinding(finding);
  for (const command of result.commands) assertCommand(command);
  assertUsage(result.usage);
  assertAvailability(result.usageAvailability, "usageAvailability");
  assertCost(result.cost);
  assertAvailability(result.costAvailability, "costAvailability");
}

function assertFinding(value: unknown): void {
  if (
    !isRecord(value) || !isString(value.code) ||
    !["error", "warning", "optimization", "information"].includes(
      value.severity as string,
    ) ||
    !isString(value.message) || !isString(value.evidence) ||
    !isString(value.impact) || !isString(value.correction) ||
    !hasNullableString(value, "filePath") ||
    !hasNullablePositiveInteger(value, "line") ||
    !hasNullablePositiveInteger(value, "column")
  ) {
    throw new Error("Adapter returned a malformed finding.");
  }
}

function assertCommand(value: unknown): void {
  if (
    !isRecord(value) || !isString(value.command) ||
    !isOptionalString(value.status) || !isOptionalInteger(value.exitCode)
  ) {
    throw new Error("Adapter returned a malformed command trace.");
  }
}

function assertUsage(value: unknown): void {
  if (value === undefined) return;
  if (
    !isRecord(value) || !isOptionalNonNegativeInteger(value.inputTokens) ||
    !isOptionalNonNegativeInteger(value.cachedInputTokens) ||
    !isOptionalNonNegativeInteger(value.outputTokens)
  ) {
    throw new Error("Adapter returned malformed usage telemetry.");
  }
}

function assertCost(value: unknown): void {
  if (value === undefined) return;
  if (
    !isRecord(value) || !isOptionalNonNegativeNumber(value.amount) ||
    !isOptionalString(value.currency)
  ) {
    throw new Error("Adapter returned malformed cost telemetry.");
  }
}

function assertAvailability(value: unknown, field: string): void {
  if (value === undefined) return;
  if (
    !isString(value) || !["unavailable", "partial", "final"].includes(value)
  ) {
    throw new Error(`Adapter returned an invalid ${field}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}

function hasNullableString(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return Object.hasOwn(value, key) &&
    (value[key] === null || isString(value[key]));
}

function isOptionalInteger(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "number" && Number.isInteger(value));
}

function hasNullablePositiveInteger(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  return Object.hasOwn(value, key) && (candidate === null ||
    (typeof candidate === "number" && Number.isInteger(candidate) &&
      candidate > 0));
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0);
}
