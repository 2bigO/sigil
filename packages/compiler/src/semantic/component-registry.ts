import type {
  ResolvedComponent,
  ResolvedSigilWorkspace,
} from "@qoherent/sigil-core";
import {
  parseSigilDocument,
  resolveSigilWorkspace,
  SIGIL_VERSION,
  type SigilWorkspace,
} from "@qoherent/sigil-core";
import { RDF_TYPE, SIGIL_ONTOLOGY } from "./ontology.ts";
import { canonicalWorkspacePath } from "../compilation-target.ts";
import { semanticComponentId, type SemanticSourceBinding } from "./source.ts";
import { digest, resourceId, type SemanticWorld } from "./turtle.ts";

/** One logical semantic component and all physical names that may select it. */
export interface SemanticComponentEntry {
  readonly entity: string;
  readonly authored?: ResolvedComponent;
  readonly authoredStructuralId?: string;
  /** Generated companion representation used only for explicit view targets. */
  readonly projected: ResolvedComponent;
  readonly projectedPath: string;
  readonly projectedName: string;
  readonly label?: string;
}

export interface SemanticComponentRegistry {
  readonly entries: readonly SemanticComponentEntry[];
  /** Resolve a canonical IRI, authored name, generated name, or unique label. */
  resolve(selector: string): readonly SemanticComponentEntry[];
  /** Resolve a semantic selector only when it identifies exactly one entity. */
  entityForTarget(selector: string): string;
  /** Convert the selected authored components to their canonical entity IDs. */
  entitiesFor(components: readonly ResolvedComponent[]): readonly string[];
  entryForEntity(entity: string): SemanticComponentEntry | undefined;
}

function invalid(message: string): never {
  throw new Error(`Invalid semantic component registry: ${message}`);
}

function componentEntities(world: SemanticWorld): Set<string> {
  const result = new Set<string>();
  for (const fact of world.facts) {
    if (
      fact.predicate === RDF_TYPE && fact.object.kind === "iri" &&
      (fact.object.value === SIGIL_ONTOLOGY + "Component" ||
        fact.object.value === SIGIL_ONTOLOGY + "System")
    ) result.add(resourceId(fact.subject));
  }
  return result;
}

function labels(world: SemanticWorld): Map<string, string> {
  const result = new Map<string, string>();
  for (const fact of world.facts) {
    if (
      fact.predicate === SIGIL_ONTOLOGY + "label" &&
      fact.object.kind === "literal" && !fact.object.language
    ) result.set(resourceId(fact.subject), fact.object.value);
  }
  return result;
}

function legalPrefix(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
  if (!normalized) return "Entity";
  return /^[A-Za-z_]/.test(normalized) ? normalized : `Entity_${normalized}`;
}

function componentKey(
  component: Pick<ResolvedComponent, "name" | "filePath">,
  root: string,
): string {
  return `${
    canonicalWorkspacePath(component.filePath, root)
  }\0${component.name}`;
}

function generatedComponent(
  name: string,
  path: string,
): ResolvedComponent {
  const source =
    `component ${name} {\n  goal {\n    Represent the canonical semantic component ${name}.\n  }\n  interface {\n    No public capability is asserted for this component.\n  }\n}\n`;
  const parsed = parseSigilDocument(path, source, {
    sigilVersion: SIGIL_VERSION,
  });
  const errors = parsed.diagnostics.filter((item) => item.severity === "error");
  if (errors.length) {
    invalid(
      `generated component ${name} is not parser-valid: ${
        errors.map((item) => item.message).join("; ")
      }`,
    );
  }
  const virtual: SigilWorkspace = {
    root: ".",
    workspaceSnapshotIdentity: "virtual-managed-view",
    config: {
      sigilVersion: SIGIL_VERSION,
      workspace: { name: "managed-view", members: [] },
      files: { include: ["**/*.sigil"], exclude: [] },
      tools: {},
    },
    memberRoots: [],
    files: [{ path, source, document: parsed.document }],
    diagnostics: parsed.diagnostics,
  };
  const resolved = resolveSigilWorkspace(virtual);
  const resolvedErrors = resolved.diagnostics.filter((item) =>
    item.severity === "error"
  );
  if (resolvedErrors.length) {
    invalid(
      `generated component ${name} could not be resolved: ${
        resolvedErrors.map((item) => item.message).join("; ")
      }`,
    );
  }
  const component = resolved.components.find((item) => item.name === name);
  if (!component) invalid(`generated component ${name} was not resolved.`);
  return component;
}

/**
 * Build canonical target aliases from accepted facts and validated authored
 * bindings. This function is the only place that interprets componentBindings.
 */
