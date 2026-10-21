/**
 * The files the design-quality benchmark keeps, and where they live.
 *
 * Batch layout. `run` writes, and `report` reads, one directory per batch
 * under `.benchmarks/` at the repository root:
 *
 * ```
 * .benchmarks/<batch>/manifest.json          BatchManifest
 * .benchmarks/<batch>/attempts/<id>/record.json   PassRecord
 * .benchmarks/<batch>/attempts/<id>/design/       the workspace the writer authored
 * .benchmarks/<batch>/attempts/<id>/store/        the pinned reader's claims readings,
 *                                                 a `sigilc --store` directory
 *                                                 (`store/claims/interpretations/`)
 * .benchmarks/<batch>/attempts/<id>/coverage.json the coverage reading (coverage.ts)
 * .benchmarks/<batch>/attempts/<id>/evidence/     host events and stage output
 * ```
 *
 * Reference store layout. The pinned reference readings for one requirement
 * list live in the package, beside nothing else:
 *
 * ```
 * reference/<list>/store/claims/interpretations/  the reference's claims readings
 * reference/<list>/readings.json                   ReadingsIdentity they were taken under
 * reference/<list>/coverage.json                   the reference's coverage reading
 * reference/<list>/reader.json                     ReaderIdentity of the pinned reader
 * reference/<list>/reader-skills/<skill>/          the reader's frozen skills
 * ```
 *
 * The reference design itself is never copied: it is the `root` registered in
 * `BENCHMARKS`, used with the reference store so nothing is written into it.
 *
 * Reports are rebuilt from these files alone. Nothing time-dependent, such as
 * `createdAt`, may appear in a report, so the same inputs give the same bytes.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { AgentStatus } from "../agent-runner/agents.ts";
import { exists, isNotFound } from "../agent-runner/files.ts";
import type { ReviewMark, WriterState } from "./writer.ts";

export const BATCH_VERSION = 1;
export const COVERAGE_VERSION = 1;

/** One benchmark: its requirement file and the requirement list it shares. */
export interface BenchmarkDefinition {
  readonly name: string;
  /** Relative to the package directory. */
  readonly requirementFile: string;
  /** The requirement list name; `benchmarks/<list>/requirements.json`. */
  readonly list: string;
}

/** A requirement list's reference: a committed design and its readings. */
export interface ReferenceDefinition {
  readonly list: string;
  /** The reference design, relative to the repository root. */
  readonly root: string;
  /** The reference store directory, relative to the package directory. */
  readonly store: string;
  /**
   * The benchmark whose requirement file the reference's coverage reader is
   * given. The reference's reading stands for every benchmark of the list.
   */
  readonly coverageBenchmark: string;
}

/** A with-split and a without-split benchmark that a report compares. */
export interface SplitPair {
  readonly withSplit: string;
  readonly withoutSplit: string;
}

export const BENCHMARKS: readonly BenchmarkDefinition[] = [
  {
    name: "slotted-with-split",
    requirementFile: "benchmarks/slotted-with-split/requirement.md",
    list: "slotted",
  },
  {
    name: "slotted-without-split",
    requirementFile: "benchmarks/slotted-without-split/requirement.md",
    list: "slotted",
  },
];

export const REFERENCES: readonly ReferenceDefinition[] = [
  {
    list: "slotted",
    root: "examples/slotted",
    store: "reference/slotted",
    // The text without the module split: the split assigns IDs to components
    // and states no requirement of its own.
    coverageBenchmark: "slotted-without-split",
  },
];

export const SPLIT_PAIRS: readonly SplitPair[] = [
  { withSplit: "slotted-with-split", withoutSplit: "slotted-without-split" },
];

export function benchmarkNamed(name: string): BenchmarkDefinition {
  const found = BENCHMARKS.find((entry) => entry.name === name);
  if (!found) {
    throw new Error(
      `Unknown benchmark: ${name} (known: ${
        BENCHMARKS.map((entry) => entry.name).join(", ")
      })`,
    );
  }
  return found;
}

export function referenceFor(list: string): ReferenceDefinition {
  const found = REFERENCES.find((entry) => entry.list === list);
  if (!found) throw new Error(`No reference for requirement list ${list}`);
  return found;
}

/** The package directory and the repository root. */
export const PACKAGE_DIR = fileURLToPath(new URL(".", import.meta.url));
export const REPO_ROOT = join(PACKAGE_DIR, "..", "..");

