import type {
  PurposeRetrievalResult,
  ResolvedComponent,
} from "@qoherent/sigil-core";
import { validateAgentEvaluationRequest } from "./evaluation-request.ts";
import type { AgentEvaluationRequest, AgentEvaluationTarget } from "./types.ts";

// @sigil implements packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::EvaluationContext logic,constraints,cases
export function compilationEvaluationTarget(
  component: ResolvedComponent,
  root: string,
  retrieval: PurposeRetrievalResult,
): AgentEvaluationTarget {
  const initialPaths = new Set([
    component.filePath,
    ...retrieval.evidence.flatMap((item) => item.path ? [item.path] : []),
  ].map((path) => canonicalWorkspacePath(path, root)));
  return {
    componentName: component.name,
    sigilFile: canonicalWorkspacePath(component.filePath, root),
    initialPaths: [...initialPaths],
    retrieval,
  };
}

// @sigil implements packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::EvaluationContext interface,logic,constraints,cases
export function buildAgentEvaluationRequest(
  request: AgentEvaluationRequest,
): AgentEvaluationRequest {
  validateAgentEvaluationRequest(request);
  return Object.freeze({
    ...request,
    target: Object.freeze({
      ...request.target,
      initialPaths: Object.freeze([...request.target.initialPaths]),
    }),
  });
}

function canonicalWorkspacePath(path: string, root: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+/g, "/");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  if (
    normalizedRoot !== "." &&
    (normalized === normalizedRoot ||
      normalized.startsWith(`${normalizedRoot}/`))
  ) return normalized.slice(normalizedRoot.length).replace(/^\//, "") || ".";
  return normalized.replace(/^\.\//, "");
}
