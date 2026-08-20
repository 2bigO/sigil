import {
  projectRetrieval,
  type PurposeRetrievalResult,
  type RetrievalProjectionComponent,
} from "@qoherent/sigil-core";
import type { EvaluatorRetrievalBrief } from "./types.ts";

// @sigil implements packages/compiler/src/evaluator-retrieval.sigil::SigilEvaluatorRetrievalBrief::EvaluatorRetrievalBrief interface,logic,constraints,cases
export async function deriveEvaluatorRetrievalBrief(
  retrieval: PurposeRetrievalResult,
  root: string,
): Promise<EvaluatorRetrievalBrief> {
  const projection = await projectRetrieval(retrieval);
  const allowedDirectReadPaths = uniquePaths([
    retrieval.target.path,
    ...retrieval.evidence.flatMap((item) => item.path ? [item.path] : []),
  ], root);
  const sections = [
    `Retrieval: ${retrieval.fingerprint}`,
    `Target: ${
      retrieval.target.componentName ?? retrieval.target.path
    } (${retrieval.purpose})`,
    ...projection.components.map(renderComponent),
    renderDependencyGraph(retrieval),
    renderGlossary(projection.glossary),
    allowedDirectReadPaths.length === 0
      ? ""
      : `Allowed direct reads\n${
        allowedDirectReadPaths.map((path) => `- ${path}`).join("\n")
      }`,
  ].filter(Boolean);
  return Object.freeze({
    purpose: retrieval.purpose,
    componentName: retrieval.target.componentName ?? "",
    sigilFile: canonicalWorkspacePath(retrieval.target.path, root),
    retrievalFingerprint: retrieval.fingerprint,
    markdown: sections.join("\n\n"),
    allowedDirectReadPaths: Object.freeze(allowedDirectReadPaths),
  });
}

function renderComponent(component: RetrievalProjectionComponent): string {
  const lines = [
    `${
      component.role === "selected" ? "Component" : component.role
    }: ${component.name}`,
    `Source: ${component.path}`,
  ];
  appendItems(lines, "Goal", component.goal.map((item) => item.text));
  if (component.interface.length > 0) {
    lines.push("Interface");
    for (const concept of component.interface) {
      if (concept.name) lines.push(`- ${concept.name}`);
      for (const item of concept.items) lines.push(`  - ${item.text}`);
    }
  }
  if (component.role === "selected") {
    appendItems(lines, "State", component.state.map((item) => item.text));
    appendItems(lines, "Logic", component.logic.map((item) => item.text));
    appendItems(
      lines,
      "Constraints",
      component.constraints.map((item) => item.text),
    );
    appendItems(
      lines,
      "Decisions",
      component.decisions.map((item) => item.text),
    );
    appendItems(lines, "Cases", component.cases.map((item) => item.text));
  }
  return lines.join("\n");
}

function appendItems(
  lines: string[],
  label: string,
  items: readonly string[],
): void {
  if (items.length === 0) return;
  lines.push(label, ...items.map((item) => `- ${item}`));
}

function renderDependencyGraph(retrieval: PurposeRetrievalResult): string {
  const labels = new Map(
    retrieval.graph.nodes.flatMap((node) =>
      node.componentName
        ? [[node.identity, `${node.componentName} (${node.path})`] as const]
        : []
    ),
  );
  const groups = new Map<
    string,
    { source: string; relation: string; targets: string[] }
  >();
  for (const edge of retrieval.graph.edges) {
    const source = labels.get(edge.sourceIdentity);
    const target = labels.get(edge.targetIdentity);
    if (!source || !target) continue;
    const key = `${source}\0${edge.relation}`;
    const group = groups.get(key) ??
      { source, relation: edge.relation, targets: [] };
    group.targets.push(target);
    groups.set(key, group);
  }
  if (groups.size === 0) return "";
  return `Dependency graph\n${
    [...groups.values()].map((group) =>
      `- ${group.source} --${group.relation}--> ${group.targets.join(", ")}`
    ).join("\n")
  }`;
}

function renderGlossary(
  glossary: readonly { readonly term: string; readonly definition: string }[],
): string {
  if (glossary.length === 0) return "";
  return `Glossary\n${
    glossary.map((entry) => `- ${entry.term}: ${entry.definition}`).join("\n")
  }`;
}

function uniquePaths(paths: readonly string[], root: string): string[] {
  return [...new Set(paths.map((path) => canonicalWorkspacePath(path, root)))];
}

function canonicalWorkspacePath(path: string, root: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+/g, "/");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  if (
    normalizedRoot !== "." &&
    (normalized === normalizedRoot ||
      normalized.startsWith(`${normalizedRoot}/`))
  ) {
    return normalized.slice(normalizedRoot.length).replace(/^\//, "") || ".";
  }
  return normalized.replace(/^\.\//, "");
}