/** The debug build of `name` in `packages/<pkg>` of the repository. */
export function defaultBinary(
  pkg: string,
  name: string,
  repoRoot = REPO_ROOT,
): string {
  return join(
    repoRoot,
    `packages/${pkg}/target/debug/${name}${
      process.platform === "win32" ? ".exe" : ""
    }`,
  );
}

/** The default `sigilc`: the debug build in the repository. */
export function defaultSigilc(repoRoot = REPO_ROOT): string {
  return defaultBinary("sigilc", "sigilc", repoRoot);
}

/** The default `sigil`: the debug build in the repository. */
export function defaultSigil(repoRoot = REPO_ROOT): string {
  return defaultBinary("cli", "sigil", repoRoot);
}

/** Where a `sigilc --store` directory keeps its claims readings. */
export const INTERPRETATIONS_DIR = join("claims", "interpretations");

/** One entry of `benchmarks/<list>/requirements.json`. */
export interface RequirementEntry {
  readonly id: string;
  readonly label: string;
}

export interface RequirementList {
  readonly benchmark: string;
  readonly requirements: readonly RequirementEntry[];
}

/** The pinned reader: who takes every claims and coverage reading. */
export interface ReaderIdentity {
  readonly agent: string;
  readonly model: string;
  readonly effort: string;
  /** Skill name to the digest of its frozen copy in `reader-skills/`. */
  readonly skillDigests: Readonly<Record<string, string>>;
  readonly coveragePromptDigest: string;
}

/** What a set of claims readings was taken under; readings are keyed by it. */
export interface ReadingsIdentity {
  readonly guidanceFingerprint: string;
  readonly vocabularyGeneration: number;
}

/** The digests a batch's requirement inputs had when it ran. */
export interface RequirementDigests {
  readonly requirementFile: string;
  readonly requirementList: string;
}

/** The reference's identity when a batch ran (see baseline.ts). */
export interface ReferenceDigests {
  /** `designDigest` of the reference design. */
  readonly tree: string;
  /** `referenceStoreDigest` of the reference store. */
  readonly store: string;
}

export interface WriterIdentity {
  readonly agent: string;
  readonly model: string;
}

/** `.benchmarks/<batch>/manifest.json`. */
export interface BatchManifest {
  readonly version: typeof BATCH_VERSION;
  /** A name from `BENCHMARKS`. */
  readonly benchmark: string;
  readonly writers: readonly WriterIdentity[];
  /** The reasoning level every writer ran at. */
  readonly effort: string;
  /** Passes per writer. */
  readonly passes: number;
  /** Writer skill name to the digest of the staged copy. */
  readonly skillDigests: Readonly<Record<string, string>>;
  /** Digests of the `sigil` and `sigilc` binaries the writer was given. */
  readonly writerBinaries: { readonly sigil: string; readonly sigilc: string };
  readonly reader: ReaderIdentity;
  readonly requirements: RequirementDigests;
  readonly reference: ReferenceDigests;
  /** What the batch's claims readings were taken under; null before any. */
  readonly readings: ReadingsIdentity | null;
  /** Bounds each stage of a pass. */
  readonly timeoutMs?: number;
  /** Each `reread` that replaced the batch's readings, oldest first. */
  readonly rereads?: readonly RereadEntry[];
  /** Kept for people reading the files; never shown in a report. */
  readonly createdAt?: string;
}

/** One `reread` of a batch's stored designs. */
export interface RereadEntry {
  readonly at: string;
  readonly coverage: boolean;
  /** The readings identity the batch had before this reread. */
  readonly previous: ReadingsIdentity | null;
}

export type StageStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "interrupted"
  | "invalid"
  | "unavailable";

export const STAGES = ["writer", "readScan", "claims", "coverage"] as const;
export type StageName = typeof STAGES[number];

export interface StageState {
  readonly status: StageStatus;
  readonly error: string | null;
}

/** `record` with `stage` set to `state`. */
export function withStage(
  record: PassRecord,
  stage: StageName,
  state: StageState,
): PassRecord {
  return { ...record, stages: { ...record.stages, [stage]: state } };
}

/** The stage a record shows running, or `fallback` when none is. */
export function runningStage(
  record: PassRecord,
  fallback: StageName,
): StageName {
  return STAGES.find((stage) => record.stages[stage].status === "running") ??
    fallback;
}

