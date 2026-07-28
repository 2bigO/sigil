import {
  type AgentDependencyContext,
  agentDependencyContextFor,
  type CollectedExpansion,
  collectedExpansionFor,
  componentContracts,
  type ComponentContractView,
  conceptNamespaceFor,
  DEFAULT_SIGIL_EXCLUDES,
  DEFAULT_SIGIL_INCLUDES,
  diagnostic,
  discoverSigilWorkspace,
  glossaryContextForFiles,
  type GlossaryContextProjection,
  type GlossaryProjection,
  loadSigilWorkspace,
  type OwnedImplementationProjection,
  ownedImplementationTargetsFor as coreOwnedImplementationTargetsFor,
  parseSigilDocument,
  type ResolvedConceptNamespace,
  type ResolvedSigilWorkspace,
  resolveSigilWorkspace,
  SIGIL_CONFIG_PATH,
  SIGIL_CORE_VERSION,
  SIGIL_GLOSSARY_PATH,
  SIGIL_VERSION,
  type SigilConfig,
  type SigilDiagnostic,
  type SigilDocument,
  type SigilFileSystem,
  type SigilWorkspace,
  type WorkspaceDiscoveryResult,
} from "@qoherent/sigil-core";
import { DenoSigilFileSystem, joinPath, normalizePath } from "./fs-adapter.ts";
import metadata from "../deno.json" with { type: "json" };

export const SIGIL_CLI_VERSION = metadata.version;

interface WritableSigilFileSystem extends SigilFileSystem {
  makeDirectory(path: string): Promise<void>;
  writeTextFile(path: string, source: string): Promise<void>;
}

export interface CoreAdapterOptions {
  readonly fs?: SigilFileSystem;
  readonly currentDirectory?: string;
}

export interface ParseFileResult {
  readonly discovery: WorkspaceDiscoveryResult;
  readonly document: SigilDocument | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface InitConfigResult {
  readonly root: string;
  readonly configPath: string;
  readonly glossaryPath: string;
  readonly config: SigilConfig | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface VersionInfo {
  readonly cliVersion: string;
  readonly coreVersion: string;
}

export class CoreAdapter {
  readonly #fs: SigilFileSystem;
  readonly #currentDirectory: string;

  constructor(options: CoreAdapterOptions = {}) {
    this.#fs = options.fs ?? new DenoSigilFileSystem();
    this.#currentDirectory = normalizePath(
      options.currentDirectory ?? Deno.cwd(),
    );
  }

  async parseFile(
    path: string,
    explicitRoot?: string,
  ): Promise<ParseFileResult> {
    const filePath = this.resolveTarget(path);
    const discovery = await discoverSigilWorkspace(this.#fs, {
      startPath: filePath,
      explicitRoot: explicitRoot ? this.resolveTarget(explicitRoot) : undefined,
      currentDirectory: this.#currentDirectory,
    });
    if (!discovery.config) {
      return { discovery, document: null, diagnostics: discovery.diagnostics };
    }
    const source = await this.#fs.readTextFile(filePath);
    const parsed = parseSigilDocument(filePath, source, {
      sigilVersion: discovery.config.sigilVersion,
    });
    return {
      discovery,
      document: parsed.document,
      diagnostics: [...discovery.diagnostics, ...parsed.diagnostics],
    };
  }

  async loadWorkspace(
    path?: string,
    explicitRoot?: string,
  ): Promise<SigilWorkspace> {
    return await loadSigilWorkspace(this.#fs, {
      startPath: this.resolveTarget(path ?? this.#currentDirectory),
      explicitRoot: explicitRoot ? this.resolveTarget(explicitRoot) : undefined,
      currentDirectory: this.#currentDirectory,
    });
  }

  async resolveWorkspace(
    path?: string,
    explicitRoot?: string,
  ): Promise<ResolvedSigilWorkspace> {
    return resolveSigilWorkspace(await this.loadWorkspace(path, explicitRoot));
  }

