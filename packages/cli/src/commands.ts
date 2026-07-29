import type { CommandRequest, ContextRequest } from "./args.ts";
import { CoreAdapter } from "./core-adapter.ts";
import {
  installSkills,
  type InstallSkillsOptions,
  listInstalledSkills,
} from "./installer.ts";
import {
  type CommandResult,
  diagnosticCounts,
  workspaceMetadata,
} from "./output-model.ts";
import { renderWorkspaceMarkdown } from "./markdown.ts";

export interface CommandHandlerOptions {
  readonly core?: CoreAdapter;
  readonly install?: InstallSkillsOptions;
}

/**
 * @sigil implements packages/cli/#module.sigil::SigilCli::SkillCatalog interface,logic,cases
 * @sigil implements packages/cli/#module.sigil::SigilCli::SkillInstallation interface,logic,constraints,cases
 * @sigil implements packages/cli/#module.sigil::SigilCli::WorkspaceInitialization interface,logic,cases
 * @sigil implements packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil implements packages/cli/#module.sigil::SigilCli::GlossaryInspection interface,logic,cases
 */
export async function runCommand(
  request: CommandRequest,
  options: CommandHandlerOptions = {},
): Promise<CommandResult> {
  if (request.command === "skill-list") {
    const result = await listInstalledSkills(options.install?.sourceDirectory);
    return {
      command: "skill-list",
      ...result,
      supportedAgents: ["codex", "claude", "opencode", "pi"],
      diagnostics: [],
    };
  }
  if (request.command === "skill-install") {
    const result = await installSkills({
      ...options.install,
      scope: request.project ? "project" : "global",
      agents: request.agents,
    });
    return { command: "skill-install", ...result, diagnostics: [] };
  }
  const core = options.core ?? new CoreAdapter();
  if (request.command === "init") {
    const result = await core.initConfig(
      request.path,
      request.name,
      request.include,
      request.exclude,
    );
    return {
      command: "init",
      workspaceRoot: result.root,
      configPath: result.configPath,
      sigilVersion: result.config?.sigilVersion ?? null,
      workspaceName: result.config?.workspace.name ?? null,
      config: result.config,
      diagnostics: result.diagnostics,
    };
  }
  if (request.command === "version") {
    const workspace = await core.loadWorkspace(request.path, request.root);
    return {
      command: "version",
      ...core.versions(),
      ...workspaceMetadata(workspace),
      diagnostics: workspace.diagnostics,
    };
  }
  if (request.command === "parse") {
    const parsed = await core.parseFile(request.file, request.root);
    return {
      command: "parse",
      ...workspaceMetadata(parsed.discovery),
      document: parsed.document,
      diagnostics: parsed.diagnostics,
    };
  }
  const resolved = await core.resolveWorkspace(
    request.path ?? (request.command === "context" ? request.file : undefined),
    request.root,
  );
  if (request.command === "check") {
    return {
      command: "check",
      ...workspaceMetadata(resolved.workspace),
      diagnostics: resolved.diagnostics,
      diagnosticCounts: diagnosticCounts(resolved.diagnostics),
    };
  }
  if (request.command === "glossary") {
    return {
      command: "glossary",
      ...workspaceMetadata(resolved.workspace),
      glossaryPath: resolved.glossary.glossaryPath ?? null,
      schemaVersion: resolved.glossary.schemaVersion ?? null,
      terms: resolved.glossary.terms,
      contexts: resolved.glossary.contexts,
      resolvedContexts: resolved.glossary.resolvedContexts,
      occurrences: resolved.glossary.occurrences,
      diagnostics: resolved.diagnostics,
    };
  }
  if (request.command === "graph") {
    return {
      command: "graph",
      ...workspaceMetadata(resolved.workspace),
      graph: resolved.graph,
      diagnostics: resolved.diagnostics,
    };
  }
  if (request.command === "context") {
    return await contextCommand(request, core, resolved);
  }
  return {
    command: "render",
    ...workspaceMetadata(resolved.workspace),
    markdown: renderWorkspaceMarkdown(resolved, core),
    diagnostics: resolved.diagnostics,
  };
}

// @sigil implements packages/cli/#module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
async function contextCommand(
  request: ContextRequest,
  core: CoreAdapter,
  resolved: Awaited<ReturnType<CoreAdapter["resolveWorkspace"]>>,
): Promise<CommandResult> {
  const selectedFile = request.file
    ? core.resolveTarget(request.file)
    : undefined;
  const selectedComponents = resolved.components.filter((component) =>
    request.component
      ? component.name === request.component
      : component.filePath === selectedFile
  );
  const selectedNames = new Set(
    selectedComponents.map((component) => component.name),
  );
  const contracts = core.componentContracts(resolved).filter((contract) =>
    selectedNames.has(contract.name)
  );
  const expansions = selectedComponents.map((component) =>
    core.collectedExpansionFor(resolved, component.name)
  ).filter((item) => item !== undefined);
  const conceptNamespaces = selectedComponents.map((component) =>
    core.conceptNamespaceFor(resolved, component.name)
  ).filter((item) => item !== undefined);
  const agentDependencyContexts = selectedComponents.map((component) =>
    core.agentDependencyContextFor(resolved, component.name)
  ).filter((item) => item !== undefined);
  const implementationSourceDiscovery = await core.implementationSourcesFor(
    resolved,
  );
  const ownedImplementationProjections = selectedComponents.map((component) =>
    core.ownedImplementationTargetsFor(
      resolved,
      implementationSourceDiscovery.sources,
      component.name,
    )
  ).filter((item) => item !== undefined);
  const ownershipDiagnostics = ownedImplementationProjections.flatMap(
    (projection) => projection.diagnostics,
  );
  const relatedFilePaths = [
    ...new Set([
      ...agentDependencyContexts.flatMap((context) => context.relatedFilePaths),
    ]),
  ].sort();
  const glossaryContext = core.glossaryContextForFiles(
    resolved.glossary,
    relatedFilePaths,
  );
  return {
    command: "context",
    ...workspaceMetadata(resolved.workspace),
    selectedComponents,
    componentContracts: contracts,
    conceptNamespaces,
    collectedExpansions: expansions,
    agentDependencyContexts,
    ownedImplementationProjections,
    relatedFilePaths,
    glossaryContext: glossaryContext.glossaryPath ? glossaryContext : null,
    diagnostics: [
      ...resolved.diagnostics,
      ...implementationSourceDiscovery.diagnostics,
      ...ownershipDiagnostics,
    ],
  };
}
