/**
 * Reports across batches. A report is rebuilt from the batch files
 * and the reference alone: every listed batch's stored designs and readings
 * are measured again with the current `sigilc`, so no report mixes binaries,
 * and nothing time-dependent or machine-dependent is printed, so the same
 * inputs give the same bytes.
 *
 * Each measure gets its own table. Pass cells show the pass value and its
 * difference from the reference (pass minus reference); measures are never
 * combined. Batches whose baseline keys differ go to separate baselines, and
 * only the baseline matching the current reference shows the reference.
 */
import { join } from "node:path";
import {
  type BaselineKey,
  batchBaselineKey,
  describeReader,
  designDigest,
  keyDifferences,
  referenceBaselineKey,
  referenceStoreDigest,
  sharedKeyDigest,
} from "./baseline.ts";
import {
  type DesignMeasures,
  measureDesign,
  readDesign,
  type RequirementInputs,
  requirementInputs,
  type SigilcIdentity,
  sigilcIdentity,
  withCoverage,
} from "./measure.ts";
import {
  attemptPaths,
  type Batch,
  benchmarkNamed,
  BENCHMARKS,
  compareText,
  PACKAGE_DIR,
  type PassRecord,
  readBatch,
  type ReaderIdentity,
  type ReadingsIdentity,
  readOptionalJson,
  referenceFor,
  referenceStorePaths,
  REPO_ROOT,
  sameJson,
  SPLIT_PAIRS,
  STAGES,
} from "./records.ts";
import type { ComponentStructure, StructureMeasures } from "./structure.ts";
import { checkCoverageReader, type CoverageFile } from "./coverage.ts";

export type Cell = number | string;
export type Row = readonly [string, Cell];

/** One measure's rows for one design. */
export interface MeasureView {
  /** Set when this measure could not be taken for the design. */
  readonly unavailable?: string;
  readonly design: readonly Row[];
  /** Rows per component, keyed by component name. */
  readonly components?: ReadonlyMap<string, readonly Row[]>;
  /** The value of a row the design does not list, such as 0 findings. */
  readonly missing: Cell;
}

/**
 * The one definition of every measure: its title, which direction is closer
 * to the reference, and what it does not say. The README's "Measures" section
 * states the same text (a test keeps them equal).
 */
export interface MeasureDefinition {
  readonly id: string;
  readonly title: string;
  readonly closer: string;
  readonly notSaid: string;
  readonly view: (measures: DesignMeasures) => MeasureView;
}

const none = (items: readonly string[]) =>
  items.length > 0 ? items.join(", ") : "none";

function perComponent(
  structure: StructureMeasures,
  rows: (component: ComponentStructure) => Row[],
): Map<string, Row[]> {
  return new Map(
    structure.componentList.map((
      component,
    ) => [component.name, rows(component)]),
  );
}

function structural(
  view: (structure: StructureMeasures) => Omit<MeasureView, "unavailable">,
): (measures: DesignMeasures) => MeasureView {
  return (measures) => view(measures.structure);
}

function cyclesCell(cycles: readonly (readonly string[])[]): string {
  return cycles.length > 0
    ? cycles.map((members) => members.join(", ")).join("; ")
    : "none";
}

