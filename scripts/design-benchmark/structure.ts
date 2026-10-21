/**
 * Structural measures: the parse-only list in issue #101 (Measures, kind 1),
 * taken from `sigilc tree` alone, per component and per design. No model is
 * involved, so the same design always gives the same numbers.
 *
 * How each measure maps to `sigilc tree` (version 1) fields:
 *
 * - Components per design: `trees[].parse.components[]`.
 * - Facets per contract role: the Facet children (recursing into groups) of
 *   each `sections[]` entry, counted by section name.
 * - Components without `state`, `logic` or `cases`: sections holding no Facet.
 * - Interface Tags that nothing imports: `components[].interfaceTags` (a
 *   `name#definitions` list) whose Tag IRI appears in no
 *   `resolution.imports[].names[].tagIri` anywhere in the design.
 * - Interface Tags with no backing Facet: no `state`, `logic` or `constraints`
 *   Facet of the same component introduces the Tag, is grouped under it, or has
 *   a `resolution.references[]` entry to its IRI.
 * - Tag-mention coupling: a reference from a Facet of A whose `tagIri` belongs
 *   to B (the IRI before `:tag:`) is one mention on the edge A to B.
 * - Import fan-in and fan-out: resolved `resolution.imports[]` of each source,
 *   from every component of that source to `providerIri`.
 * - Tag-sharing groups: connected sets of a component's Facets, linking Facets
 *   that introduce, mention or are grouped under a common Tag.
 * - Cycles: strongly connected sets of two or more components, found
 *   separately in the import graph and the Tag-mention graph.
 */
import { withTempDir } from "../agent-runner/files.ts";
import { runToCompletion } from "../agent-runner/process.ts";
import { compareText } from "./records.ts";

export const TREE_VERSION = 1;

export interface TreeFacet {
  readonly kind: "facet";
  readonly id: string;
  readonly section: string;
  readonly group: string | null;
  readonly introduces: readonly string[];
  readonly prose: string;
}

export interface TreeGroup {
  readonly kind: "group";
  readonly id: string;
  readonly name: string;
  readonly children: readonly TreeChild[];
}

export type TreeChild = TreeFacet | TreeGroup;

export interface TreeSection {
  readonly name: string;
  readonly id: string;
  readonly known: boolean;
  readonly children: readonly TreeChild[];
}

export interface TreeComponent {
  readonly name: string;
  readonly iri: string;
  readonly id: string;
  readonly interfaceTags: readonly string[];
  readonly sections: readonly TreeSection[];
}

export interface TreeSource {
  readonly id: string;
  readonly parse: {
    readonly path: string;
    readonly readable: boolean;
    readonly valid: boolean;
    readonly complete: boolean;
    readonly imports: readonly {
      readonly path: string;
      readonly provider: string;
      readonly selections: readonly string[];
    }[];
    readonly components: readonly TreeComponent[];
  };
  readonly resolution: {
    readonly components: readonly {
      readonly iri: string;
      readonly identityResolved: boolean;
      readonly tags: readonly {
        readonly name: string;
        readonly status: string;
        readonly iri: string | null;
      }[];
    }[];
    readonly imports: readonly {
      readonly path: string;
      readonly provider: string;
      readonly status: string;
      readonly target: string | null;
      readonly providerIri: string | null;
      readonly names: readonly {
        readonly name: string;
        readonly status: string;
        readonly used: boolean;
        readonly tagIri: string | null;
      }[];
    }[];
    readonly references: readonly {
      readonly facet: string;
      readonly name: string;
      readonly status: string;
      readonly tagIri: string | null;
    }[];
  };
}

export interface TreeOutput {
  readonly version: number;
  readonly trees: readonly TreeSource[];
}

/**
 * `sigilc tree` over a design, with a throwaway store so no cache is written
 * into the design or anywhere else that lasts.
 */
