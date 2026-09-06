import {
  type CompilationBoundaryResult,
  type CompilationScopeSeed,
  type ImplementationSource,
  isSupportedImplementationSource,
  loadSigilWorkspace,
  resolveSigilWorkspace,
  selectCompilationBoundary,
  type SigilDiagnostic,
  type SigilFileSystem,
} from "@qoherent/sigil-core";
import metadata from "../deno.json" with { type: "json" };
import {
  canonicalWorkspacePath,
  resolveCompilationTarget,
} from "./compilation-target.ts";
import {
  type CompilationEventWriter,
  openCompilationEventWriter,
  type WritableEnvelopeSink,
  type WriterResult,
} from "./event-writer.ts";
import { applyDiagnosticLifecycle, compilationHistoryKey } from "./history.ts";
import { exportCompilationReport } from "./report-export.ts";
import { constructCompilationReport } from "./report-protocol.ts";
import {
  parseCompilationConfiguration,
  stageForCompilationFocus,
} from "./profile.ts";
import {
  CompilerFailure,
  compilerFailureCode as stableCompilerFailureCode,
} from "./status.ts";
import {
  createSemanticSubjectResolver,
  semanticSubjectIdentity,
  type SemanticSubjectResolver,
} from "./semantic-subjects.ts";
import {
  compileSemanticWorld,
  type SemanticCompilation,
  type SemanticDiagnostic,
} from "./semantic/compile.ts";
import { semanticProfile, semanticStageAlias } from "./semantic/profile.ts";
import {
  projectSigilIntent,
  semanticComponentId,
  type SemanticSourceBinding,
} from "./semantic/source.ts";
import { createSemanticComponentRegistry } from "./semantic/component-registry.ts";
import { createSemanticWorkspaceContext } from "./semantic/workspace-context.ts";
import { scopeSemanticWorld } from "./semantic/scope.ts";
import { isCompileArtifactDirectory } from "./semantic/artifacts.ts";
import {
  artifactPayload,
  recordCompilationRun,
  recordSemanticStage,
} from "./semantic/artifact-recording.ts";
import {
  type ImplementationEvidence,
  readImplementationPolicy,
} from "./semantic/evidence.ts";
import { readSemanticState } from "./semantic/store.ts";
import { AdapterFailure } from "./adapter-execution-coordinator.ts";
import {
  createExecutionBudget,
  type ExecutionBudgetHandle,
} from "./semantic/execution-budget.ts";
import { verifyImplementationWorld } from "./semantic/verification.ts";
import { readImplementationHandoff } from "./semantic/handoff.ts";
import {
  summarizeReturnedImplementation,
  verifyReturnedImplementation,
} from "./semantic/verify-return.ts";
import {
  digest,
  parseSemanticWorld,
  SemanticInputError,
  worldFromFacts,
} from "./semantic/turtle.ts";
import type {
  CompilationFocus,
  CompilationReport,
  CompilationTarget,
  CompileConfiguration,
  CompileOptions,
  CompilerDiagnostic,
  StageReport,
} from "./types.ts";

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
          isCompileArtifactDirectory(path, entry.name) ||
          [
            ".git",
            ".deno",
            ".vscode-test",
            "node_modules",
            "build",
            "coverage",
            "repos",
            "target",
          ]
            .includes(entry.name)
        ) continue;
        await visit(`${path}/${entry.name}`);
      }
    }
    await visit(root);
    return files.sort();
  }
}

export async function loadCompilationConfiguration(
  startPath: string,
): Promise<CompileConfiguration> {
  return (await loadCompilationWorkspace(startPath)).configuration;
}

export async function loadAgentProfile(
  workspacePath: string,
): Promise<string | undefined> {
  const workspace = await loadSigilWorkspace(new DenoReadOnlyFileSystem(), {
    startPath: workspacePath,
    currentDirectory: Deno.cwd(),
  });
  assertLoadedWorkspace(workspace.diagnostics);
  const agent = workspace.config?.tools.agent;
  return agent && typeof agent === "object" && !Array.isArray(agent) &&
      typeof (agent as Record<string, unknown>).profile === "string"
    ? (agent as Record<string, string>).profile
    : undefined;
}