export const MEASURES: readonly MeasureDefinition[] = [
  {
    id: "components",
    title: "Components per design",
    closer: "A count nearer the reference's.",
    notSaid: "whether the split into components is right.",
    view: structural((s) => ({
      design: [
        ["components", s.components],
        ["sources", s.sources],
        ["sources that do not parse", none(s.invalidSources)],
      ],
      missing: "none",
    })),
  },
  {
    id: "facets-per-role",
    title: "Facets per contract role",
    closer:
      "Counts nearer the reference's for each component and role; fewer than the reference means a thinner contract.",
    notSaid: "whether the Facets say what the reference's Facets say.",
    view: structural((s) => ({
      design: Object.entries(s.facetsByRole),
      components: perComponent(s, (c) => Object.entries(c.facetsByRole)),
      missing: 0,
    })),
  },
  {
    id: "without-state-logic-cases",
    title: "Components without state, logic or cases",
    closer:
      "The same components as the reference, each lacking the same roles; every other listed component is thinner than the reference's.",
    notSaid: "whether that component needs the role.",
    view: structural((s) => ({
      design: [["components listed", s.withoutStateLogicCases.length]],
      components: perComponent(s, (c) => [["lacks", none(c.missingRoles)]]),
      missing: "none",
    })),
  },
  {
    id: "unimported-interface-tags",
    title: "Interface Tags that nothing imports",
    closer: "Counts nearer the reference's for each component.",
    notSaid:
      "whether an unimported Tag is a promise to callers outside the design or an unused one.",
    view: structural((s) => ({
      design: [["Interface Tags", s.unimportedInterfaceTags]],
      components: perComponent(s, (c) => [
        ["count", c.unimportedInterfaceTags.length],
        ["Tags", none(c.unimportedInterfaceTags)],
      ]),
      missing: 0,
    })),
  },
  {
    id: "unbacked-interface-tags",
    title: "Interface Tags with no backing Facet",
    closer:
      "Counts nearer the reference's; more than the reference means more Interface Tags that no state, logic or constraints Facet of the component introduces or mentions.",
    notSaid:
      "whether the Facets that do mention a Tag deliver what it promises.",
    view: structural((s) => ({
      design: [["Interface Tags", s.unbackedInterfaceTags]],
      components: perComponent(s, (c) => [
        ["count", c.unbackedInterfaceTags.length],
        ["Tags", none(c.unbackedInterfaceTags)],
      ]),
      missing: 0,
    })),
  },
  {
    id: "tag-mention-coupling",
    title: "Tag-mention coupling",
    closer: "Edges and mention counts nearer the reference's.",
    notSaid: "whether a coupling is acceptable.",
    view: structural((s) => ({
      design: [
        ["edges", s.coupling.length],
        ["mentions", s.coupling.reduce((sum, edge) => sum + edge.mentions, 0)],
        ...s.coupling.map((edge): Row => [
          `${edge.from} -> ${edge.to}`,
          edge.mentions,
        ]),
      ],
      components: perComponent(s, (c) => [
        [
          "mentions out",
          Object.values(c.mentionsOut).reduce((sum, n) => sum + n, 0),
        ],
        ["mentions in", c.mentionsIn],
      ]),
      missing: 0,
    })),
  },
  {
    id: "import-fan",
    title: "Import fan-in and fan-out",
    closer: "Fan-in and fan-out nearer the reference's for each component.",
    notSaid: "whether the requirement allows a dependency.",
    view: structural((s) => ({
      design: [["import edges", s.importEdges.length]],
      components: perComponent(s, (c) => [
        ["fan-in", c.fanIn],
        ["fan-out", c.fanOut],
        ["imports", none(c.imports)],
      ]),
      missing: 0,
    })),
  },
  {
    id: "tag-sharing-groups",
    title: "Tag-sharing groups",
    closer:
      "Group counts, group sizes and untagged Facets nearer the reference's for each component.",
    notSaid: "whether a component should be split or merged.",
    view: structural((s) => ({
      design: [
        [
          "groups",
          s.componentList.reduce((sum, c) => sum + c.tagGroups.length, 0),
        ],
        [
          "untagged Facets",
          s.componentList.reduce((sum, c) => sum + c.untaggedFacets, 0),
        ],
      ],
      components: perComponent(s, (c) => [
        ["groups", c.tagGroups.length],
        ["group sizes", none(c.tagGroups.map(String))],
        ["untagged Facets", c.untaggedFacets],
      ]),
      missing: 0,
    })),
  },
  {
    id: "import-cycles",
    title: "Import cycles",
    closer:
      "The same cycles as the reference; each other cycle is further from it.",
    notSaid: "whether a cycle is harmful.",
    view: structural((s) => ({
      design: [
        ["cycles", s.importCycles.length],
        ["members", cyclesCell(s.importCycles)],
      ],
      missing: "none",
    })),
  },
  {
    id: "tag-mention-cycles",
    title: "Tag-mention cycles",
    closer:
      "The same cycles as the reference; each other cycle is further from it.",
    notSaid: "whether a cycle is harmful.",
    view: structural((s) => ({
      design: [
        ["cycles", s.mentionCycles.length],
        ["members", cyclesCell(s.mentionCycles)],
      ],
      missing: "none",
    })),
  },
  {
    id: "claims-state",
    title: "Claims state",
    closer: "The same state as the reference.",
    notSaid: "why the state differs; the findings say that.",
    view: (m) =>
      m.claims.status === "unavailable"
        ? { unavailable: m.claims.reason, design: [], missing: "none" }
        : {
          design: [
            ["state", m.claims.value.state],
            ["unresolved imports", m.claims.value.unresolvedImports],
          ],
          missing: "none",
        },
  },
  {
    id: "findings",
    title: "Findings by class and law",
    closer: "Counts nearer the reference's for each class, law and component.",
    notSaid: "whether a finding is a real problem in the design.",
    view: (m) =>
      m.claims.status === "unavailable"
        ? { unavailable: m.claims.reason, design: [], missing: 0 }
        : {
          design: [
            ["findings", m.claims.value.findings],
            ...Object.entries(m.claims.value.byClassLaw),
          ],
          components: new Map(
            m.structure.componentList.map((c) => [
              c.name,
              [[
                "findings",
                (m.claims.status === "available"
                  ? m.claims.value.byComponent[c.name]
                  : 0) ?? 0,
              ] as Row],
            ]),
          ),
          missing: 0,
        },
  },
  {
    id: "unread-units",
    title: "Unread units",
    closer:
      "A count nearer the reference's; unread units leave the claims measures incomplete.",
    notSaid: "anything about the design itself.",
    view: (m) =>
      m.claims.status === "unavailable"
        ? { unavailable: m.claims.reason, design: [], missing: 0 }
        : {
          design: [
            ["unread units", m.claims.value.unreadUnits],
            ["stored readings used", m.claims.value.interpretations],
          ],
          missing: 0,
        },
  },
  {
    id: "requirement-coverage",
    title: "Requirement coverage",
    closer:
      "The same verdict as the reference for each requirement ID, citing Facets that answer it as the reference's do.",
    notSaid:
      "whether a cited Facet answers its requirement well; the counts are not a grade.",
    view: (m) =>
      m.coverage.status === "unavailable"
        ? { unavailable: m.coverage.reason, design: [], missing: "none" }
        : {
          design: [
            ["answered", m.coverage.value.answered],
            ["none", m.coverage.value.none],
            ["not read", m.coverage.value.notRead],
            ...m.coverage.value.entries.map((entry): Row => [
              entry.id,
              entry.verdict === "answered"
                ? `answered: ${entry.facets.map((f) => f.label).join(", ")}`
                : entry.verdict === "none"
                ? "none"
                : "not read",
            ]),
          ],
          missing: "none",
        },
  },
];