export async function readDesignTree(
  sigilc: string,
  root: string,
): Promise<TreeOutput> {
  return await withTempDir("design-benchmark-tree-", async (scratch) => {
    const result = await runToCompletion(sigilc, [
      "tree",
      "--root",
      root,
      "--store",
      scratch,
    ]);
    if (result.code !== 0) {
      throw new Error(
        `sigilc tree failed on ${root} (exit ${result.code}): ${
          (result.stderr || result.stdout).trim()
        }`,
      );
    }
    const output = JSON.parse(result.stdout) as TreeOutput;
    if (output.version !== TREE_VERSION) {
      throw new Error(
        `sigilc tree wrote version ${output.version}, not ${TREE_VERSION}`,
      );
    }
    return output;
  });
}

/** The contract roles, in the order Sigil writes them. */
export const ROLES = [
  "goal",
  "state",
  "logic",
  "constraints",
  "cases",
  "interface",
  "decisions",
] as const;

const SUBSTANCE_ROLES = ["state", "logic", "cases"] as const;
const BACKING_ROLES = new Set(["state", "logic", "constraints"]);

export interface ComponentStructure {
  /** The name rows are matched by; `Name (source)` when a name repeats. */
  readonly name: string;
  readonly source: string;
  /** Every role in `ROLES`, then any other section name, with its Facets. */
  readonly facetsByRole: Readonly<Record<string, number>>;
  /** Which of `state`, `logic` and `cases` hold no Facet. */
  readonly missingRoles: readonly string[];
  readonly interfaceTags: readonly string[];
  readonly unimportedInterfaceTags: readonly string[];
  readonly unbackedInterfaceTags: readonly string[];
  /** Components this one imports from, and those importing from it. */
  readonly imports: readonly string[];
  readonly importedBy: readonly string[];
  readonly fanOut: number;
  readonly fanIn: number;
  /** Mentions of other components' Tags, by owning component. */
  readonly mentionsOut: Readonly<Record<string, number>>;
  readonly mentionsIn: number;
  /** Sizes of the Tag-sharing groups, largest first. */
  readonly tagGroups: readonly number[];
  /** Facets that introduce, mention and sit under no Tag. */
  readonly untaggedFacets: number;
}

export interface Edge {
  readonly from: string;
  readonly to: string;
}

export interface StructureMeasures {
  readonly sources: number;
  /** Sources whose parse is not valid; the design does not parse. */
  readonly invalidSources: readonly string[];
  readonly components: number;
  readonly facets: number;
  readonly facetsByRole: Readonly<Record<string, number>>;
  readonly withoutStateLogicCases: readonly {
    readonly name: string;
    readonly missing: readonly string[];
  }[];
  readonly unimportedInterfaceTags: number;
  readonly unbackedInterfaceTags: number;
  readonly importEdges: readonly Edge[];
  readonly coupling: readonly (Edge & { readonly mentions: number })[];
  readonly importCycles: readonly (readonly string[])[];
  readonly mentionCycles: readonly (readonly string[])[];
  /** Sorted by name. */
  readonly componentList: readonly ComponentStructure[];
}

interface FacetInfo {
  readonly facet: TreeFacet;
  /** Position within its section, from 1, in source order. */
  readonly position: number;
}

/** Every Facet of a section in source order, recursing into groups. */
function sectionFacets(section: TreeSection): TreeFacet[] {
  const out: TreeFacet[] = [];
  const visit = (children: readonly TreeChild[]) => {
    for (const child of children) {
      if (child.kind === "facet") out.push(child);
      else if (child.kind === "group") visit(child.children);
    }
  };
  visit(section.children);
  return out;
}

const TAG_MARK = ":tag:";

/** The component IRI that owns a Tag IRI. */
function tagOwner(tagIri: string): string {
  const at = tagIri.lastIndexOf(TAG_MARK);
  return at < 0 ? tagIri : tagIri.slice(0, at);
}

/** Strip the `#definitions` count from an `interfaceTags` entry. */
function interfaceTagName(entry: string): string {
  const at = entry.lastIndexOf("#");
  return at < 0 ? entry : entry.slice(0, at);
}

