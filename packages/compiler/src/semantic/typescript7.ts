import { isAbsolute, relative, resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import type {
  API,
  Diagnostic,
  NodeHandle,
  Project,
} from "typescript7/unstable/async";
import {
  isArrowFunction,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isElementAccessExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isMethodDeclaration,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableDeclaration,
  type Node,
  type SourceFile,
  SyntaxKind,
} from "typescript7/unstable/ast";
import { digest } from "./turtle.ts";
import { resolveSemanticRuntime } from "./runtime.ts";

const isStringLiteralLike = (node: Node) =>
  isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node);
export const TYPESCRIPT_EXTRACTOR_VERSION = 3 as const;

export interface CodeLocation {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
}
export interface TypeScriptDependency extends CodeLocation {
  readonly caller: string;
  readonly specifier: string;
  readonly resolvedFile?: string;
  readonly typeOnly: boolean;
}
export interface TypeScriptCall extends CodeLocation {
  readonly expression: string;
  readonly kind: "call" | "construct";
  readonly caller: string;
  readonly declaration?: CodeLocation;
  readonly declarationKind?: number;
  readonly symbol?: string;
  /** Export identity after native alias resolution. */
  readonly targetSymbol?: string;
  /** A global path with no local declaration (ambient declarations are allowed). */
  readonly global?: string;
}
export interface TypeScriptSymbol extends CodeLocation {
  readonly id: string;
  readonly selector: string;
  readonly name: string;
  readonly kind: "module" | "function";
}
export interface TypeScriptIssue extends CodeLocation {
  readonly reason:
    | "computed-import"
    | "computed-access"
    | "unresolved-call"
    | "indirect-call"
    | "external-call";
}
export interface TypeScriptAnalysis {
  readonly analyzer: "typescript@7.0.2";
  readonly extractorVersion: typeof TYPESCRIPT_EXTRACTOR_VERSION;
  readonly fingerprint: string;
  readonly files: readonly {
    readonly file: string;
    readonly fingerprint: string;
    readonly declaration: boolean;
  }[];
  readonly dependencies: readonly TypeScriptDependency[];
  readonly calls: readonly TypeScriptCall[];
  readonly symbols: readonly TypeScriptSymbol[];
  readonly issues: readonly TypeScriptIssue[];
  readonly diagnostics: readonly Diagnostic[];
  readonly runtimeManifestHash?: string;
}
export interface TypeScriptAnalysisOptions {
  readonly root: string;
  readonly project: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly runtimeDirectory?: string;
}

