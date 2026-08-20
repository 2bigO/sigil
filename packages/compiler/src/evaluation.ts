import type {
  PurposeRetrievalResult,
  ResolvedComponent,
} from "@qoherent/sigil-core";
import { deriveEvaluatorRetrievalBrief } from "./evaluator-retrieval.ts";
import { validateAgentEvaluationRequest } from "./evaluation-request.ts";
import type {
  AgentEvaluationRequest,
  AgentEvaluationTarget,
  CompilationEvaluationResult,
  CompilationReport,
  CompilationTarget,
  CompileOptions,
} from "./types.ts";
import type { CompilationEventWriter } from "./event-writer.ts";

export type CompilationEvaluationRunner = (
  workspacePath: string,
  target: CompilationTarget,
  profileName: string,
  options: CompileOptions,
) => Promise<CompilationReport | CompilationEvaluationResult>;

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
  eventWriter: CompilationEventWriter,
  runId: string,
): Promise<CompilationEvaluationResult> {
  return await runner(workspacePath, target, profileName, {
    ...options,
    disableHistory: true,
    internalEvaluation: true,
    eventWriter,
    runId,
  } as CompileOptions) as CompilationEvaluationResult;
}

// @sigil implements packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::EvaluationContext logic,constraints,cases
export async function compilationEvaluationTarget(
  component: ResolvedComponent,
  root: string,
  retrieval: PurposeRetrievalResult,
): Promise<AgentEvaluationTarget> {
  const retrievalBrief = await deriveEvaluatorRetrievalBrief(retrieval, root);
  return {
    componentName: component.name,
    sigilFile: canonicalWorkspacePath(component.filePath, root),
    initialPaths: retrievalBrief.allowedDirectReadPaths,
    retrieval,
    retrievalBrief,
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
      retrievalBrief: request.target.retrievalBrief && Object.freeze({
        ...request.target.retrievalBrief,
        allowedDirectReadPaths: Object.freeze([
          ...request.target.retrievalBrief.allowedDirectReadPaths,
        ]),
      }),
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
