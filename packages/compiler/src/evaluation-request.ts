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
  const serialized = JSON.stringify(
    request,
    (_key, value) => value instanceof AbortSignal ? undefined : value,
  );
  if (serialized.length > request.limits.maxInitialRequestChars) {
    throw new Error(
      `Agent request is ${serialized.length} characters, exceeding the ${request.limits.maxInitialRequestChars}-character transport limit.`,
    );
  }
}

// @sigil implements packages/compiler/src/evaluation-request.sigil::SigilAgentEvaluationRequest::AgentEvaluationResult interface,constraints,cases
export function validateAgentEvaluationResult(
  request: AgentEvaluationRequest,
  result: AgentEvaluationResult,
): AgentEvaluationResult {
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
