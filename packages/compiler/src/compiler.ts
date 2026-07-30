import {
  agentDependencyContextFor,
  componentContracts,
  glossaryContextForFiles,
  type ImplementationSource,
  isSupportedImplementationSource,
  loadSigilWorkspace,
  ownedImplementationTargetsFor,
  type ResolvedComponent,
  type ResolvedSigilWorkspace,
  resolveSigilWorkspace,
  type SigilDiagnostic,
  type SigilFileSystem,
} from "@qoherent/sigil-core";
import metadata from "../deno.json" with { type: "json" };
import { ClaudeAdapter, CodexAdapter } from "./adapters.ts";
import type {
  AgentAdapter,
  AgentFinding,
  CompilationColor,
  CompilationEvent,
  CompilationReport,
  CompilationTarget,
  CompileConfiguration,
  CompileOptions,
  CompilerDiagnostic,
  EffectiveProfile,
  StageReport,
} from "./types.ts";

interface StageDefinition {
  readonly id: string;
  readonly required: boolean;
  readonly agentic: boolean;
  readonly dependencies: readonly string[];
  readonly skill: string;
}

interface PreparedComponentContext {
  readonly componentName: string;
  readonly serialized: string;
}

const MAX_COMPILATION_CONTEXT_CHARS = 900_000;

const STAGES: readonly StageDefinition[] = [
  {
    id: "deterministic-foundation",
    required: true,
    agentic: false,
    dependencies: [],
    skill: "sigil-core",
  },
  {
    id: "semantic-readiness",
    required: true,
    agentic: true,
    dependencies: ["deterministic-foundation"],
    skill:
      "Find ambiguous, contradictory, or rationale-incomplete contract statements.",
  },
  {
    id: "architecture-design",
    required: true,
    agentic: true,
    dependencies: ["semantic-readiness"],
    skill:
      "Evaluate component boundaries, dependency direction, cohesion, and design risks.",
  },
  {
    id: "current-code-compatibility",
    required: true,
    agentic: true,
    dependencies: ["architecture-design"],
    skill:
      "Evaluate whether the contract is coherent with referenced implementation ownership and repository evidence.",
  },
  {
    id: "standards-risk",
    required: true,
    agentic: true,
    dependencies: ["architecture-design"],
    skill:
      "Evaluate applicable standards, safety, security, reliability, and operational risks from supplied evidence.",
  },
];

class DenoReadOnlyFileSystem implements SigilFileSystem {
  readTextFile(path: string): Promise<string> {
    return Deno.readTextFile(path);
  }
  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  }
  async listFiles(root: string): Promise<readonly string[]> {
    const files: string[] = [];
    async function visit(path: string): Promise<void> {
      const stat = await Deno.stat(path);
      if (stat.isFile) {
        files.push(path.replaceAll("\\", "/"));
        return;
      }
      if (!stat.isDirectory) return;
      for await (const entry of Deno.readDir(path)) {
        if (
          entry.isSymlink ||
          [".git", ".deno", ".vscode-test", "node_modules", "build", "coverage"]
            .includes(entry.name)
        ) {
          continue;
        }
        await visit(`${path}/${entry.name}`);
      }
    }
    await visit(root);
    return files.sort();
  }
}