export async function resolveCompilationProfile(
  workspacePath: string,
  agent: boolean = false,
): Promise<string> {
  const workspace = await loadSigilWorkspace(new DenoReadOnlyFileSystem(), {
    startPath: workspacePath,
    currentDirectory: Deno.cwd(),
  });
  assertLoadedWorkspace(workspace.diagnostics);
  const agentConfiguration = workspace.config?.tools.agent;
  const agentProfile = agent && agentConfiguration &&
      typeof agentConfiguration === "object" &&
      !Array.isArray(agentConfiguration) &&
      typeof (agentConfiguration as Record<string, unknown>).profile ===
        "string"
    ? (agentConfiguration as Record<string, string>).profile
    : undefined;
  const configuration = parseCompilationConfiguration(
    workspace.config?.tools.compile,
  );
  return agentProfile ?? configuration.defaultProfile ?? "standard";
}

export async function loadCompilationWorkspace(
  startPath: string,
): Promise<
  { readonly configuration: CompileConfiguration; readonly root: string }
> {
  await assertWorkspacePath(startPath);
  const workspace = await loadSigilWorkspace(new DenoReadOnlyFileSystem(), {
    startPath,
  });
  assertLoadedWorkspace(workspace.diagnostics);
  return {
    configuration: parseCompilationConfiguration(
      workspace.config?.tools.compile,
    ),
    root: workspace.root,
  };
}

async function assertWorkspacePath(workspacePath: string): Promise<void> {
  if (!workspacePath.trim()) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      "workspacePath must identify an existing configured workspace or Sigil source.",
    );
  }
  try {
    await Deno.lstat(workspacePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new CompilerFailure(
        "COMPILER_INVALID_INVOCATION",
        "workspacePath does not exist.",
        { cause: error },
      );
    }
    throw new CompilerFailure(
      "COMPILER_FAILED",
      "workspacePath could not be accessed.",
      { cause: error },
    );
  }
}

function assertLoadedWorkspace(
  diagnostics: readonly { readonly code: string; readonly severity: string }[],
): void {
  const error = diagnostics.find((item) =>
    item.severity === "error" &&
    (item.code === "SIGIL_CONFIG_NOT_FOUND" ||
      item.code.startsWith("SIGIL_CONFIG_"))
  );
  if (!error) return;
  if (error.code === "SIGIL_CONFIG_NOT_FOUND") {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      "workspacePath is not governed by a configured Sigil workspace.",
    );
  }
  throw new CompilerFailure(
    "COMPILER_FAILED",
    `SigilCore could not load the selected workspace: ${error.code}.`,
  );
}

function callbackEventSink(
  callback: CompileOptions["onEvent"],
): WritableEnvelopeSink {
  return async (bytes) => {
    if (!callback) return "delivered-all";
    try {
      await callback(JSON.parse(new TextDecoder().decode(bytes)));
      return "delivered-all";
    } catch {
      return "rejected-zero-unavailable";
    }
  };
}

function requireEventDelivery(result: WriterResult, progress = false): void {
  if (result === "delivered" || (progress && result === "suppressed")) return;
  throw new CompilerFailure(
    "COMPILER_FAILED",
    `Compilation event delivery failed: ${result}.`,
  );
}

async function deliverHistoryWarning(
  options: CompileOptions,
  warning: Parameters<NonNullable<CompileOptions["hostWarningSink"]>>[0],
): Promise<void> {
  try {
    await options.hostWarningSink?.(warning);
  } catch {
    // History warnings and their optional delivery remain non-authoritative.
  }
}

function currentLifecycle(
  diagnostic: CompilerDiagnostic,
  previous: CompilationReport | undefined,
): CompilerDiagnostic {
  return applyDiagnosticLifecycle([diagnostic], previous)[0];
}

async function fromCoreDiagnostic(
  item: SigilDiagnostic,
  resolver: SemanticSubjectResolver,
): Promise<CompilerDiagnostic> {
  const semanticSubjects = await resolver.resolve(item.filePath, item.range);
  const fingerprint = await diagnosticFingerprint(
    item.code,
    "deterministic-foundation",
    semanticSubjects,
    item.filePath,
    item.range,
  );
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
    semanticSubjects,
    evidence: item.message,
    impact: item.severity === "error"
      ? "The contract cannot complete deterministic evaluation."
      : "The compiler recorded a deterministic finding.",
    correction: "Resolve the referenced Sigil diagnostic.",
    evaluator: `sigil-core@${metadata.version}`,
    lifecycle: "new",
  };
}