/** Display names, keyed by component IRI; a repeated name gets its source. */
function componentNames(trees: readonly TreeSource[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const tree of trees) {
    for (const component of tree.parse.components) {
      counts.set(component.name, (counts.get(component.name) ?? 0) + 1);
    }
  }
  const names = new Map<string, string>();
  for (const tree of trees) {
    for (const component of tree.parse.components) {
      names.set(
        component.iri,
        (counts.get(component.name) ?? 0) > 1
          ? `${component.name} (${tree.parse.path})`
          : component.name,
      );
    }
  }
  return names;
}

/**
 * Why a design gives no claims or coverage reading: it has no sources, or a
 * source does not parse. Null when it can be read.
 */
export function unparseableReason(structure: StructureMeasures): string | null {
  if (structure.sources === 0) return "the design has no sources";
  if (structure.invalidSources.length > 0) {
    return `the design does not parse: ${structure.invalidSources.join(", ")}`;
  }
  return null;
}

export function measureStructure(output: TreeOutput): StructureMeasures {
  const trees = [...output.trees].sort((a, b) =>
    compareText(a.parse.path, b.parse.path)
  );
  const names = componentNames(trees);
  const nameOf = (iri: string) => names.get(iri) ?? iri;

  // Tag IRIs by component and name, from resolution where it has them.
  const tagIris = new Map<string, Map<string, string>>();
  for (const tree of trees) {
    for (const component of tree.resolution.components) {
      const byName = tagIris.get(component.iri) ?? new Map<string, string>();
      for (const tag of component.tags) {
        if (tag.iri) byName.set(tag.name, tag.iri);
      }
      tagIris.set(component.iri, byName);
    }
  }
  const ownTag = (componentIri: string, name: string) =>
    tagIris.get(componentIri)?.get(name) ??
      `${componentIri}${TAG_MARK}${encodeURIComponent(name)}`;

  // Facet ownership and the Tags each Facet touches.
  const facetOwner = new Map<string, string>();
  const facetTags = new Map<string, Set<string>>();
  const facetsOf = new Map<string, { section: string; info: FacetInfo }[]>();
  for (const tree of trees) {
    for (const component of tree.parse.components) {
      const list: { section: string; info: FacetInfo }[] = [];
      for (const section of component.sections) {
        sectionFacets(section).forEach((facet, index) => {
          facetOwner.set(facet.id, component.iri);
          const tags = new Set<string>();
          for (const name of facet.introduces) {
            tags.add(ownTag(component.iri, name));
          }
          if (facet.group) tags.add(ownTag(component.iri, facet.group));
          facetTags.set(facet.id, tags);
          list.push({
            section: section.name,
            info: { facet, position: index + 1 },
          });
        });
      }
      facetsOf.set(component.iri, list);
    }
  }
  const mentions = new Map<string, Map<string, number>>();
  for (const tree of trees) {
    for (const reference of tree.resolution.references) {
      if (!reference.tagIri) continue;
      facetTags.get(reference.facet)?.add(reference.tagIri);
      const from = facetOwner.get(reference.facet);
      const to = tagOwner(reference.tagIri);
      if (from === undefined || from === to || !names.has(to)) continue;
      const row = mentions.get(from) ?? new Map<string, number>();
      row.set(to, (row.get(to) ?? 0) + 1);
      mentions.set(from, row);
    }
  }

  // Imported Tag IRIs and the import graph.
  const imported = new Set<string>();
  const importGraph = new Map<string, Set<string>>();
  for (const tree of trees) {
    for (const entry of tree.resolution.imports) {
      for (const name of entry.names) {
        if (name.tagIri) imported.add(name.tagIri);
      }
      if (entry.status !== "resolved" || !entry.providerIri) continue;
      if (!names.has(entry.providerIri)) continue;
      for (const component of tree.parse.components) {
        if (component.iri === entry.providerIri) continue;
        const set = importGraph.get(component.iri) ?? new Set<string>();
        set.add(entry.providerIri);
        importGraph.set(component.iri, set);
      }
    }
  }
  const importedBy = new Map<string, Set<string>>();
  for (const [from, targets] of importGraph) {
    for (const to of targets) {
      const set = importedBy.get(to) ?? new Set<string>();
      set.add(from);
      importedBy.set(to, set);
    }
  }
  const mentionsIn = new Map<string, number>();
  for (const row of mentions.values()) {
    for (const [to, count] of row) {
      mentionsIn.set(to, (mentionsIn.get(to) ?? 0) + count);
    }
  }

  const componentList: ComponentStructure[] = [];
  for (const tree of trees) {
    for (const component of tree.parse.components) {
      const facets = facetsOf.get(component.iri) ?? [];
      const facetsByRole: Record<string, number> = {};
      for (const role of ROLES) facetsByRole[role] = 0;
      const extra = new Set<string>();
      for (const section of component.sections) {
        if (!(ROLES as readonly string[]).includes(section.name)) {
          extra.add(section.name);
        }
      }
      for (const name of [...extra].sort(compareText)) facetsByRole[name] = 0;
      for (const { section } of facets) facetsByRole[section]! += 1;

      const backing = new Set<string>();
      for (const { section, info } of facets) {
        if (!BACKING_ROLES.has(section)) continue;
        for (const tag of facetTags.get(info.facet.id) ?? []) backing.add(tag);
      }
      const interfaceTags = [
        ...new Set(component.interfaceTags.map(interfaceTagName)),
      ].sort(compareText);
      const unimported = interfaceTags.filter((name) =>
        !imported.has(ownTag(component.iri, name))
      );
      const unbacked = interfaceTags.filter((name) =>
        !backing.has(ownTag(component.iri, name))
      );

      const outgoing = mentions.get(component.iri) ?? new Map<string, number>();
      const mentionsOut: Record<string, number> = {};
      for (
        const [to, count] of [...outgoing].sort(([a], [b]) =>
          compareText(nameOf(a), nameOf(b))
        )
      ) mentionsOut[nameOf(to)] = count;

      const groups = tagGroups(
        facets.map(({ info }) => [...(facetTags.get(info.facet.id) ?? [])]),
      );

      const importsList = [...(importGraph.get(component.iri) ?? [])]
        .map(nameOf).sort(compareText);
      const importedByList = [...(importedBy.get(component.iri) ?? [])]
        .map(nameOf).sort(compareText);
      componentList.push({
        name: nameOf(component.iri),
        source: tree.parse.path,
        facetsByRole,
        missingRoles: SUBSTANCE_ROLES.filter((role) =>
          (facetsByRole[role] ?? 0) === 0
        ),
        interfaceTags,
        unimportedInterfaceTags: unimported,
        unbackedInterfaceTags: unbacked,
        imports: importsList,
        importedBy: importedByList,
        fanOut: importsList.length,
        fanIn: importedByList.length,
        mentionsOut,
        mentionsIn: mentionsIn.get(component.iri) ?? 0,
        tagGroups: groups.sizes,
        untaggedFacets: groups.untagged,
      });
    }
  }
  componentList.sort((a, b) => compareText(a.name, b.name));

  const facetsByRole: Record<string, number> = {};
  for (const role of ROLES) facetsByRole[role] = 0;
  const extraRoles = new Set<string>();
  for (const component of componentList) {
    for (const role of Object.keys(component.facetsByRole)) {
      if (!(role in facetsByRole)) extraRoles.add(role);
    }
  }
  for (const role of [...extraRoles].sort(compareText)) facetsByRole[role] = 0;
  for (const component of componentList) {
    for (const [role, count] of Object.entries(component.facetsByRole)) {
      facetsByRole[role]! += count;
    }
  }

  const importEdges: Edge[] = [];
  for (const component of componentList) {
    for (const to of component.imports) {
      importEdges.push({ from: component.name, to });
    }
  }
  const coupling: (Edge & { mentions: number })[] = [];
  for (const component of componentList) {
    for (const [to, count] of Object.entries(component.mentionsOut)) {
      coupling.push({ from: component.name, to, mentions: count });
    }
  }

  return {
    sources: trees.length,
    invalidSources: trees.filter((tree) => !tree.parse.valid)
      .map((tree) => tree.parse.path),
    components: componentList.length,
    facets: Object.values(facetsByRole).reduce((sum, n) => sum + n, 0),
    facetsByRole,
    withoutStateLogicCases: componentList
      .filter((component) => component.missingRoles.length > 0)
      .map((component) => ({
        name: component.name,
        missing: component.missingRoles,
      })),
    unimportedInterfaceTags: componentList.reduce(
      (sum, component) => sum + component.unimportedInterfaceTags.length,
      0,
    ),
    unbackedInterfaceTags: componentList.reduce(
      (sum, component) => sum + component.unbackedInterfaceTags.length,
      0,
    ),
    importEdges,
    coupling,
    importCycles: cycles(componentList.map((c) => c.name), importEdges),
    mentionCycles: cycles(componentList.map((c) => c.name), coupling),
    componentList,
  };
}