  async initConfig(
    path: string | undefined,
    name: string | undefined,
    include: readonly string[],
    exclude: readonly string[],
  ): Promise<InitConfigResult> {
    const root = this.resolveTarget(path ?? this.#currentDirectory);
    const configPath = joinPath(root, SIGIL_CONFIG_PATH);
    const glossaryPath = joinPath(root, SIGIL_GLOSSARY_PATH);
    if (await this.#fs.exists(configPath)) {
      return {
        root,
        configPath,
        glossaryPath,
        config: null,
        diagnostics: [
          diagnostic(
            "SIGIL_CONFIG_EXISTS",
            `Refusing to overwrite existing ${configPath}.`,
            { filePath: configPath },
          ),
        ],
      };
    }
    const config = {
      sigilVersion: SIGIL_VERSION,
      workspace: {
        name: name?.trim() || basename(root),
        members: [],
      },
      files: {
        include: include.length ? [...include] : [...DEFAULT_SIGIL_INCLUDES],
        exclude: exclude.length ? [...exclude] : [...DEFAULT_SIGIL_EXCLUDES],
      },
      tools: {},
    };
    const writable = this.#fs as Partial<WritableSigilFileSystem>;
    if (!writable.makeDirectory || !writable.writeTextFile) {
      throw new Error(
        `Filesystem does not support writing ${SIGIL_CONFIG_PATH}.`,
      );
    }
    await writable.makeDirectory(joinPath(root, ".sigil"));
    await writable.writeTextFile(
      configPath,
      `${JSON.stringify(config, null, 2)}\n`,
    );
    if (!(await this.#fs.exists(glossaryPath))) {
      await writable.writeTextFile(
        glossaryPath,
        `${JSON.stringify(seedGlossary(), null, 2)}\n`,
      );
    }
    return { root, configPath, glossaryPath, config, diagnostics: [] };
  }

  versions(): VersionInfo {
    return {
      cliVersion: SIGIL_CLI_VERSION,
      coreVersion: SIGIL_CORE_VERSION,
    };
  }
  componentContracts(
    resolved: ResolvedSigilWorkspace,
  ): readonly ComponentContractView[] {
    return componentContracts(resolved);
  }
  ownedImplementationTargetsFor(
    resolved: ResolvedSigilWorkspace,
    componentName: string,
    conceptName?: string,
  ): OwnedImplementationProjection | undefined {
    return coreOwnedImplementationTargetsFor(
      resolved,
      componentName,
      conceptName,
    );
  }
  collectedExpansionFor(
    resolved: ResolvedSigilWorkspace,
    componentName: string,
  ): CollectedExpansion | undefined {
    return collectedExpansionFor(resolved, componentName);
  }
  agentDependencyContextFor(
    resolved: ResolvedSigilWorkspace,
    componentName: string,
  ): AgentDependencyContext | undefined {
    return agentDependencyContextFor(resolved, componentName);
  }
  conceptNamespaceFor(
    resolved: ResolvedSigilWorkspace,
    componentName: string,
  ): ResolvedConceptNamespace | undefined {
    return conceptNamespaceFor(resolved, componentName);
  }
  glossaryContextForFiles(
    projection: GlossaryProjection,
    filePaths: readonly string[],
  ): GlossaryContextProjection {
    return glossaryContextForFiles(projection, filePaths);
  }
  normalizePath(path: string): string {
    return normalizePath(path);
  }
  resolveTarget(path: string): string {
    const normalized = normalizePath(path);
    return isAbsolute(normalized)
      ? normalized
      : joinPath(this.#currentDirectory, normalized);
  }
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}
function basename(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "sigil";
}

function seedGlossary(): {
  readonly schemaVersion: 1;
  readonly terms: readonly {
    readonly term: string;
    readonly definition: string;
    readonly agentContext: false;
  }[];
  readonly contexts: readonly [];
} {
  return {
    schemaVersion: 1,
    terms: [
      {
        term: "Decision:",
        definition:
          "Required by the decision record convention; states the selected course or outcome whose rationale is being recorded.",
        agentContext: false,
      },
      {
        term: "Scope:",
        definition:
          "Required by the decision record convention; states the governed boundary and important exclusions.",
        agentContext: false,
      },
      {
        term: "Assumptions:",
        definition:
          "States materially applicable conditions treated as true when making the decision.",
        agentContext: false,
      },
      {
        term: "Trade-offs:",
        definition:
          "States materially applicable benefits, costs, and tensions accepted by the decision.",
        agentContext: false,
      },
      {
        term: "Design issues addressed:",
        definition:
          "States materially applicable problems or pressures the decision resolves.",
        agentContext: false,
      },
      {
        term: "Discarded alternatives:",
        definition:
          "States materially relevant options not selected and why they were rejected.",
        agentContext: false,
      },
      {
        term: "Consequences:",
        definition:
          "States materially applicable effects and obligations created by the decision.",
        agentContext: false,
      },
      {
        term: "Revisit when:",
        definition:
          "States conditions that should trigger reconsideration of the decision.",
        agentContext: false,
      },
    ],
    contexts: [],
  };
}