function workspaceEvidenceFingerprint(
  root: string,
  sigilDocuments: readonly unknown[],
  implementation: readonly ImplementationSource[],
): Promise<string> {
  return digest(JSON.stringify({
    sigilDocuments,
    implementation: implementation.map((source) => ({
      filePath: canonicalWorkspacePath(source.filePath, root),
      text: source.text,
    })),
  }));
}

async function loadImplementationSources(
  fs: SigilFileSystem,
  root: string,
): Promise<readonly ImplementationSource[]> {
  return Promise.all(
    (await fs.listFiles(root))
      .filter(isSupportedImplementationSource)
      .map(async (filePath) => ({
        filePath,
        text: await fs.readTextFile(filePath),
      })),
  );
}

function diagnosticFingerprint(
  code: string,
  stage: string,
  semanticSubjects: readonly CompilerDiagnostic["semanticSubjects"][number][],
  filePath?: string,
  range?: CompilerDiagnostic["range"],
  componentName?: string,
): Promise<string> {
  return digest(JSON.stringify({
    code,
    stage,
    componentName,
    semanticSubjects: semanticSubjects.map(semanticSubjectIdentity),
    fallback: semanticSubjects.length ? undefined : {
      filePath,
      line: range?.start.line,
      column: range?.start.column,
    },
  }));
}

function assertResolvableScope(boundary: CompilationBoundaryResult): void {
  const blocking = boundary.diagnostics.filter((item) =>
    item.severity === "error"
  );
  if (blocking.length === 0) return;
  throw new CompilerFailure(
    "COMPILER_INVALID_INVOCATION",
    blocking.map((item) => item.message).join(" "),
  );
}

function compilationTargetFor(
  boundary: CompilationBoundaryResult,
): CompilationTarget {
  const target = boundary.resolvedTarget;
  if (target.kind === "file") {
    return { kind: "file", filePath: target.filePath };
  }
  if (target.kind === "component") {
    return {
      kind: "component",
      name: target.name,
      declarationPath: target.declarationPath,
    };
  }
  return { kind: "workspace" };
}

export async function validateCompilationProfile(
  configuration: CompileConfiguration,
  profileName: string,
  focus: CompilationFocus,
): Promise<void> {
  await semanticProfile(
    profileName,
    configuration,
    stageForCompilationFocus(focus),
  );
}