export async function createSemanticComponentRegistry(options: {
  readonly resolved: ResolvedSigilWorkspace;
  readonly root: string;
  readonly world: SemanticWorld;
  readonly bindings?: Readonly<Record<string, SemanticSourceBinding>>;
  readonly componentBindings?: Readonly<Record<string, string>>;
}): Promise<SemanticComponentRegistry> {
  const accepted = componentEntities(options.world);
  const sourceComponents = options.resolved.components;
  const sourceIds = new Map(
    sourceComponents.map((component) => [
      componentKey(component, options.root),
      semanticComponentId(component, options.root),
    ]),
  );
  const sourceBindingIds = new Map<string, string>();
  for (const binding of Object.values(options.bindings ?? {})) {
    if (binding.unit) continue;
    sourceBindingIds.set(
      componentKey({
        name: binding.componentName,
        filePath: binding.filePath,
      }, options.root),
      binding.componentId,
    );
  }
  const configured = options.componentBindings ?? {};
  const authoredByName = new Map<string, string>();
  for (const component of sourceComponents) {
    const structural =
      sourceBindingIds.get(componentKey(component, options.root)) ??
        sourceIds.get(componentKey(component, options.root));
    if (structural) authoredByName.set(component.name, structural);
  }
  const used = new Map<string, string>();
  const canonicalFor = (component: ResolvedComponent): string => {
    const structural =
      sourceBindingIds.get(componentKey(component, options.root)) ??
        sourceIds.get(componentKey(component, options.root));
    if (!structural) {
      invalid(`missing structural identity for ${component.name}`);
    }
    const configuredTarget = configured[structural];
    // Version-one receipts sometimes stored the authored component name as
    // the target. Resolve that legacy spelling to the structural subject while
    // retaining strict rejection for unknown canonical identities.
    const entity = configuredTarget === undefined
      ? structural
      : accepted.has(configuredTarget)
      ? configuredTarget
      : authoredByName.get(configuredTarget) ?? configuredTarget;
    if (!accepted.has(entity)) {
      // An empty accepted world is valid while intent is being prepared; in
      // that state the authored structural ID is the only safe identity.
      if (configured[structural] !== undefined) {
        invalid(`binding ${structural} points to non-component ${entity}`);
      }
    }
    const prior = used.get(entity);
    if (prior && prior !== structural) {
      invalid(`bindings ${prior} and ${structural} both point to ${entity}`);
    }
    used.set(entity, structural);
    return entity;
  };
  const names = labels(options.world);
  const rows: {
    entity: string;
    authored?: ResolvedComponent;
    authoredStructuralId?: string;
    label?: string;
  }[] = sourceComponents.map((authored) => {
    const entity = canonicalFor(authored);
    return {
      entity,
      authored,
      authoredStructuralId:
        sourceBindingIds.get(componentKey(authored, options.root)) ??
          sourceIds.get(componentKey(authored, options.root)),
      label: names.get(entity),
    };
  }).filter((row, index, all) =>
    all.findIndex((candidate) => candidate.entity === row.entity) === index
  );
  // Include accepted components that have no authored declaration. They are
  // addressable by canonical IRI and become generated views in S02.
  const known = new Set(rows.map((row) => row.entity));
  for (const entity of [...accepted].sort()) {
    // A structural source identity that is explicitly remapped is an alias of
    // the configured canonical entity, not a second logical component.
    if (!known.has(entity) && !Object.hasOwn(configured, entity)) {
      rows.push({ entity, authored: undefined, label: names.get(entity) });
    }
  }
  rows.sort((a, b) => a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0);
  const fullHashes = new Map<string, string>();
  for (const row of rows) fullHashes.set(row.entity, await digest(row.entity));
  const lengths = new Map([...fullHashes].map(([entity]) => [entity, 12]));
  const projectedNames = new Map<string, string>();
  while (true) {
    projectedNames.clear();
    const collisions = new Set<string>();
    for (const row of rows) {
      const prefix = legalPrefix(row.label ?? row.authored?.name ?? row.entity);
      const hash = fullHashes.get(row.entity)!;
      const suffix = hash.slice(0, lengths.get(row.entity)!);
      const name = `${
        prefix.slice(0, Math.max(1, 75 - suffix.length - 1))
      }_${suffix}`;
      const prior = [...projectedNames.entries()].find(([, value]) =>
        value === name
      );
      if (prior && prior[0] !== row.entity) {
        collisions.add(prior[0]);
        collisions.add(row.entity);
      } else {
        projectedNames.set(row.entity, name);
      }
    }
    if (!collisions.size) break;
    for (const entity of collisions) {
      const next = lengths.get(entity)! + 4;
      if (next > fullHashes.get(entity)!.length) {
        invalid(`generated component names collide for ${entity}`);
      }
      lengths.set(entity, next);
    }
  }
  const entries: SemanticComponentEntry[] = [];
  for (
    const row of rows.sort((a, b) =>
      a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0
    )
  ) {
    const fullHash = fullHashes.get(row.entity)!;
    const projectedName = projectedNames.get(row.entity)!;
    const projectedPath = `.sigil/views/${fullHash}.sigil`;
    entries.push({
      ...row,
      projectedName,
      projectedPath,
      projected: generatedComponent(projectedName, projectedPath),
    });
  }
  const byAlias = new Map<string, SemanticComponentEntry[]>();
  const add = (alias: string, entry: SemanticComponentEntry) => {
    const existing = byAlias.get(alias) ?? [];
    if (existing.some((candidate) => candidate.entity === entry.entity)) return;
    byAlias.set(alias, [...existing, entry]);
  };
  for (const entry of entries) {
    add(entry.entity, entry);
    add(entry.projectedName, entry);
    if (entry.authored) add(entry.authored.name, entry);
    if (entry.label) add(entry.label, entry);
  }
  return {
    entries,
    resolve(selector) {
      return byAlias.get(selector) ?? [];
    },
    entityForTarget(selector) {
      const matches = byAlias.get(selector) ?? [];
      if (matches.length === 0) {
        invalid(`no component matches ${JSON.stringify(selector)}`);
      }
      if (matches.length > 1) {
        invalid(
          `component ${JSON.stringify(selector)} is ambiguous: ${
            matches.map((entry) => entry.entity).join(", ")
          }`,
        );
      }
      return matches[0].entity;
    },
    entitiesFor(components) {
      const wanted = new Set(
        components.map((component) => componentKey(component, options.root)),
      );
      return entries.filter((entry) =>
        entry.authored && wanted.has(componentKey(entry.authored, options.root))
      ).map((entry) => entry.entity);
    },
    entryForEntity(entity) {
      return entries.find((entry) => entry.entity === entity);
    },
  };
}
