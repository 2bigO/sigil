import { isAbsolute, relative, resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import type {
  API,
  Diagnostic,
  NodeHandle,
  Project,
} from "typescript7/unstable/async";
import {
  isCallExpression,
  isElementAccessExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
  type Node,
  type SourceFile,
  SyntaxKind,
} from "typescript7/unstable/ast";
import { digest } from "./turtle.ts";

const isStringLiteralLike = (node: Node) =>
  isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node);

export interface CodeLocation {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
}
export interface TypeScriptDependency extends CodeLocation {
  readonly specifier: string;
  readonly resolvedFile?: string;
  readonly typeOnly: boolean;
}
export interface TypeScriptCall extends CodeLocation {
  readonly expression: string;
  readonly kind: "call" | "construct";
  readonly declaration?: CodeLocation;
  readonly declarationKind?: number;
  readonly symbol?: string;
  /** A bare global path only when its root has no lexical declaration. */
  readonly global?: string;
}
export interface TypeScriptIssue extends CodeLocation {
  readonly reason:
    | "computed-import"
    | "computed-access"
    | "unresolved-call"
    | "external-call";
}
export interface TypeScriptAnalysis {
  readonly analyzer: "typescript@7.0.2";
  readonly fingerprint: string;
  readonly files: readonly {
    readonly file: string;
    readonly fingerprint: string;
    readonly declaration: boolean;
  }[];
  readonly dependencies: readonly TypeScriptDependency[];
  readonly calls: readonly TypeScriptCall[];
  readonly issues: readonly TypeScriptIssue[];
  readonly diagnostics: readonly Diagnostic[];
}
export interface TypeScriptAnalysisOptions {
  readonly root: string;
  readonly project: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

function pathIn(root: string, file: string): string {
  const path = relative(root, file);
  return (path.startsWith("..") || isAbsolute(path) ? file : path).replaceAll(
    "\\",
    "/",
  );
}
function location(root: string, node: Node): CodeLocation {
  const source = node.getSourceFile();
  const start = node.getStart(source);
  const { line, character } = source.getLineAndCharacterOfPosition(start);
  return {
    file: pathIn(root, source.fileName),
    start,
    end: node.end,
    line: line + 1,
    column: character + 1,
  };
}
async function resolveHandle(
  root: string,
  handle?: NodeHandle,
): Promise<CodeLocation | undefined> {
  const node = await handle?.resolve();
  return node ? location(root, node) : undefined;
}
function globalPath(node: Node): { root: Node; text: string } | undefined {
  if (isIdentifier(node)) return { root: node, text: node.text };
  if (isPropertyAccessExpression(node)) {
    const parent = globalPath(node.expression);
    return parent
      ? { root: parent.root, text: `${parent.text}.${node.name.text}` }
      : undefined;
  }
  return undefined;
}

async function inspectProject(
  root: string,
  project: Project,
  check: () => void,
): Promise<TypeScriptAnalysis> {
  const files: TypeScriptAnalysis["files"][number][] = [];
  const dependencies: TypeScriptDependency[] = [];
  const calls: TypeScriptCall[] = [];
  const issues: TypeScriptIssue[] = [];
  const inputs: { file: string; text: string }[] = [];
  const sourceFiles: SourceFile[] = [];
  for (const name of [...await project.program.getSourceFileNames()].sort()) {
    check();
    const metadata = await project.program.getSourceFileMetadata(name);
    if (metadata?.isDefaultLibrary) continue;
    const source = await project.program.getSourceFile(name);
    if (!source) throw new Error(`TypeScript snapshot omitted ${name}.`);
    const file = pathIn(root, source.fileName);
    inputs.push({ file, text: source.text });
    files.push({
      file,
      fingerprint: await digest(source.text),
      declaration: source.isDeclarationFile,
    });
    if (!source.isDeclarationFile) sourceFiles.push(source);
  }
  const diagnostics = (await Promise.all([
    project.program.getConfigFileParsingDiagnostics(),
    project.program.getProgramDiagnostics(),
    project.program.getGlobalDiagnostics(),
    project.program.getSyntacticDiagnostics(),
    project.program.getBindDiagnostics(),
    project.program.getSemanticDiagnostics(),
  ])).flat();
  for (const source of sourceFiles) {
    const imports: { node: Node; typeOnly: boolean }[] = [];
    const callNodes: Node[] = [];
    const visit = (node: Node): void => {
      if (isImportDeclaration(node)) {
        imports.push({
          node: node.moduleSpecifier,
          typeOnly:
            node.importClause?.phaseModifier === SyntaxKind.TypeKeyword ||
            !!node.importClause?.namedBindings &&
              node.importClause.namedBindings.kind ===
                SyntaxKind.NamedImports &&
              node.importClause.namedBindings.elements.length > 0 &&
              node.importClause.namedBindings.elements.every((part) =>
                part.isTypeOnly
              ),
        });
      }
      if (isExportDeclaration(node) && node.moduleSpecifier) {
        imports.push({ node: node.moduleSpecifier, typeOnly: node.isTypeOnly });
      }
      if (
        isImportEqualsDeclaration(node) &&
        isExternalModuleReference(node.moduleReference)
      ) {
        imports.push({
          node: node.moduleReference.expression,
          typeOnly: node.isTypeOnly,
        });
      }
      if (isCallExpression(node) || isNewExpression(node)) {
        callNodes.push(node);
        if (
          node.expression.kind === SyntaxKind.ImportKeyword ||
          isIdentifier(node.expression) && node.expression.text === "require"
        ) {
          const target = node.arguments?.[0];
          if (target && isStringLiteralLike(target)) {
            imports.push({ node: target, typeOnly: false });
          } else {issues.push({
              ...location(root, node),
              reason: "computed-import",
            });}
        }
      }
      if (isElementAccessExpression(node)) {
        issues.push({ ...location(root, node), reason: "computed-access" });
      }
      node.forEachChild(visit);
    };
    visit(source);
    for (const imported of imports) {
      check();
      if (!isStringLiteralLike(imported.node)) {
        issues.push({
          ...location(root, imported.node),
          reason: "computed-import",
        });
        continue;
      }
      const symbol = await project.checker.getSymbolAtLocation(imported.node);
      const declaration = symbol?.declarations[0];
      dependencies.push({
        ...location(root, imported.node),
        specifier: imported.node.text,
        resolvedFile: declaration ? pathIn(root, declaration.path) : undefined,
        typeOnly: imported.typeOnly,
      });
    }
    for (const node of callNodes) {
      check();
      if (!isCallExpression(node) && !isNewExpression(node)) continue;
      const symbol = await project.checker.getSymbolAtLocation(node.expression);
      const signature = await project.checker.getResolvedSignature(node);
      const declaration = await resolveHandle(root, signature?.declaration);
      const path = globalPath(node.expression);
      const rootSymbol = path &&
        await project.checker.getSymbolAtLocation(path.root);
      const global = path && !rootSymbol ? path.text : undefined;
      calls.push({
        ...location(root, node),
        expression: node.expression.getText(source),
        kind: isNewExpression(node) ? "construct" : "call",
        declaration,
        declarationKind: signature?.declaration?.kind,
        symbol: symbol?.name,
        global,
      });
      if (!declaration) {
        issues.push({ ...location(root, node), reason: "unresolved-call" });
      } else if (
        !files.some((file) =>
          file.file === declaration.file && !file.declaration
        )
      ) issues.push({ ...location(root, node), reason: "external-call" });
    }
  }
  const uniqueDiagnostics = [...new Map(diagnostics.map((diagnostic) => {
    const value = {
      ...diagnostic,
      fileName: diagnostic.fileName
        ? pathIn(root, diagnostic.fileName)
        : undefined,
    };
    return [JSON.stringify(value), value];
  })).values()].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
  return {
    analyzer: "typescript@7.0.2",
    fingerprint: await digest(
      JSON.stringify({
        inputs,
        options: project.compilerOptions,
        analyzer: "typescript@7.0.2",
      }),
    ),
    files,
    dependencies,
    calls,
    issues,
    diagnostics: uniqueDiagnostics,
  };
}

/**
 * The pinned SDK owns native AST decoding and semantic queries. Its public close
 * method closes stdin but does not await exit. Keep this version-specific resource
 * access in one place so cancellation also reaps the native process.
 */
interface TypeScriptTransport {
  process?: ChildProcess;
  connection?: { dispose(): void };
  close(): Promise<void>;
}
function transport(api: API): TypeScriptTransport {
  const value = (api as unknown as { client?: TypeScriptTransport }).client;
  if (!value || typeof value.close !== "function") {
    throw new Error("Incompatible TypeScript 7 API transport.");
  }
  return value;
}

export async function analyzeTypeScript7(
  options: TypeScriptAnalysisOptions,
): Promise<TypeScriptAnalysis> {
  options.signal?.throwIfAborted();
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  ) throw new Error("Invalid TypeScript analysis timeout.");
  // Lazy loading keeps plain Turtle compilation independent of the SDK's Node
  // environment access. Preload the process module before installing cancellation.
  const [{ API }] = await Promise.all([
    import("typescript7/unstable/async"),
    import("node:child_process"),
  ]);
  options.signal?.throwIfAborted();
  const root = resolve(options.root);
  const api = new API({ cwd: root });
  const client = transport(api);
  const timeout = new AbortController();
  const timer = setTimeout(
    () =>
      timeout.abort(
        new DOMException("TypeScript 7 analysis timed out.", "TimeoutError"),
      ),
    timeoutMs,
  );
  const signal = AbortSignal.any([
    timeout.signal,
    ...(options.signal ? [options.signal] : []),
  ]);
  const stop = () => {
    client.connection?.dispose();
    client.process?.stdin?.destroy();
    try {
      client.process?.kill("SIGKILL");
    } catch { /* already exited */ }
  };
  signal.addEventListener("abort", stop, { once: true });
  let succeeded = false;
  try {
    const snapshot = await api.updateSnapshot({
      openProjects: [resolve(root, options.project)],
    });
    signal.throwIfAborted();
    const project = snapshot.getProject(resolve(root, options.project));
    if (!project) {
      throw new Error("TypeScript 7 did not open the requested project.");
    }
    const result = await inspectProject(
      root,
      project,
      () => signal.throwIfAborted(),
    );
    signal.throwIfAborted();
    succeeded = true;
    return result;
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    const child = client.process;
    const closed = child && child.exitCode === null && child.signalCode === null
      ? new Promise<void>((resolve) => child.once("close", () => resolve()))
      : Promise.resolve();
    if (!succeeded) stop();
    try {
      await api.close();
    } catch {
      stop();
      await client.close();
    }
    const killTimer = setTimeout(() => {
      try {
        child?.kill("SIGKILL");
      } catch { /* exited */ }
    }, 1000);
    try {
      await closed;
    } finally {
      clearTimeout(killTimer);
    }
  }
}