/** Connected sets of Facets that share a Tag; Facets with no Tag stay out. */
function tagGroups(
  facets: readonly (readonly string[])[],
): { sizes: number[]; untagged: number } {
  const parent = facets.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  const firstWith = new Map<string, number>();
  facets.forEach((tags, index) => {
    for (const tag of tags) {
      const first = firstWith.get(tag);
      if (first === undefined) firstWith.set(tag, index);
      else parent[find(index)] = find(first);
    }
  });
  const sizes = new Map<number, number>();
  let untagged = 0;
  facets.forEach((tags, index) => {
    if (tags.length === 0) {
      untagged += 1;
      return;
    }
    const root = find(index);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  });
  return { sizes: [...sizes.values()].sort((a, b) => b - a), untagged };
}

/** Strongly connected sets of two or more nodes, each sorted, in name order. */
export function cycles(
  nodes: readonly string[],
  edges: readonly Edge[],
): string[][] {
  const next = new Map<string, string[]>();
  for (const node of nodes) next.set(node, []);
  for (const edge of edges) {
    if (!next.has(edge.from)) next.set(edge.from, []);
    if (!next.has(edge.to)) next.set(edge.to, []);
    next.get(edge.from)!.push(edge.to);
  }
  for (const list of next.values()) list.sort(compareText);
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const to of next.get(node) ?? []) {
      if (!index.has(to)) {
        visit(to);
        low.set(node, Math.min(low.get(node)!, low.get(to)!));
      } else if (onStack.has(to)) {
        low.set(node, Math.min(low.get(node)!, index.get(to)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const members: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        members.push(member);
      } while (member !== node);
      if (members.length > 1) found.push(members.sort(compareText));
    }
  };
  for (const node of [...next.keys()].sort(compareText)) {
    if (!index.has(node)) visit(node);
  }
  return found.sort((a, b) => compareText(a.join("\n"), b.join("\n")));
}