// @sigil implements packages/compiler/#module.sigil::SigilCompiler interface,logic,constraints,cases
export async function compile(
  workspacePath: string,
  target: CompilationTarget = { kind: "workspace" },
  options: CompileOptions = {},
): Promise<CompilationReport> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let sequence = 0;
  const emit = async (
    type: CompilationEvent["type"],
    payload: Readonly<Record<string, unknown>>,
  ) => {
    await options.onEvent?.({
      protocolVersion: 1,
      runId,
      sequence: ++sequence,
      type,
      payload,
    });
  };
  await emit("started", { workspacePath, target });

  const fs = new DenoReadOnlyFileSystem();
  const workspace = await loadSigilWorkspace(fs, {
    startPath: workspacePath,
    explicitRoot: workspacePath,
    currentDirectory: Deno.cwd(),
  });
  const resolved = resolveSigilWorkspace(workspace);
  const configuration = parseConfiguration(workspace.config?.tools.compile);
  const profile = await effectiveProfile(
    options.profile ?? configuration.defaultProfile ?? "standard",
    configuration,
  );
  const adapter = options.adapter ?? adapterFrom(profile);
  const components = resolveTarget(resolved, target, workspace.root);
  const implementationSources = await loadImplementationSources(
    fs,
    workspace.root,
  );
  const componentContexts = prepareComponentContexts(
    resolved,
    components,
    implementationSources,
    workspace.root,
  );
  const sourceFingerprint = await digest(JSON.stringify({
    files: workspace.files.map((file) => file.document),
    components: components.map((item) => item.name),
  }));

  const diagnostics: CompilerDiagnostic[] = resolved.diagnostics.map((
    item,
  ) => fromCoreDiagnostic(item));
  const stageReports: StageReport[] = [];
  const failed = new Set<string>();

  for (const stage of profile.stages) {
    if (!stage.enabled) {
      failed.add(stage.id);
      stageReports.push({
        id: stage.id,
        required: stage.required,
        state: "disabled",
        evaluator: "none",
        diagnosticCount: 0,
      });
      continue;
    }
    if (stage.dependencies.some((dependency) => failed.has(dependency))) {
      failed.add(stage.id);
      stageReports.push({
        id: stage.id,
        required: stage.required,
        state: "skipped-by-dependency",
        evaluator: adapter?.id ?? "none",
        diagnosticCount: 0,
      });
      continue;
    }
    if (options.signal?.aborted) {
      await emit("cancelled", { stage: stage.id });
      throw new DOMException("Compilation cancelled.", "AbortError");
    }
    const stageStartedAt = new Date().toISOString();
    await emit("stage-started", { stage: stage.id });
    const before = diagnostics.length;
    let state: StageReport["state"] = "completed";
    try {
      if (stage.agentic) {
        if (!adapter) {
          throw new Error(
            "No compiler adapter is configured in tools.compile.adapter.",
          );
        }
        for (const prepared of componentContexts) {
          if (prepared.serialized.length > profile.contextBudgetChars) {
            throw new Error(
              `Compilation context for component ${prepared.componentName} is ${prepared.serialized.length} characters, exceeding the local ${profile.contextBudgetChars}-character agent-input budget.`,
            );
          }
          const findings = await adapter.evaluate({
            stage: stage.id,
            skill: STAGES.find((item) => item.id === stage.id)?.skill ?? "",
            context: prepared.serialized,
            signal: options.signal,
          });
          for (const finding of findings) {
            const diagnostic = await fromAgentFinding(
              stage.id,
              adapter,
              finding,
              prepared.componentName,
            );
            diagnostics.push(diagnostic);
            await emit("diagnostic", {
              componentName: prepared.componentName,
              diagnostic,
            });
          }
        }
      }
    } catch (error) {
      state = "failed";
      failed.add(stage.id);
      const diagnostic = await stageFailure(stage.id, adapter, error);
      diagnostics.push(diagnostic);
      await emit("diagnostic", { diagnostic });
    }
    const report: StageReport = {
      id: stage.id,
      required: stage.required,
      state,
      evaluator: stage.agentic ? adapter?.id ?? "unavailable" : "sigil-core",
      diagnosticCount: diagnostics.length - before,
      startedAt: stageStartedAt,
      completedAt: new Date().toISOString(),
    };
    stageReports.push(report);
    await emit("stage-completed", { stage: report });
  }

  const status = colorFor(diagnostics, stageReports);
  const report: CompilationReport = {
    reportVersion: 1,
    runId,
    workspaceRoot: workspace.root,
    target,
    componentNames: components.map((item) => item.name),
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceFingerprint,
    profile,
    stages: stageReports,
    diagnostics,
  };
  if (options.output) {
    await Deno.writeTextFile(
      options.output,
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  await emit("completed", { report });
  return report;
}

function prepareComponentContexts(
  resolved: ResolvedSigilWorkspace,
  components: readonly ResolvedComponent[],
  implementationSources: readonly ImplementationSource[],
  workspaceRoot: string,
): readonly PreparedComponentContext[] {
  const contracts = new Map(
    componentContracts(resolved).map((contract) => [contract.name, contract]),
  );
  return components.map((component) => {
    const dependencyContext = agentDependencyContextFor(
      resolved,
      component.name,
    );
    const ownership = ownedImplementationTargetsFor(
      resolved,
      implementationSources,
      component.name,
    );
    const importerContracts = affectedImporterContracts(
      resolved,
      component,
      contracts,
    );
    const relevantFiles = [
      component.filePath,
      ...component.expansions.expands.map((item) => item.filePath),
      ...(dependencyContext?.relatedFilePaths ?? []),
      ...importerContracts.map((item) => item.filePath),
      ...(ownership?.targets.map((item) => item.filePath) ?? []),
    ];
    const glossary = compactGlossaryContext(
      glossaryContextForFiles(resolved.glossary, relevantFiles),
    );
    const ownedPaths = new Set(
      ownership?.targets.map((target) =>
        canonicalWorkspacePath(target.filePath, workspaceRoot)
      ) ?? [],
    );
    const ownedSources = implementationSources
      .filter((source) =>
        ownedPaths.has(canonicalWorkspacePath(source.filePath, workspaceRoot))
      )
      .map((source) => ({
        filePath: canonicalWorkspacePath(source.filePath, workspaceRoot),
        text: source.text,
      }));
    const base = {
      schemaVersion: 1,
      component: contracts.get(component.name),
      expansions: component.expansions.expands,
      directDependencies: dependencyContext?.dependencyContracts ?? [],
      dependencyDecisions: dependencyContext?.dependencyDecisions ?? [],
      affectedImporters: importerContracts,
      glossary,
      ownedImplementation: ownership
        ? {
          targets: ownership.targets,
          diagnostics: ownership.diagnostics,
        }
        : null,
    };
    return {
      componentName: component.name,
      serialized: serializeWithBoundedSources(base, ownedSources),
    };
  });
}

function affectedImporterContracts(
  resolved: ResolvedSigilWorkspace,
  selected: ResolvedComponent,
  contracts: ReadonlyMap<string, ReturnType<typeof componentContracts>[number]>,
): readonly ReturnType<typeof componentContracts>[number][] {
  const importerFiles = new Set(
    resolved.imports
      .filter((item) =>
        item.names.some((name) =>
          name.name === selected.name &&
          name.componentFile === selected.filePath
        )
      )
      .map((item) => item.sourceFile),
  );
  const seen = new Set<string>();
  return resolved.components.flatMap((component) => {
    const contract = contracts.get(component.name);
    const key = `${component.filePath}\0${component.name}`;
    if (
      !contract || !importerFiles.has(component.filePath) || seen.has(key)
    ) {
      return [];
    }
    seen.add(key);
    return [contract];
  });
}

function compactGlossaryContext(
  glossary: ReturnType<typeof glossaryContextForFiles>,
): Readonly<Record<string, unknown>> {
  return {
    glossaryPath: glossary.glossaryPath,
    terms: glossary.terms,
    resolvedContexts: glossary.resolvedContexts.map((context) => ({
      filePath: context.filePath,
      contextId: context.contextId,
      terms: context.entries.map((term) => term.term),
    })),
    occurrences: glossary.occurrences.map((occurrence) => ({
      term: occurrence.term.term,
      matchedSpelling: occurrence.matchedSpelling,
      filePath: occurrence.filePath,
      ownerKind: occurrence.ownerKind,
      ownerName: occurrence.ownerName,
      sectionName: occurrence.sectionName,
      range: occurrence.range,
    })),
  };
}

function serializeWithBoundedSources(
  base: Readonly<Record<string, unknown>>,
  sources: readonly { readonly filePath: string; readonly text: string }[],
): string {
  const included: {
    filePath: string;
    text: string;
    omittedCharacters?: number;
  }[] = [];
  const serialize = () =>
    JSON.stringify({ ...base, ownedImplementationSources: included });

  let serialized = serialize();
  if (serialized.length > MAX_COMPILATION_CONTEXT_CHARS) return serialized;

  for (const source of sources) {
    included.push({ ...source });
    const complete = serialize();
    if (complete.length <= MAX_COMPILATION_CONTEXT_CHARS) {
      serialized = complete;
      continue;
    }
    included.pop();
    let lower = 0;
    let upper = source.text.length;
    let best = "";
    while (lower <= upper) {
      const middle = Math.floor((lower + upper) / 2);
      included.push({
        filePath: source.filePath,
        text: source.text.slice(0, middle),
        omittedCharacters: source.text.length - middle,
      });
      const candidate = serialize();
      included.pop();
      if (candidate.length <= MAX_COMPILATION_CONTEXT_CHARS) {
        best = source.text.slice(0, middle);
        serialized = candidate;
        lower = middle + 1;
      } else {
        upper = middle - 1;
      }
    }
    if (best.length > 0) {
      included.push({
        filePath: source.filePath,
        text: best,
        omittedCharacters: source.text.length - best.length,
      });
      serialized = serialize();
    }
    break;
  }
  return serialized;
}

async function loadImplementationSources(
  fs: SigilFileSystem,
  root: string,
): Promise<readonly ImplementationSource[]> {
  const paths = (await fs.listFiles(root)).filter((path) =>
    isSupportedImplementationSource(path)
  );
  return await Promise.all(paths.map(async (filePath) => ({
    filePath,
    text: await fs.readTextFile(filePath),
  })));
}

function parseConfiguration(value: unknown): CompileConfiguration {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tools.compile must be an object.");
  }
  const raw = value as Record<string, unknown>;
  const adapter = raw.adapter;
  if (
    adapter !== undefined &&
    (!adapter || typeof adapter !== "object" || Array.isArray(adapter) ||
      !["codex", "claude"].includes(
        String((adapter as Record<string, unknown>).provider),
      ))
  ) {
    throw new Error("tools.compile.adapter.provider must be codex or claude.");
  }
  return raw as unknown as CompileConfiguration;
}