/** Compile asserted semantic state with Sigil's fixed egglog kernel. */
export async function compile(
  workspacePath: string,
  requestedScope: CompilationScopeSeed = { kind: "workspace" },
  profileName: string,
  options: CompileOptions = {},
): Promise<CompilationReport> {
  const callerSignal = options.cancellationSignal ?? options.signal;
  let cancellationSignal = callerSignal;
  let executionBudget: ExecutionBudgetHandle | undefined;
  const requestedStage = semanticStageAlias(
    options.requestedStage ?? stageForCompilationFocus(options.focus),
  );
  const startedAt = new Date().toISOString();
  const startedMonotonic = performance.now();
  let successLinearized = false;
  let eventWriter: CompilationEventWriter | undefined;
  try {
    if (options.requestedStage && options.focus) {
      throw new CompilerFailure(
        "COMPILER_INVALID_INVOCATION",
        "requestedStage and focus are mutually exclusive.",
      );
    }
    cancellationSignal?.throwIfAborted();
    await assertWorkspacePath(workspacePath);
    const fs = new DenoReadOnlyFileSystem();
    const workspace = await loadSigilWorkspace(fs, {
      startPath: workspacePath,
      currentDirectory: Deno.cwd(),
    });
    assertLoadedWorkspace(workspace.diagnostics);
    const resolved = resolveSigilWorkspace(workspace);
    const profile = await semanticProfile(
      profileName,
      parseCompilationConfiguration(workspace.config?.tools.compile),
      requestedStage,
    );
    const initialRemaining = Math.floor(
      profile.executionBudgets.elapsedTimeMs -
        (performance.now() - startedMonotonic),
    );
    if (initialRemaining <= 0) {
      throw new DOMException(
        "Compilation elapsed-time budget exhausted.",
        "TimeoutError",
      );
    }
    executionBudget = createExecutionBudget({
      signal: callerSignal,
      timeoutMs: initialRemaining,
    });
    cancellationSignal = executionBudget.signal;
    const engineOptions = () => {
      const remaining = executionBudget!.remainingMs();
      return {
        ...options.semanticEngine,
        timeoutMs: Math.min(
          options.semanticEngine?.timeoutMs ?? 30_000,
          remaining,
        ),
        signal: cancellationSignal,
      };
    };
    let boundaryScope = requestedScope;
    let canonicalScopeEntity: string | undefined;
    if (requestedScope.kind === "component") {
      try {
        const semanticContext = await createSemanticWorkspaceContext({
          root: workspace.root,
          resolved,
          engine: engineOptions(),
        });
        const matches = semanticContext.registry.resolve(
          requestedScope.componentName,
        );
        if (matches.length > 1) {
          throw new CompilerFailure(
            "COMPILER_INVALID_INVOCATION",
            `Semantic component ${
              JSON.stringify(requestedScope.componentName)
            } is ambiguous: ${
              matches.map((entry) => entry.entity).join(", ")
            }.`,
          );
        }
        if (matches.length === 1) {
          canonicalScopeEntity = matches[0].entity;
          boundaryScope = matches[0].authored
            ? {
              kind: "component",
              componentName: matches[0].authored.name,
              declarationPath: requestedScope.declarationPath,
            }
            : { kind: "workspace" };
        }
      } catch (error) {
        if (error instanceof CompilerFailure) throw error;
        // The ordinary boundary diagnostics remain authoritative when there
        // is no accepted state from which a semantic alias can be resolved.
      }
    }
    const boundary = selectCompilationBoundary(resolved, boundaryScope, {
      exactTarget: options.exactTarget,
    });
    assertResolvableScope(boundary);
    const target = compilationTargetFor(boundary);
    const components = resolveCompilationTarget(
      resolved,
      target,
      workspace.root,
    );
    const returned = options.returnedImplementation;
    if (
      returned && (
        !profile.stages.some((stage) =>
          stage.id === "implementation-coverage"
        ) ||
        options.semanticDocuments !== undefined ||
        options.implementationPolicy !== undefined ||
        Object.keys(options.semanticEngine ?? {}).some((key) =>
          !["binaryPath", "runtimeDirectory", "timeoutMs"].includes(key)
        )
      )
    ) {
      throw new CompilerFailure(
        "COMPILER_INVALID_INVOCATION",
        "Returned verification requires implementation coverage and cannot override the retained world, policy or evidence.",
      );
    }
    const handoff = returned
      ? await readImplementationHandoff(
        returned.handoffRoot ?? workspace.root,
        returned.handoff,
        engineOptions(),
      )
      : undefined;
    // Keep the structural IDs until the canonical registry can be built from
    // the accepted world. This preserves the old identity for malformed state
    // while allowing accepted receipts to remap authored components.
    let selectedIds = components.map((c) =>
      semanticComponentId(c, workspace.root)
    );
    const opened = await openCompilationEventWriter(
      options.eventSink ?? callbackEventSink(options.onEvent),
      {
        operation: "one-shot-compilation",
        stageIdentities: profile.stages.map((s) => s.id),
      },
    );
    if (opened.kind === "failure") {
      throw new CompilerFailure(
        "COMPILER_FAILED",
        `Compilation event stream could not be established: ${opened.result}.`,
      );
    }
    eventWriter = opened.writer;
    const implementationSources = await loadImplementationSources(
      fs,
      workspace.root,
    );
    const resolver = createSemanticSubjectResolver(
      resolved,
      implementationSources,
      workspace.root,
    );
    const sourceEvidenceFingerprint = await workspaceEvidenceFingerprint(
      workspace.root,
      workspace.files.map((f) => f.document),
      implementationSources,
    );
    const sourceIntent = await projectSigilIntent(
      resolved.components,
      workspace.root,
      resolved.imports,
    );
    let world = handoff?.slice ?? sourceIntent.world;
    let inputError: SemanticInputError | undefined;
    let stale = false;
    let canonicalRevision: string | null = null;
    let storedState: Awaited<ReturnType<typeof readSemanticState>>;
    try {
      if (!handoff) {
        storedState = await readSemanticState(workspace.root, engineOptions());
        canonicalRevision = storedState?.revision ?? null;
        if (
          storedState &&
          storedState.receipt.sourceFingerprint !==
            sourceIntent.world.fingerprint
        ) stale = true;
        else if (storedState) {
          world = await worldFromFacts(
            [...world.facts, ...storedState.world.facts],
            {
              ...world.provenance,
              ...storedState.world.provenance,
            },
          );
        }
        if (options.semanticDocuments?.length) {
          const proposed = await parseSemanticWorld(options.semanticDocuments);
          world = await worldFromFacts([...world.facts, ...proposed.facts], {
            ...world.provenance,
            ...proposed.provenance,
          });
        }
      }
    } catch (error) {
      if (!(error instanceof SemanticInputError)) throw error;
      inputError = error;
    }
    if (!inputError) {
      try {
        const registry = await createSemanticComponentRegistry({
          resolved,
          root: workspace.root,
          world,
          bindings: sourceIntent.bindings,
          componentBindings: storedState?.receipt.componentBindings,
        });
        selectedIds = canonicalScopeEntity
          ? registry.entryForEntity(canonicalScopeEntity)?.authored
            ? [...registry.entitiesFor(components)]
            : [canonicalScopeEntity]
          : [...registry.entitiesFor(components)];
        if (
          handoff && (
            selectedIds.length !== handoff.manifest.subjects.length ||
            selectedIds.some((id) => !handoff.manifest.subjects.includes(id))
          )
        ) {
          throw new CompilerFailure(
            "COMPILER_INVALID_INVOCATION",
            "Compilation scope must match the retained handoff subjects. Select its components, using --exact-target when needed.",
          );
        }
        if (!handoff) world = await scopeSemanticWorld(world, selectedIds);
      } catch (error) {
        if (error instanceof CompilerFailure) throw error;
        if (!(error instanceof Error)) throw error;
        inputError = new SemanticInputError(
          "INVALID_SEMANTIC_STATE",
          error.message,
        );
      }
    }
    const sourceFingerprint = await digest(
      JSON.stringify([
        sourceEvidenceFingerprint,
        world.fingerprint,
        stale,
        inputError?.message,
        returned,
      ]),
    );
    const historyDisabled = options.disableHistory ?? options.noHistory ??
      false;
    const historyKey = options.history && !historyDisabled
      ? await compilationHistoryKey(workspace.root, target, profile)
      : undefined;
    let previous: CompilationReport | undefined;
    if (historyKey) {
      try {
        previous = await options.history!.read(historyKey);
      } catch (error) {
        await deliverHistoryWarning(options, {
          code: "COMPILER_HISTORY_READ_FAILED",
          operation: "read",
          historyKey,
          message: String(error),
        });
      }
    }
    const diagnostics: CompilerDiagnostic[] = [];
    const stages: StageReport[] = [];
    const stageArtifacts: Record<string, string> = {};
    let returnedImplementation: CompilationReport["returnedImplementation"];
    let failed = false;
    let design: SemanticCompilation | undefined;
    for (const stage of profile.stages) {
      cancellationSignal?.throwIfAborted();
      if (
        failed || stage.id === "implementation-coverage" &&
          (design?.status !== "green" || stale)
      ) {
        stages.push({
          id: stage.id,
          required: true,
          state: "skipped-by-dependency",
          evaluator: "sigil-egglog@1",
          diagnosticCount: 0,
        });
        continue;
      }
      const stageStartedAt = new Date().toISOString();
      requireEventDelivery(await eventWriter.stageStarted(stage.id), true);
      const current: CompilerDiagnostic[] = [];
      if (stage.id === "deterministic-foundation") {
        current.push(
          ...await Promise.all(
            resolved.diagnostics.map((d) => fromCoreDiagnostic(d, resolver)),
          ),
        );
      } else if (stage.id === "semantic-closure") {
        if (inputError) {
          current.push(await semanticInputDiagnostic(inputError, stage.id));
        } else {
          if (stale) {
            current.push(
              await semanticInputDiagnostic(
                new SemanticInputError(
                  "SEMANTIC_SOURCE_CHANGED",
                  "Saved semantic interpretations describe an older Sigil source. Interpret the current required contracts before replacing the canonical world.",
                ),
                stage.id,
                "warning",
              ),
            );
          }
          design = await compileSemanticWorld(world, {
            ...engineOptions(),
            focus: "design",
          });
          stageArtifacts[stage.id] = await recordSemanticStage(
            workspace.root,
            design,
            {
              stage: stage.id,
              sourceFingerprint,
              mechanical: options.semanticEngine,
            },
          );
          current.push(
            ...await Promise.all(
              design.diagnostics.map((d) =>
                fromSemanticDiagnostic(
                  d,
                  design!,
                  sourceIntent.bindings,
                  resolver,
                  stage.id,
                )
              ),
            ),
          );
        }
      } else if (
        stage.id === "implementation-coverage" && design?.status === "green"
      ) {
        if (returned) {
          const verified = await verifyReturnedImplementation({
            root: workspace.root,
            ...returned,
            resolved,
            timeoutMs: executionBudget.remainingMs(),
            engine: engineOptions(),
          });
          returnedImplementation = summarizeReturnedImplementation(
            verified.report,
          );
          stageArtifacts[stage.id] =
            verified.report.artifacts.stages["returned-implementation"];
          if (verified.report.artifacts.stages["native-evidence"]) {
            stageArtifacts["native-evidence"] =
              verified.report.artifacts.stages["native-evidence"];
          }
          current.push(
            ...await Promise.all(
              verified.compilation.diagnostics.map((d) =>
                fromSemanticDiagnostic(
                  d,
                  verified.compilation,
                  sourceIntent.bindings,
                  resolver,
                  stage.id,
                  verified.evidence,
                )
              ),
            ),
          );
        } else {
          const policy = options.implementationPolicy ??
            await readImplementationPolicy(workspace.root);
          const verified = await verifyImplementationWorld({
            root: workspace.root,
            world,
            policy,
            resolved,
            canonicalRevision,
            engine: engineOptions(),
            timeoutMs: executionBudget.remainingMs(),
          });
          const {
            compilation: implementation,
            evidence,
            mechanical: implementationOptions,
          } = verified;
          if (verified.nativeArtifact) {
            stageArtifacts["native-evidence"] = verified.nativeArtifact;
          }
          stageArtifacts[stage.id] = await recordSemanticStage(
            workspace.root,
            implementation,
            {
              stage: stage.id,
              sourceFingerprint,
              evidence,
              mechanical: implementationOptions,
              extraFiles: {
                "command-checks.json": artifactPayload({
                  ...verified.commands,
                  world: undefined,
                }),
              },
            },
          );
          current.push(
            ...await Promise.all(
              implementation.diagnostics.map((d) =>
                fromSemanticDiagnostic(
                  d,
                  implementation,
                  sourceIntent.bindings,
                  resolver,
                  stage.id,
                  evidence,
                )
              ),
            ),
          );
        }
      }
      for (const raw of current) {
        const diagnostic = currentLifecycle(raw, previous);
        diagnostics.push(diagnostic);
        requireEventDelivery(await eventWriter.diagnostic(diagnostic), true);
      }
      failed = current.some((d) => d.severity === "error");
      const report: StageReport = {
        id: stage.id,
        required: true,
        state: "completed",
        evaluator: stage.id === "deterministic-foundation"
          ? "sigil-core"
          : "sigil-egglog@1",
        diagnosticCount: current.length,
        startedAt: stageStartedAt,
        completedAt: new Date().toISOString(),
      };
      stages.push(report);
      requireEventDelivery(await eventWriter.stageCompleted(report), true);
    }
    let report = constructCompilationReport({
      runId: opened.runId,
      workspaceRoot: workspace.root,
      target,
      requestedScope: boundary.requestedScope,
      selection: boundary.selection,
      componentNames: components.map((c) => c.name),
      startedAt,
      completedAt: new Date().toISOString(),
      sourceFingerprint,
      requestedStage,
      focus: options.focus,
      profile,
      stages,
      diagnostics,
      previous,
      artifacts: { stages: stageArtifacts },
      returnedImplementation,
    });
    cancellationSignal?.throwIfAborted();
    const runArtifact = await recordCompilationRun(workspace.root, report, {
      source: sourceFingerprint,
      world: world.fingerprint,
      profile: profile.fingerprint,
      ...Object.fromEntries(
        Object.entries(stageArtifacts).map((
          [name, id],
        ) => [`stage.${name}`, id]),
      ),
    });
    report = {
      ...report,
      artifacts: { stages: stageArtifacts, run: runArtifact },
    };
    executionBudget.remainingMs();
    successLinearized = true;
    executionBudget.dispose();
    const destination = options.reportExport ?? options.output;
    if (destination) {
      await exportCompilationReport(
        report,
        destination,
        options.reportExportRepresentation ?? "json",
        workspace.root,
      );
    }
    requireEventDelivery(await eventWriter.completed(report));
    if (historyKey) {
      try {
        await options.history!.write(historyKey, report);
      } catch (error) {
        await deliverHistoryWarning(options, {
          code: "COMPILER_HISTORY_WRITE_FAILED",
          operation: "write",
          historyKey,
          message: String(error),
        });
      }
    }
    return report;
  } catch (caught) {
    const cleanupFailed = caught instanceof AdapterFailure &&
      caught.kind === "cleanup";
    const error = !successLinearized && !cleanupFailed && callerSignal?.aborted
      ? new CompilerFailure(
        "COMPILER_CANCELLED",
        "Compilation was cancelled.",
        { cause: caught },
      )
      : !successLinearized && !cleanupFailed && executionBudget?.signal.aborted
      ? executionBudget.signal.reason
      : caught;
    const code = stableCompilerFailureCode(error);
    if (eventWriter) {
      const message = error instanceof Error ? error.message : String(error);
      const delivery = code === "COMPILER_CANCELLED"
        ? await eventWriter.cancelled(message)
        : await eventWriter.failed(code, message);
      if (delivery !== "delivered") {
        throw new CompilerFailure(
          "COMPILER_FAILED",
          `Required terminal compilation event was not delivered: ${delivery}.`,
          { cause: error },
        );
      }
    }
    throw error;
  } finally {
    executionBudget?.dispose();
  }
}

