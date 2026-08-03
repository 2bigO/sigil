import {
  agentDependencyContextFor,
  type ResolvedComponent,
  type ResolvedSigilWorkspace,
} from "@qoherent/sigil-core";
import type { AgentEvaluationTarget } from "./types.ts";

// @sigil implements packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::EvaluationContext logic,constraints,cases
export function compilationEvaluationTarget(
  resolved: ResolvedSigilWorkspace,
  component: ResolvedComponent,
  root: string,
): AgentEvaluationTarget {
  const dependencyContext = agentDependencyContextFor(resolved, component.name);
  const initialPaths = new Set([
    component.filePath,
    ...component.expansions.expands.map((item) => item.filePath),
    ...(dependencyContext?.relatedFilePaths ?? []),
  ].map((path) => canonicalWorkspacePath(path, root)));
  return {
    componentName: component.name,
    sigilFile: canonicalWorkspacePath(component.filePath, root),
    initialPaths: [...initialPaths],
  };
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