async function effectiveProfile(
  name: string,
  configuration: CompileConfiguration,
): Promise<EffectiveProfile> {
  const custom = configuration.profiles?.[name];
  const base = custom?.extends ?? name;
  if (base !== "standard" && base !== "critical-system") {
    throw new Error(`Unknown compilation profile ${JSON.stringify(name)}.`);
  }
  const included = base === "standard"
    ? STAGES.filter((stage) => stage.id !== "standards-risk")
    : STAGES;
  const disabled = new Set(custom?.disabledStages ?? []);
  const stages = included.map((stage) => ({
    id: stage.id,
    required: stage.required,
    enabled: !disabled.has(stage.id),
    agentic: stage.agentic,
    dependencies: stage.dependencies,
  }));
  const profileBase = {
    name,
    contextBudgetChars: MAX_COMPILATION_CONTEXT_CHARS,
    stages,
    adapter: configuration.adapter,
  };
  return {
    ...profileBase,
    fingerprint: await digest(JSON.stringify(profileBase)),
  };
}

function adapterFrom(profile: EffectiveProfile): AgentAdapter | undefined {
  if (profile.adapter?.provider === "codex") {
    return new CodexAdapter(profile.adapter.model);
  }
  if (profile.adapter?.provider === "claude") {
    return new ClaudeAdapter(profile.adapter.model);
  }
  return undefined;
}

