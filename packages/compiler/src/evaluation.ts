import type {
  PurposeRetrievalResult,
  ResolvedComponent,
} from "@qoherent/sigil-core";
import { validateAgentEvaluationRequest } from "./evaluation-request.ts";
import type {
  AgentEvaluationRequest,
  AgentEvaluationTarget,
  CompilationReport,
  CompilationTarget,
  CompileOptions,
} from "./types.ts";

export type CompilationEvaluationRunner = (
  workspacePath: string,
  target: CompilationTarget,
  profileName: string,
  options: CompileOptions,
) => Promise<CompilationReport>;

/**
 * The session-facing evaluation boundary. It keeps the session independent of
 * the public one-shot compiler signature while preserving the injected runner
 * used by tests and host integrations.
 */
// @sigil implements packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::CompilationEvaluation interface
export async function evaluateCompilation(
  runner: CompilationEvaluationRunner,
  workspacePath: string,
  target: CompilationTarget,
  profileName: string,
  options: CompileOptions,
): Promise<CompilationReport> {
  return await runner(workspacePath, target, profileName, options);
}

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