async function semanticInputDiagnostic(
  error: SemanticInputError,
  stage: string,
  severity: "error" | "warning" = "error",
): Promise<CompilerDiagnostic> {
  return {
    code: error.code,
    fingerprint: await digest(JSON.stringify([error.code, stage])),
    severity,
    stage,
    skill: "sigil-semantic-kernel@1",
    message: error.message,
    semanticSubjects: [],
    evidence: error.message,
    impact: "The semantic state cannot establish all required contracts.",
    correction:
      "Repair the referenced semantic input or update its source interpretation.",
    evaluator: "sigil-egglog@1",
    lifecycle: "new",
  };
}

async function fromSemanticDiagnostic(
  item: SemanticDiagnostic,
  compilation: SemanticCompilation,
  bindings: Readonly<Record<string, SemanticSourceBinding>>,
  resolver: SemanticSubjectResolver,
  stage: string,
  evidence?: ImplementationEvidence,
): Promise<CompilerDiagnostic> {
  const premiseIds = new Set(
    item.derivation.flatMap((row) => row.slice(2).map(String)),
  );
  const facts = compilation.world.facts.filter((fact) =>
    premiseIds.has(fact.id)
  );
  const binding = bindings[item.subject] ??
    facts.map((fact) => bindings[fact.subject.value]).find(Boolean);
  const subjects = binding
    ? (await Promise.all(
      [binding, ...(binding.additionalLocations ?? [])].map((origin) =>
        resolver.resolve(origin.filePath, origin.range, origin.componentName)
      ),
    )).flat()
    : [];
  const message = item.code === "unresolved-obligation" && binding?.unit &&
      item.witness.startsWith("interpret|")
    ? `${binding.componentName} ${binding.section}${
      binding.concept ? " (" + binding.concept + ")" : ""
    } needs a semantic interpretation: ${binding.unit.prose}`
    : item.message;
  return {
    code: item.code,
    fingerprint: await digest(JSON.stringify([stage, item.code, item.witness])),
    severity: item.severity,
    stage,
    skill: "sigil-semantic-kernel@1",
    message,
    filePath: binding?.filePath,
    range: binding?.range,
    semanticSubjects: subjects,
    evidence: JSON.stringify({
      witness: item.witness,
      derivation: item.derivation,
      facts,
      sources: facts.map((f) => compilation.world.provenance[f.id] ?? []),
      mechanical: evidence
        ? Object.fromEntries(
          Object.entries(evidence.receipts).filter(([id]) =>
            premiseIds.has(id)
          ),
        )
        : undefined,
      incomplete: evidence?.incomplete,
    }),
    impact: item.severity === "error"
      ? "A hard semantic invariant is violated."
      : "A required semantic proposition or implementation observation remains unresolved.",
    correction:
      "Resolve the referenced proposition or provide mechanically established implementation evidence.",
    evaluator: "sigil-egglog@1",
    lifecycle: "new",
  };
}
