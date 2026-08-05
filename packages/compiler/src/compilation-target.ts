import type {
  ResolvedComponent,
  ResolvedSigilWorkspace,
} from "@qoherent/sigil-core";
import { CompilerFailure } from "./status.ts";
import type { CompilationTarget } from "./types.ts";

// @sigil implements packages/compiler/src/compilation-target.sigil::SigilCompilationTarget::CompilationTarget interface,logic,cases
export function resolveCompilationTarget(
  resolved: ResolvedSigilWorkspace,
  target: CompilationTarget,
  root: string,
): readonly ResolvedComponent[] {
  const selected = target.kind === "workspace"
    ? resolved.components
    : selectExplicitTarget(resolved.components, target, root);
  if (
    target.kind === "component" && !target.declarationPath &&
    selected.length > 1
  ) {
    throw invalid(
      `Component target ${JSON.stringify(target.name)} is ambiguous.`,
    );
  }
  if (!selected.length) {
    const selector = target.kind === "component"
      ? target.name
      : target.kind === "workspace"
      ? ""
      : target.filePath;
    throw invalid(
      `No component matched ${target.kind}${
        target.kind === "workspace" ? "" : ` ${selector}`
      }.`,
    );
  }
  return dependencyOrder(resolved, selected);
}

export function canonicalWorkspacePath(path: string, root: string): string {
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

function selectExplicitTarget(
  components: readonly ResolvedComponent[],
  target: Exclude<CompilationTarget, { readonly kind: "workspace" }>,
  root: string,
): readonly ResolvedComponent[] {
  if (target.kind === "component") {
    assertNormalizedTargetPath(target.declarationPath);
    return components.filter((item) =>
      item.name === target.name &&
      (!target.declarationPath ||
        canonicalWorkspacePath(item.filePath, root) === target.declarationPath)
    );
  }
  assertNormalizedTargetPath(target.filePath);
  const file = canonicalWorkspacePath(target.filePath, root);
  if (target.kind === "file") {
    return components.filter((item) =>
      canonicalWorkspacePath(item.filePath, root) === file ||
      item.expansions.expands.some((expansion) =>
        canonicalWorkspacePath(expansion.filePath, root) === file
      )
    );
  }
  if (
    !Number.isSafeInteger(target.line) || target.line < 1 ||
    !Number.isSafeInteger(target.column) || target.column < 1
  ) {
    throw invalid("Location target line and column must be positive integers.");
  }
  const location = { line: target.line, column: target.column };
  return components.filter((item) =>
    (canonicalWorkspacePath(item.filePath, root) === file &&
      rangeContains(item.declaration.range, location)) ||
    item.expansions.expands.some((expansion) =>
      canonicalWorkspacePath(expansion.filePath, root) === file &&
      rangeContains(expansion.declaration.range, location)
    )
  );
}

function assertNormalizedTargetPath(path: string | undefined): void {
  if (path === undefined) return;
  if (
    !path || path.startsWith("/") || path.startsWith("\\") ||
    path.includes("\\") || path.split("/").some((part) => part === "..") ||
    path.startsWith("./") || path.includes("//")
  ) {
    throw invalid(
      `Compilation target path is not normalized and workspace-relative: ${
        JSON.stringify(path)
      }.`,
    );
  }
}

function rangeContains(
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  },
  location: { line: number; column: number },
): boolean {
  return (location.line > range.start.line ||
    (location.line === range.start.line &&
      location.column >= range.start.column)) &&
    (location.line < range.end.line ||
      (location.line === range.end.line && location.column < range.end.column));
}

function dependencyOrder(
  resolved: ResolvedSigilWorkspace,
  selected: readonly ResolvedComponent[],
): readonly ResolvedComponent[] {
  const selectedKeys = new Set(selected.map(componentKey));
  const ordered: ResolvedComponent[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (component: ResolvedComponent): void => {
    const key = componentKey(component);
    if (visited.has(key) || visiting.has(key)) return;
    visiting.add(key);
    for (
      const imported of resolved.imports.filter((item) =>
        item.sourceFile === component.filePath
      )
    ) {
      for (const name of imported.names) {
        const dependency = resolved.components.find((candidate) =>
          candidate.name === name.name &&
          candidate.filePath === name.componentFile
        );
        if (dependency && selectedKeys.has(componentKey(dependency))) {
          visit(dependency);
        }
      }
    }
    visiting.delete(key);
    visited.add(key);
    ordered.push(component);
  };
  for (const component of selected) visit(component);
  return ordered;
}

function componentKey(component: ResolvedComponent): string {
  return `${component.filePath}\0${component.name}`;
}

function invalid(message: string): CompilerFailure {
  return new CompilerFailure("COMPILER_INVALID_INVOCATION", message);
}