/** One Facet as the coverage reader sees it. */
export interface FacetHandle {
  /** `#N`, numbered over the whole design in Facet-id order from 1. */
  readonly handle: string;
  readonly id: string;
  readonly source: string;
  readonly component: string;
  readonly section: string;
  /** `Component section N`, N counting the section's Facets in source order. */
  readonly label: string;
  readonly prose: string;
}

/**
 * Number every Facet of a design for the coverage reader. Handles follow
 * Facet-id order, as `sigilc prepare` numbers its handles, so they do not move
 * when a source is reordered. The coverage stage maps the cited handles back
 * to ids with this list before it stores a reading.
 */
export function facetHandles(output: TreeOutput): FacetHandle[] {
  const names = componentNames(output.trees);
  const rows: Omit<FacetHandle, "handle">[] = [];
  for (const tree of output.trees) {
    for (const component of tree.parse.components) {
      const name = names.get(component.iri) ?? component.name;
      for (const section of component.sections) {
        sectionFacets(section).forEach((facet, index) => {
          rows.push({
            id: facet.id,
            source: tree.parse.path,
            component: name,
            section: section.name,
            label: `${name} ${section.name} ${index + 1}`,
            prose: facet.prose,
          });
        });
      }
    }
  }
  rows.sort((a, b) => compareText(a.id, b.id));
  return rows.map((row, index) => ({ handle: `#${index + 1}`, ...row }));
}