function resolveTarget(
  resolved: ResolvedSigilWorkspace,
  target: CompilationTarget,
  root: string,
): readonly ResolvedComponent[] {
  const selected = target.kind === "workspace"
    ? resolved.components
    : selectExplicitTarget(resolved.components, target, root);
  if (!selected.length) {
    throw new Error(`No component matched ${target.kind} ${target.value}.`);
  }
  return dependencyOrder(resolved, selected);
}

function selectExplicitTarget(
  components: readonly ResolvedComponent[],
  target: CompilationTarget,
  root: string,
): readonly ResolvedComponent[] {
  if (!target.value) throw new Error(`${target.kind} target requires a value.`);
  return target.kind === "component"
    ? components.filter((item) => item.name === target.value)
    : components.filter((item) =>
      canonicalWorkspacePath(item.filePath, root) ===
        canonicalWorkspacePath(target.value!, root)
    );
}

function dependencyOrder(
  resolved: ResolvedSigilWorkspace,
  selected: readonly ResolvedComponent[],
): readonly ResolvedComponent[] {
  const selectedKeys = new Set(
    selected.map((component) => componentKey(component)),
  );
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

function fromCoreDiagnostic(item: SigilDiagnostic): CompilerDiagnostic {
  const fingerprint = `${item.code}:${item.filePath ?? ""}:${
    item.range?.start.line ?? ""
  }:${item.range?.start.column ?? ""}`;
  return {
    code: item.code,
    fingerprint,
    severity: item.severity === "error"
      ? "error"
      : item.severity === "warning"
      ? "warning"
      : "information",
    stage: "deterministic-foundation",
    skill: "sigil-core",
    message: item.message,
    filePath: item.filePath,
    range: item.range,
    evidence: item.message,
    impact: item.severity === "error"
      ? "The contract cannot complete deterministic evaluation."
      : "The compiler recorded a deterministic finding.",
    correction: "Resolve the referenced Sigil diagnostic.",
    evaluator: `sigil-core@${metadata.version}`,
    lifecycle: "new",
  };
}

async function fromAgentFinding(
  stage: string,
  adapter: AgentAdapter,
  finding: AgentFinding,
  componentName: string,
): Promise<CompilerDiagnostic> {
  const subject = `${finding.code}:${stage}:${componentName}:${
    finding.filePath ?? ""
  }:${finding.line ?? ""}:${finding.column ?? ""}`;
  return {
    code: finding.code,
    fingerprint: await digest(subject),
    severity: finding.severity,
    stage,
    skill: stage,
    message: finding.message,
    filePath: finding.filePath,
    range: finding.line
      ? {
        start: { line: finding.line, column: finding.column ?? 1 },
        end: { line: finding.line, column: (finding.column ?? 1) + 1 },
      }
      : undefined,
    evidence: finding.evidence,
    impact: finding.impact,
    correction: finding.correction,
    evaluator: `${adapter.provider}${adapter.model ? `:${adapter.model}` : ""}`,
    lifecycle: "new",
  };
}

async function stageFailure(
  stage: string,
  adapter: AgentAdapter | undefined,
  error: unknown,
): Promise<CompilerDiagnostic> {
  return {
    code: "COMPILER_EVALUATOR_INCOMPLETE",
    fingerprint: await digest(`COMPILER_EVALUATOR_INCOMPLETE:${stage}`),
    severity: "information",
    stage,
    skill: stage,
    message: error instanceof Error ? error.message : String(error),
    evidence: "The required evaluator did not complete successfully.",
    impact: "This run cannot become green.",
    correction:
      "Configure an available read-only adapter or disable the stage in a project profile.",
    evaluator: adapter?.id ?? "unavailable",
    lifecycle: "new",
  };
}

function colorFor(
  diagnostics: readonly CompilerDiagnostic[],
  stages: readonly StageReport[],
): CompilationColor {
  if (
    diagnostics.some((item) => item.severity === "error") ||
    stages.some((stage) =>
      stage.required &&
      !["completed", "disabled"].includes(stage.state)
    )
  ) return "red";
  if (diagnostics.some((item) => item.severity === "warning")) return "yellow";
  return "green";
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