export interface Column {
  readonly key: string;
  readonly measures: DesignMeasures;
}

function escapeCell(value: Cell): string {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function withDifference(value: Cell, reference: Cell | undefined): string {
  if (typeof value !== "number" || typeof reference !== "number") {
    return escapeCell(value);
  }
  const difference = value - reference;
  return `${value} (${
    difference === 0 ? "=" : difference > 0 ? `+${difference}` : difference
  })`;
}

function unionLabels(
  rowSets: readonly (readonly Row[] | undefined)[],
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const rows of rowSets) {
    for (const [label] of rows ?? []) {
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
  }
  return labels;
}

function lookup(rows: readonly Row[] | undefined, label: string) {
  return rows?.find(([name]) => name === label)?.[1];
}

/**
 * One measure's table. With a reference, its column comes first, pass cells
 * show their difference from it, and components are matched to it by name.
 */
function renderMeasureTable(
  definition: MeasureDefinition,
  reference: Column | null,
  columns: readonly Column[],
): string[] {
  const all = reference ? [reference, ...columns] : [...columns];
  const views = all.map((column) => definition.view(column.measures));
  const header = [
    `| Row | ${all.map((column) => column.key).join(" | ")} |`,
    `| --- | ${all.map(() => "---").join(" | ")} |`,
  ];
  const lines = [
    `#### ${definition.title}`,
    "",
    `Closer to the reference: ${definition.closer}`,
    "",
    ...header,
  ];
  const cell = (index: number, value: Cell | undefined, refValue?: Cell) => {
    const view = views[index]!;
    if (view.unavailable !== undefined) return "unavailable";
    if (value === undefined) return "—";
    return reference && index > 0
      ? withDifference(value, refValue)
      : escapeCell(value);
  };
  for (const label of unionLabels(views.map((view) => view.design))) {
    const values = views.map((view) =>
      view.unavailable !== undefined
        ? undefined
        : lookup(view.design, label) ?? view.missing
    );
    lines.push(
      `| Design: ${escapeCell(label)} | ${
        values.map((value, index) => cell(index, value, values[0])).join(" | ")
      } |`,
    );
  }
  const hasComponents = views.some((view) => view.components !== undefined);
  const notes: string[] = [];
  if (hasComponents) {
    const referenceNames = reference
      ? [...(views[0]!.components?.keys() ?? [])]
      : null;
    const names = referenceNames ??
      [
        ...new Set(
          views.flatMap((view) => [...(view.components?.keys() ?? [])]),
        ),
      ]
        .sort(compareText);
    for (const name of names) {
      const rowSets = views.map((view) => view.components?.get(name));
      for (const label of unionLabels(rowSets)) {
        const values = views.map((view, index) => {
          const rows = rowSets[index];
          if (view.unavailable !== undefined || rows === undefined) {
            return undefined;
          }
          return lookup(rows, label) ?? view.missing;
        });
        lines.push(
          `| ${escapeCell(name)}: ${escapeCell(label)} | ${
            values.map((value, index) => cell(index, value, values[0]))
              .join(" | ")
          } |`,
        );
      }
    }
    if (referenceNames) {
      const known = new Set(referenceNames);
      views.forEach((view, index) => {
        if (index === 0 || view.unavailable !== undefined) return;
        const own = [...(view.components?.keys() ?? [])];
        const extra = own.filter((name) => !known.has(name));
        const lacking = referenceNames.filter((name) => !own.includes(name));
        const key = all[index]!.key;
        for (const name of extra) {
          const rows = view.components!.get(name)!;
          notes.push(
            `- ${key} has ${name}, which matches no reference component: ${
              rows.map(([label, value]) => `${label} ${escapeCell(value)}`)
                .join("; ")
            }`,
          );
        }
        if (lacking.length > 0) {
          notes.push(`- ${key} has no ${lacking.join(", ")}`);
        }
      });
    }
  }
  views.forEach((view, index) => {
    if (view.unavailable !== undefined) {
      notes.push(`- ${all[index]!.key} unavailable: ${view.unavailable}`);
    }
  });
  // Leave out a table with no rows, as when no column has the measure.
  if (lines.length === 4 + header.length) lines.splice(4, header.length);
  else lines.push("");
  if (notes.length > 0) lines.push(...notes, "");
  return lines;
}

// ---------------------------------------------------------------- measure mode

/** The report `measure` writes for one design. */
export function renderMeasureReport(input: {
  readonly benchmark: string;
  readonly sigilc: SigilcIdentity;
  readonly requirements: RequirementInputs;
  readonly measures: DesignMeasures;
}): string {
  const { measures } = input;
  const claims = measures.claims.status === "available"
    ? measures.claims.value
    : null;
  const lines = [
    `# Design measures: ${input.benchmark}`,
    "",
    "Each measure stands alone. Nothing here calls a model.",
    "",
    "## Identity",
    "",
    `- sigilc: ${input.sigilc.version} (sha256 ${input.sigilc.digest})`,
    `- guidance fingerprint: ${claims?.guidanceFingerprint ?? "unavailable"}`,
    `- vocabulary generation: ${claims?.vocabularyGeneration ?? "unavailable"}`,
    `- design: ${measures.identity.design}`,
    `- claims readings: ${measures.identity.readings ?? "none"}`,
    `- stored readings used: ${claims?.interpretationsDigest ?? "unavailable"}`,
    `- coverage reading: ${measures.identity.coverage ?? "none"}`,
    `- requirement list ${input.requirements.listName}: ${input.requirements.listDigest}`,
    `- requirement file ${input.benchmark}: ${input.requirements.requirementFileDigest}`,
    "",
    "## Measures",
    "",
  ];
  for (const definition of MEASURES) {
    lines.push(
      ...renderMeasureTable(definition, null, [{
        key: "Design",
        measures,
      }]),
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// --------------------------------------------------------------------- reports

export interface ReferenceLocation {
  /** The reference design. */
  readonly root: string;
  /** The reference store directory (see records.ts). */
  readonly dir: string;
}

/** A list's reference: the one given in `references`, else the registered one. */
export function referenceLocationFor(
  list: string,
  options: {
    readonly references?: Readonly<Record<string, ReferenceLocation>>;
    readonly repoRoot: string;
    readonly packageDir: string;
  },
): ReferenceLocation {
  const given = options.references?.[list];
  if (given) return given;
  const definition = referenceFor(list);
  return {
    root: join(options.repoRoot, definition.root),
    dir: join(options.packageDir, definition.store),
  };
}

export interface ReportOptions {
  readonly batchDirs: readonly string[];
  readonly sigilc: string;
  readonly repoRoot?: string;
  readonly packageDir?: string;
  /** Requirement list name to its reference, replacing `REFERENCES`. */
  readonly references?: Readonly<Record<string, ReferenceLocation>>;
}

interface LoadedReference {
  readonly list: string;
  readonly location: ReferenceLocation;
  readonly reader: ReaderIdentity;
  readonly readings: ReadingsIdentity | null;
  readonly tree: string;
  readonly store: string;
}

interface PassEntry {
  readonly batch: Batch;
  readonly record: PassRecord;
  readonly excluded: string | null;
  key: string;
  measures: DesignMeasures | null;
}

interface Group {
  readonly id: string;
  readonly list: string;
  readonly key: BaselineKey;
  readonly current: boolean;
  /** Why the reference column is left out, when it is. */
  readonly differences: readonly string[];
  readonly batches: Batch[];
}

const STAGE_NAMES: Record<string, string> = {
  writer: "writer",
  readScan: "read scan",
  claims: "claims",
  coverage: "coverage",
};

function shownStatus(status: string): string {
  // A record left running belongs to a batch that stopped: show it as such.
  return status === "running" ? "interrupted" : status;
}

function exclusion(record: PassRecord): string | null {
  if (record.reads === "forbidden") return "invalid: a forbidden read";
  for (const stage of STAGES) {
    const state = record.stages[stage];
    if (state?.status === "invalid") {
      return `invalid at ${STAGE_NAMES[stage]}${
        state.error ? `: ${state.error}` : ""
      }`;
    }
  }
  const writer = record.stages.writer;
  if (writer?.status !== "done") {
    return `writer ${shownStatus(writer?.status ?? "pending")}${
      writer?.error ? `: ${writer.error}` : ""
    }`;
  }
  const readScan = record.stages.readScan;
  if (readScan?.status !== "done") {
    return `read scan ${shownStatus(readScan?.status ?? "pending")}${
      readScan?.error ? `: ${readScan.error}` : ""
    }`;
  }
  return null;
}

/** Why with-split and without-split are not compared; null when they are. */
function splitMismatch(
  withSplit: { batch: Batch; agent: string; model: string },
  withoutSplit: { batch: Batch; agent: string; model: string },
): string | null {
  const a = withSplit.batch.manifest;
  const b = withoutSplit.batch.manifest;
  const reasons: string[] = [];
  if (withSplit.agent !== withoutSplit.agent) reasons.push("agent differs");
  if (withSplit.model !== withoutSplit.model) reasons.push("model differs");
  if (a.effort !== b.effort) {
    reasons.push(`reasoning level differs (${a.effort} and ${b.effort})`);
  }
  if (!sameJson(a.skillDigests, b.skillDigests)) {
    reasons.push("skill revisions differ");
  }
  if (a.passes !== b.passes) {
    reasons.push(`pass count differs (${a.passes} and ${b.passes})`);
  }
  if (a.writerBinaries.sigil !== b.writerBinaries.sigil) {
    reasons.push("writer sigil digest differs");
  }
  if (a.writerBinaries.sigilc !== b.writerBinaries.sigilc) {
    reasons.push("writer sigilc digest differs");
  }
  return reasons.length > 0 ? reasons.join("; ") : null;
}

function describeKey(
  key: BaselineKey,
  files: Record<string, string>,
): string[] {
  return [
    `- guidance fingerprint (law set): ${key.guidanceFingerprint ?? "none"}`,
    `- vocabulary generation: ${key.vocabularyGeneration ?? "none"}`,
    `- reference design: ${key.referenceTree}`,
    `- reference readings: ${key.referenceStore}`,
    `- pinned reader: ${describeReader(key.reader)}`,
    `- requirement list: ${key.requirementList}`,
    ...Object.entries(files).sort(([a], [b]) => compareText(a, b)).map((
      [benchmark, digest],
    ) => `- requirement file ${benchmark}: ${digest}`),
  ];
}

function stagesCell(record: PassRecord): string {
  return STAGES.map((stage) =>
    `${STAGE_NAMES[stage]} ${
      shownStatus(record.stages[stage]?.status ?? "pending")
    }`
  ).join(", ");
}

/** How many passes a report measures at once. */
const MEASURE_CONCURRENCY = 4;

/**
 * Run `task` on every item, at most `limit` at a time, starting them in order.
 * After a failure no further item starts; once the started ones settle, the
 * failure of the earliest item is thrown, as running them one by one would.
 */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const failures = new Map<number, unknown>();
  let next = 0;
  const worker = async () => {
    while (next < items.length && failures.size === 0) {
      const index = next++;
      try {
        await task(items[index]!);
      } catch (cause) {
        failures.set(index, cause);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  if (failures.size > 0) throw failures.get(Math.min(...failures.keys()));
}

/** Build the report text for the listed batches. */
export async function buildReport(options: ReportOptions): Promise<string> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const packageDir = options.packageDir ?? PACKAGE_DIR;
  if (options.batchDirs.length === 0) {
    throw new Error("report needs at least one batch directory");
  }
  const sigilc = await sigilcIdentity(options.sigilc);
  const batches = await Promise.all(options.batchDirs.map(readBatch));
  const names = new Set<string>();
  for (const batch of batches) {
    if (names.has(batch.name)) {
      throw new Error(`Two listed batches are named ${batch.name}`);
    }
    names.add(batch.name);
  }

  const requirements = new Map<string, RequirementInputs>();
  const inputsFor = async (benchmark: string) => {
    let found = requirements.get(benchmark);
    if (!found) {
      found = await requirementInputs(benchmark, packageDir);
      requirements.set(benchmark, found);
    }
    return found;
  };

  const references = new Map<string, LoadedReference>();
  for (const batch of batches) {
    const list = benchmarkNamed(batch.manifest.benchmark).list;
    if (references.has(list)) continue;
    const location = referenceLocationFor(list, {
      references: options.references,
      repoRoot,
      packageDir,
    });
    const paths = referenceStorePaths(location.dir);
    const reader = await readOptionalJson<ReaderIdentity>(paths.reader);
    if (!reader) {
      throw new Error(
        `The reference store for ${list} has no reader.json; pin the reference before reporting`,
      );
    }
    const coverage = await readOptionalJson<CoverageFile>(paths.coverage);
    if (coverage) checkCoverageReader(coverage, reader);
    references.set(list, {
      list,
      location,
      reader,
      readings: await readOptionalJson<ReadingsIdentity>(paths.readings),
      tree: await designDigest(location.root),
      store: await referenceStoreDigest(location.dir),
    });
  }

  // Every batch must share the reference's pinned reader.
  for (const batch of batches) {
    const reference = references.get(
      benchmarkNamed(batch.manifest.benchmark).list,
    )!;
    if (!sameJson(batch.manifest.reader, reference.reader)) {
      throw new Error(
        `Batch ${batch.name} was read by ${
          describeReader(batch.manifest.reader)
        }, but the reference store's pinned reader is ${
          describeReader(reference.reader)
        }; report refuses to compare them`,
      );
    }
  }

  // Group batches by baseline.
  const groups = new Map<string, Group>();
  for (const batch of batches) {
    const benchmark = batch.manifest.benchmark;
    const list = benchmarkNamed(benchmark).list;
    const reference = references.get(list)!;
    const inputs = await inputsFor(benchmark);
    const key = batchBaselineKey(batch.manifest);
    const current = referenceBaselineKey({
      readings: reference.readings,
      referenceTree: reference.tree,
      referenceStore: reference.store,
      reader: reference.reader,
      requirementList: inputs.listDigest,
      benchmark,
      requirementFile: inputs.requirementFileDigest,
    });
    const shared = await sharedKeyDigest(key);
    const fileCurrent =
      key.requirementFile.digest === inputs.requirementFileDigest;
    const isCurrent = fileCurrent &&
      shared === await sharedKeyDigest(current);
    const id = `${list}|${shared}${
      fileCurrent ? "" : `|${benchmark}:${key.requirementFile.digest}`
    }`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        list,
        key,
        current: isCurrent,
        differences: isCurrent ? [] : keyDifferences(key, current),
        batches: [],
      };
      groups.set(id, group);
    }
    group.batches.push(batch);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    a.current !== b.current ? (a.current ? -1 : 1) : compareText(a.id, b.id)
  );

  const lines = [
    "# Design-quality report",
    "",
    "Each measure has its own table. A pass cell shows the pass value and, in",
    "brackets, the pass minus the reference. Measures are never combined.",
    "",
    "## Measured with",
    "",
    `- sigilc: ${sigilc.version} (sha256 ${sigilc.digest})`,
    "- every listed batch was measured again with this sigilc",
    "",
  ];

  let groupNumber = 0;
  for (const group of ordered) {
    groupNumber += 1;
    group.batches.sort((a, b) => compareText(a.name, b.name));
    const reference = references.get(group.list)!;
    const benchmarks = BENCHMARKS.map((entry) => entry.name).filter((name) =>
      group.batches.some((batch) => batch.manifest.benchmark === name)
    );
    const files: Record<string, string> = {};
    for (const batch of group.batches) {
      files[batch.manifest.benchmark] = batch.manifest.requirements
        .requirementFile;
    }

    // Read the reference once; only its coverage is checked per benchmark,
    // against that benchmark's file.
    const referenceMeasures = new Map<string, DesignMeasures>();
    if (group.current && benchmarks.length > 0) {
      const paths = referenceStorePaths(reference.location.dir);
      const reading = await readDesign({
        sigilc: options.sigilc,
        root: reference.location.root,
        store: paths.store,
        coverage: { path: paths.coverage },
      });
      for (const benchmark of benchmarks) {
        referenceMeasures.set(
          benchmark,
          withCoverage(reading, {
            requirements: await inputsFor(benchmark),
            expectedReader: reference.reader,
            onCoverageError: "unavailable",
          }),
        );
      }
    }

    // Measure every pass again with the current sigilc.
    const entries: PassEntry[] = [];
    for (const batch of group.batches) {
      for (const record of batch.records) {
        entries.push({
          batch,
          record,
          excluded: exclusion(record),
          key: "",
          measures: null,
        });
      }
    }
    const measured = entries.filter((entry) => entry.excluded === null);
    const requirementsOf = new Map<PassEntry, RequirementInputs>();
    for (const entry of measured) {
      requirementsOf.set(
        entry,
        await inputsFor(entry.batch.manifest.benchmark),
      );
    }
    await forEachLimited(measured, MEASURE_CONCURRENCY, async (entry) => {
      const paths = attemptPaths(entry.batch.dir, entry.record.id);
      const claims = entry.record.stages.claims?.status;
      const coverage = entry.record.stages.coverage?.status;
      const sameReader = sameJson(
        entry.record.reader ?? entry.batch.manifest.reader,
        entry.batch.manifest.reader,
      );
      const wrongReader =
        "readings were taken by a different reader; reread with --coverage";
      entry.measures = await measureDesign({
        sigilc: options.sigilc,
        root: paths.design,
        store: paths.store,
        expectedReader: entry.batch.manifest.reader,
        claimsUnavailable: !sameReader
          ? wrongReader
          : claims === "done"
          ? undefined
          : `claims stage ${shownStatus(claims ?? "pending")}`,
        coverage: !sameReader
          ? { reason: wrongReader }
          : coverage === "done"
          ? { path: paths.coverage }
          : {
            reason: `coverage stage ${shownStatus(coverage ?? "pending")}`,
          },
        requirements: requirementsOf.get(entry)!,
        onCoverageError: "unavailable",
      });
    });
    const order = (e: PassEntry) =>
      [
        e.record.agent,
        e.record.model,
        e.batch.manifest.effort,
        e.batch.name,
        e.record.id,
      ].join("\n");
    const sortedEntries = [...entries].sort((a, b) =>
      benchmarks.indexOf(a.batch.manifest.benchmark) -
        benchmarks.indexOf(b.batch.manifest.benchmark) ||
      compareText(order(a), order(b))
    );
    let columnNumber = 0;
    for (const entry of sortedEntries) {
      if (entry.measures) entry.key = `P${++columnNumber}`;
    }

    lines.push(
      `## Baseline ${groupNumber}${
        group.current ? " (the current reference)" : ""
      }`,
      "",
    );
    if (!group.current) {
      lines.push(
        `The reference column is left out: these batches ran under a different baseline (${
          group.differences.join(", ")
        }). Their numbers are compared only with each other.`,
        "",
      );
    }
    lines.push("Baseline key:", "", ...describeKey(group.key, files), "");

    if (group.current) {
      const first = referenceMeasures.get(benchmarks[0]!)!;
      const claims = first.claims.status === "available"
        ? first.claims.value
        : null;
      const registered = referenceFor(group.list).root;
      const referenceName =
        reference.location.root === join(repoRoot, registered)
          ? registered
          : "the design given as the reference";
      lines.push(
        "### Reference",
        "",
        `- design: ${referenceName} (${first.identity.design})`,
        `- claims readings: ${first.identity.readings ?? "none"}`,
        `- stored readings used: ${
          claims?.interpretationsDigest ?? "unavailable"
        }`,
        `- guidance fingerprint of this sigilc: ${
          claims?.guidanceFingerprint ?? "unavailable"
        }`,
        `- vocabulary generation of this sigilc: ${
          claims?.vocabularyGeneration ?? "unavailable"
        }`,
        `- coverage reading: ${first.identity.coverage ?? "none"}`,
        "",
      );
    }

    lines.push(
      "### Batches",
      "",
      "| Batch | Benchmark | Writers | Reasoning | Passes | Writer skills | Writer sigil | Writer sigilc | Readings taken under |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const batch of group.batches) {
      const m = batch.manifest;
      lines.push(
        `| ${batch.name} | ${m.benchmark} | ${
          m.writers.map((w) => `${w.agent}:${w.model}`).join(", ")
        } | ${m.effort} | ${m.passes} | ${
          escapeCell(
            Object.entries(m.skillDigests).sort(([a], [b]) => compareText(a, b))
              .map(([name, digest]) => `${name} ${digest}`).join(", "),
          )
        } | ${m.writerBinaries.sigil} | ${m.writerBinaries.sigilc} | ${
          m.readings
            ? `${m.readings.guidanceFingerprint}, vocabulary ${m.readings.vocabularyGeneration}`
            : "none"
        } |`,
      );
    }
    lines.push(
      "",
      "### Passes",
      "",
      "| Column | Batch | Pass | Benchmark | Writer | Reasoning | Stages | Reads | Review | Claims readings | Stored readings used | Coverage reading |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const entry of sortedEntries) {
      const m = entry.measures;
      const claims = m?.claims.status === "available" ? m.claims.value : null;
      lines.push(
        `| ${
          entry.key || `not measured: ${escapeCell(entry.excluded ?? "")}`
        } | ${entry.batch.name} | ${entry.record.id} | ${entry.batch.manifest.benchmark} | ${entry.record.agent}:${entry.record.model} | ${entry.batch.manifest.effort} | ${
          stagesCell(entry.record)
        } | ${entry.record.reads} | ${entry.record.review} | ${
          m?.identity.readings ?? "none"
        } | ${claims?.interpretationsDigest ?? "unavailable"} | ${
          m?.identity.coverage ?? "none"
        } |`,
      );
    }
    lines.push("");

    for (const benchmark of benchmarks) {
      const columns = sortedEntries.filter((entry) =>
        entry.measures && entry.batch.manifest.benchmark === benchmark
      ).map((entry) => ({ key: entry.key, measures: entry.measures! }));
      const referenceColumn = group.current
        ? { key: "Reference", measures: referenceMeasures.get(benchmark)! }
        : null;
      lines.push(`### ${benchmark}`, "");
      if (columns.length === 0) {
        lines.push("No pass of this benchmark was measured.", "");
      }
      for (const definition of MEASURES) {
        lines.push(...renderMeasureTable(definition, referenceColumn, columns));
      }
    }

    lines.push(
      ...renderSplitComparison(group, sortedEntries, referenceMeasures),
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** With-split beside without-split, only where the writers match. */
function renderSplitComparison(
  group: Group,
  entries: readonly PassEntry[],
  referenceMeasures: ReadonlyMap<string, DesignMeasures>,
): string[] {
  const lines: string[] = [];
  for (const pair of SPLIT_PAIRS) {
    const cohorts = (benchmark: string) => {
      const out = new Map<
        string,
        { batch: Batch; agent: string; model: string; entries: PassEntry[] }
      >();
      for (const entry of entries) {
        if (entry.batch.manifest.benchmark !== benchmark) continue;
        const id =
          `${entry.batch.name}\n${entry.record.agent}\n${entry.record.model}`;
        const cohort = out.get(id) ?? {
          batch: entry.batch,
          agent: entry.record.agent,
          model: entry.record.model,
          entries: [],
        };
        cohort.entries.push(entry);
        out.set(id, cohort);
      }
      return [...out.values()];
    };
    const withSplit = cohorts(pair.withSplit);
    const withoutSplit = cohorts(pair.withoutSplit);
    if (withSplit.length === 0 || withoutSplit.length === 0) continue;
    lines.push(
      `### Split comparison: ${pair.withSplit} and ${pair.withoutSplit}`,
      "",
      "Compared only where agent, model, reasoning level, skill revisions, pass count and writer binaries all match.",
      "",
    );
    for (const a of withSplit) {
      for (const b of withoutSplit) {
        const label =
          `${a.batch.name} (${a.agent}:${a.model}) and ${b.batch.name} (${b.agent}:${b.model})`;
        const mismatch = splitMismatch(a, b);
        if (mismatch) {
          lines.push(`- Not compared: ${label}: ${mismatch}.`, "");
          continue;
        }
        const columns: Column[] = [...a.entries, ...b.entries]
          .filter((entry) => entry.measures)
          .map((entry) => ({ key: entry.key, measures: entry.measures! }));
        const reference = group.current
          ? referenceMeasures.get(pair.withSplit) ?? null
          : null;
        lines.push(
          `#### ${label}`,
          "",
          `Columns ${
            a.entries.map((e) => e.key).filter(Boolean).join(", ")
          } are ${pair.withSplit}; ${
            b.entries.map((e) => e.key).filter(Boolean).join(", ")
          } are ${pair.withoutSplit}. Design totals only; each row is one measure's own row.`,
          "",
        );
        const all = reference
          ? [{ key: "Reference", measures: reference }, ...columns]
          : columns;
        lines.push(
          `| Row | ${all.map((column) => column.key).join(" | ")} |`,
          `| --- | ${all.map(() => "---").join(" | ")} |`,
        );
        for (const definition of MEASURES) {
          const views = all.map((column) => definition.view(column.measures));
          for (const row of unionLabels(views.map((view) => view.design))) {
            const values = views.map((view) =>
              view.unavailable !== undefined
                ? undefined
                : lookup(view.design, row) ?? view.missing
            );
            lines.push(
              `| ${definition.title}: ${escapeCell(row)} | ${
                values.map((value, index) =>
                  value === undefined
                    ? "unavailable"
                    : reference && index > 0
                    ? withDifference(value, values[0])
                    : escapeCell(value)
                ).join(" | ")
              } |`,
            );
          }
        }
        lines.push("");
      }
    }
  }
  return lines;
}