function pathIn(root: string, file: string): string {
  const path = relative(root, file).replaceAll("\\", "/");
  return (path === ".." || path.startsWith("../") || isAbsolute(path)
    ? file
    : path).replaceAll(
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
  aliasFlag: number,
): Promise<TypeScriptAnalysis> {
  const files: TypeScriptAnalysis["files"][number][] = [];
  const dependencies: TypeScriptDependency[] = [];
  const calls: TypeScriptCall[] = [];
  const symbols: TypeScriptSymbol[] = [];
  const issues: TypeScriptIssue[] = [];
  const inputs: { file: string; text: string }[] = [];
  const sourceFiles: SourceFile[] = [];
  let inputChars = 0;
  for (const name of [...await project.program.getSourceFileNames()].sort()) {
    check();
    const metadata = await project.program.getSourceFileMetadata(name);
    if (metadata?.isDefaultLibrary) continue;
    const source = await project.program.getSourceFile(name);
    if (!source) throw new Error(`TypeScript snapshot omitted ${name}.`);
    const file = pathIn(root, source.fileName);
    inputChars += source.text.length;
    if (files.length >= 10_000 || inputChars > 32 * 1024 * 1024) {
      throw new Error(
        "TypeScript analysis exceeds its file or source size limit.",
      );
    }
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
    const imports: {
      node: Node;
      typeOnly: boolean;
      caller: string;
      loader?: Node;
    }[] = [];
    const callNodes: Node[] = [];
    const callers = new Map<Node, string>();
    const functionScopes = new Map<Node, string>();
    const candidates: {
      node: Node;
      name: Node;
      selector: string;
      id: string;
    }[] = [];
    const sourcePath = pathIn(root, source.fileName);
    const sourceHash = files.find((f) => f.file === sourcePath)!.fingerprint;
    const symbolId = (node: Node) =>
      `urn:sigil:code:${encodeURIComponent(sourcePath)}:${sourceHash}:${
        node.getStart(source)
      }:${node.end}`;
    const moduleId = symbolId(source);
    symbols.push({
      ...location(root, source),
      id: moduleId,
      selector: "$module",
      name: sourcePath,
      kind: "module",
    });
    let nodeCount = 0;
    const visit = (
      node: Node,
      caller = moduleId,
      qualifier: readonly string[] = [],
    ): void => {
      if (++nodeCount > 200_000) {
        throw new Error("TypeScript source exceeds its AST node limit.");
      }
      if ((isClassDeclaration(node) || isClassExpression(node)) && node.name) {
        qualifier = [...qualifier, node.name.text];
      }
      const named =
        ((isFunctionDeclaration(node) || isMethodDeclaration(node)) &&
            node.body) ||
          (isVariableDeclaration(node) && node.initializer &&
            (isArrowFunction(node.initializer) ||
              isFunctionExpression(node.initializer)))
          ? node
          : undefined;
      if (
        named &&
        (isFunctionDeclaration(named) || isMethodDeclaration(named) ||
          isVariableDeclaration(named)) &&
        named.name && isIdentifier(named.name)
      ) {
        caller = symbolId(named);
        qualifier = [...qualifier, named.name.text];
        candidates.push({
          node: named,
          name: named.name,
          selector: qualifier.join("."),
          id: caller,
        });
        if (isVariableDeclaration(named) && named.initializer) {
          functionScopes.set(named.initializer, caller);
        }
      } else if (isArrowFunction(node) || isFunctionExpression(node)) {
        // Anonymous callbacks are distinct callers; their bodies cannot support
        // a receipt naming an enclosing function merely by range containment.
        caller = functionScopes.get(node) ?? symbolId(node);
      } else if (
        [
          SyntaxKind.FunctionDeclaration,
          SyntaxKind.MethodDeclaration,
          SyntaxKind.Constructor,
          SyntaxKind.GetAccessor,
          SyntaxKind.SetAccessor,
        ].includes(node.kind)
      ) {
        // Unsupported or unnamed callable selectors still form separate scopes.
        caller = symbolId(node);
      }
      if (isImportDeclaration(node)) {
        imports.push({
          node: node.moduleSpecifier,
          caller,
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
        imports.push({
          node: node.moduleSpecifier,
          typeOnly: node.isTypeOnly,
          caller,
        });
      }
      if (
        isImportEqualsDeclaration(node) &&
        isExternalModuleReference(node.moduleReference)
      ) {
        imports.push({
          node: node.moduleReference.expression,
          caller,
          typeOnly: node.isTypeOnly,
        });
      }
      if (isCallExpression(node) || isNewExpression(node)) {
        callNodes.push(node);
        callers.set(node, caller);
        if (
          node.expression.kind === SyntaxKind.ImportKeyword ||
          isIdentifier(node.expression) && node.expression.text === "require"
        ) {
          const target = node.arguments?.[0];
          imports.push({
            node: target ?? node,
            caller,
            typeOnly: false,
            loader: isIdentifier(node.expression) ? node.expression : undefined,
          });
        }
      }
      if (isElementAccessExpression(node)) {
        issues.push({ ...location(root, node), reason: "computed-access" });
      }
      node.forEachChild((child) => visit(child, caller, qualifier));
    };
    visit(source);
    for (const candidate of candidates) {
      check();
      const native = await project.checker.getSymbolAtLocation(candidate.name);
      if (native) {
        symbols.push({
          ...location(root, candidate.node),
          id: candidate.id,
          selector: candidate.selector,
          name: native.name,
          kind: "function",
        });
      }
    }
    for (const imported of imports) {
      check();
      if (imported.loader) {
        const loader = await project.checker.getSymbolAtLocation(
          imported.loader,
        );
        if (
          loader?.declarations.some((declaration) =>
            files.some((file) =>
              file.file === pathIn(root, declaration.path) && !file.declaration
            )
          )
        ) continue;
      }
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
        caller: imported.caller,
        specifier: imported.node.text,
        resolvedFile: declaration ? pathIn(root, declaration.path) : undefined,
        typeOnly: imported.typeOnly,
      });
    }
    for (const node of callNodes) {
      check();
      if (!isCallExpression(node) && !isNewExpression(node)) continue;
      const symbol = await project.checker.getSymbolAtLocation(node.expression);
      const targetSymbol = symbol && (symbol.flags & aliasFlag)
        ? await project.checker.getAliasedSymbol(symbol)
        : symbol;
      const signature = await project.checker.getResolvedSignature(node);
      const declaration = await resolveHandle(root, signature?.declaration);
      const path = globalPath(node.expression);
      const rootSymbol = path &&
        await project.checker.getSymbolAtLocation(path.root);
      const global =
        path && (!rootSymbol || rootSymbol.declarations.length > 0 &&
              rootSymbol.declarations.every((declaration) =>
                /\.d\.[cm]?ts$/.test(declaration.path)
              ))
          ? path.text
          : undefined;
      calls.push({
        ...location(root, node),
        expression: node.expression.getText(source),
        kind: isNewExpression(node) ? "construct" : "call",
        caller: callers.get(node)!,
        declaration,
        declarationKind: signature?.declaration?.kind,
        symbol: symbol?.name,
        targetSymbol: targetSymbol?.name,
        global,
      });
      if (!declaration) {
        issues.push({ ...location(root, node), reason: "unresolved-call" });
      } else if (
        [
          SyntaxKind.FunctionType,
          SyntaxKind.ConstructorType,
          SyntaxKind.CallSignature,
          SyntaxKind.ConstructSignature,
        ].includes(signature!.declaration!.kind)
      ) {
        issues.push({ ...location(root, node), reason: "indirect-call" });
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
    extractorVersion: TYPESCRIPT_EXTRACTOR_VERSION,
    fingerprint: await digest(
      JSON.stringify({
        inputs,
        options: project.compilerOptions,
        analyzer: "typescript@7.0.2",
        extractorVersion: TYPESCRIPT_EXTRACTOR_VERSION,
      }),
    ),
    files,
    dependencies,
    calls,
    symbols,
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
  const [{ API, SymbolFlags }] = await Promise.all([
    import("typescript7/unstable/async"),
    import("node:child_process"),
  ]);
  options.signal?.throwIfAborted();
  const root = resolve(options.root);
  const runtime = await resolveSemanticRuntime({
    runtimeDirectory: options.runtimeDirectory,
  });
  const api = new API({
    cwd: root,
    ...(runtime.typescriptExecutable
      ? { tsserverPath: runtime.typescriptExecutable }
      : {}),
  });
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
      SymbolFlags.Alias,
    );
    signal.throwIfAborted();
    succeeded = true;
    return {
      ...result,
      runtimeManifestHash: runtime.manifestHash,
    };
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
    const killTimer = setTimeout(stop, 1000);
    try {
      try {
        await api.close();
      } catch {
        stop();
        await client.close();
      }
      await closed;
    } finally {
      clearTimeout(killTimer);
    }
  }
}