/** `.benchmarks/<batch>/attempts/<id>/record.json`. */
export interface PassRecord {
  readonly version: typeof BATCH_VERSION;
  readonly id: string;
  readonly agent: string;
  readonly model: string;
  readonly stages: Readonly<Record<StageName, StageState>>;
  /** Whether host events showed a forbidden read, or could not show reads. */
  readonly reads: "clean" | "forbidden" | "unverified";
  /** Whether the writer handed back a delegated `sigil-evaluate` review. */
  readonly review: ReviewMark;
  /** The staging directory under the OS temp directory, while it exists. */
  readonly stagingPath: string | null;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  /** What the writer host showed and handed back. */
  readonly writer?: WriterObservation | null;
  /** What made the pass invalid or its reads unverified. */
  readonly integrity?: IntegrityFindings | null;
  /** The state the claims reader handed back, when it gave one. */
  readonly claimsHandback?: string | null;
}

export interface WriterObservation {
  /** The host's own status. */
  readonly status: AgentStatus;
  /** The hand-back line's state, or null when the writer gave none. */
  readonly state: WriterState | null;
  readonly observedModels: readonly string[];
  readonly childCount: number | null;
  /** Reviewer children the orchestrator started, where the host shows it. */
  readonly reviewerStarts: number | null;
}

export interface IntegrityFindings {
  /** Each forbidden read, as `actor tool path (root)`. */
  readonly forbiddenReads: readonly string[];
  readonly unverifiedReason: string | null;
  /** Staged inputs whose bytes changed: the requirement, a skill, a binary. */
  readonly changedInputs: readonly string[];
  /** Writes outside `design/`, `run/` and `store/`, from both checks. */
  readonly outsideWrites: readonly string[];
}

/** Paths inside one attempt directory. */
export function attemptPaths(batchDir: string, id: string) {
  const dir = join(batchDir, "attempts", id);
  return {
    dir,
    record: join(dir, "record.json"),
    design: join(dir, "design"),
    store: join(dir, "store"),
    coverage: join(dir, "coverage.json"),
    evidence: join(dir, "evidence"),
  };
}

/** Paths inside a reference store directory. */
export function referenceStorePaths(dir: string) {
  return {
    dir,
    store: join(dir, "store"),
    readings: join(dir, "readings.json"),
    coverage: join(dir, "coverage.json"),
    reader: join(dir, "reader.json"),
    readerSkills: join(dir, "reader-skills"),
  };
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Read a JSON file, or null when it does not exist. */
export async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(path);
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw cause;
  }
}

export interface Batch {
  readonly dir: string;
  readonly name: string;
  readonly manifest: BatchManifest;
  /** Sorted by id. */
  readonly records: readonly PassRecord[];
}

/** Read a batch's manifest and every pass record. */
export async function readBatch(dir: string): Promise<Batch> {
  const manifestPath = join(dir, "manifest.json");
  if (!(await exists(manifestPath))) {
    throw new Error(`${dir} is not a batch: it has no manifest.json`);
  }
  const manifest = await readJsonFile<BatchManifest>(manifestPath);
  if (manifest.version !== BATCH_VERSION) {
    throw new Error(
      `${manifestPath} has version ${manifest.version}, not ${BATCH_VERSION}`,
    );
  }
  benchmarkNamed(manifest.benchmark);
  const records: PassRecord[] = [];
  let ids: string[] = [];
  try {
    ids = (await readdir(join(dir, "attempts"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (cause) {
    if (!isNotFound(cause)) throw cause;
  }
  for (const id of ids.sort(compareText)) {
    const record = await readOptionalJson<PassRecord>(
      attemptPaths(dir, id).record,
    );
    if (record) records.push(record);
  }
  const name = dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? dir;
  return { dir, name, manifest, records };
}

/**
 * Create `.benchmarks/` with a `.gitignore` of `*`, so neither the folder nor
 * its contents show in `git status`. An existing `.gitignore` is kept.
 */
export async function ensureEvidenceRoot(
  repoRoot = REPO_ROOT,
): Promise<string> {
  const root = join(repoRoot, ".benchmarks");
  await mkdir(root, { recursive: true });
  const gitignore = join(root, ".gitignore");
  if (!(await exists(gitignore))) await writeFile(gitignore, "*\n");
  return root;
}

/** Locale-independent ordering, so reports never depend on the machine. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True when two values give the same `canonicalJson`. */
export function sameJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** JSON with object keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => compareText(a, b));
    return Object.fromEntries(
      entries.map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}
