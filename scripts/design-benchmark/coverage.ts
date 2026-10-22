/**
 * Requirement coverage: which Facets a stored reading judges to
 * answer each requirement ID, never a score.
 *
 * The coverage stage gives the pinned reader the requirement list and
 * every Facet with a `#N` handle from `facetHandles` (structure.ts). The reader
 * cites handles; the stage maps them to tree ids and stores one file:
 *
 * ```json
 * {
 *   "version": 1,
 *   "requirementList": { "name": "slotted", "digest": "<sha256 of requirements.json>" },
 *   "requirementFiles": { "slotted-with-split": "<sha256 of requirement.md>" },
 *   "reader": { ...ReaderIdentity },
 *   "entries": [
 *     { "id": "R22", "verdict": "answered",
 *       "facets": [{ "id": "facet:<hex>", "label": "Booking constraints 3" }] },
 *     { "id": "R23", "verdict": "none", "facets": [] },
 *     { "id": "AE1", "verdict": "not-read", "facets": [], "note": "reader timed out" }
 *   ]
 * }
 * ```
 *
 * `requirementFiles` names each benchmark requirement file the reading is valid
 * for, by digest: a pass's reading names its own benchmark, and the reference's
 * reading names every benchmark that shares the list. `answered` means a Facet
 * answers the requirement, not merely mentions it. `not-read` means the reader
 * refused or timed out, or cited a handle that does not exist.
 */
import { errorMessage } from "../agent-runner/files.ts";
import type { RequirementInputs } from "./measure.ts";
import {
  canonicalJson,
  COVERAGE_VERSION,
  type ReaderIdentity,
  sameJson,
} from "./records.ts";

const VERDICTS = ["answered", "none", "not-read"] as const;
export type Verdict = typeof VERDICTS[number];

export interface CoverageFacet {
  readonly id: string;
  readonly label: string;
}

export interface CoverageEntry {
  readonly id: string;
  readonly verdict: Verdict;
  readonly facets: readonly CoverageFacet[];
  readonly note?: string;
}

export interface CoverageFile {
  readonly version: typeof COVERAGE_VERSION;
  readonly requirementList: { readonly name: string; readonly digest: string };
  readonly requirementFiles: Readonly<Record<string, string>>;
  readonly reader: ReaderIdentity;
  readonly entries: readonly CoverageEntry[];
}

/** What a coverage file must match to be measured. */
export interface CoverageContext extends RequirementInputs {
  readonly expectedReader?: ReaderIdentity;
  /** Every Facet id in the design's tree, with its label. */
  readonly facets: ReadonlyMap<string, string>;
}

export interface CoverageMeasures {
  /** The file's digest: the identity of this stored reading. */
  readonly digest: string;
  readonly answered: number;
  readonly none: number;
  readonly notRead: number;
  /** In requirement-list order. */
  readonly entries: readonly CoverageEntry[];
}

export class CoverageError extends Error {}

export function checkCoverageReader(
  file: CoverageFile,
  expected: ReaderIdentity,
): void {
  if (!sameJson(file.reader, expected)) {
    throw new CoverageError(
      `coverage was read by ${
        canonicalJson(file.reader)
      }, but the expected reader is ${
        canonicalJson(expected)
      }; reread with --coverage`,
    );
  }
}

/**
 * Validate a coverage file against the design and the current requirement
 * inputs, and count its verdicts. Throws `CoverageError` naming what is wrong.
 */
export function measureCoverage(
  file: CoverageFile,
  digest: string,
  context: CoverageContext,
): CoverageMeasures {
  if (context.expectedReader) checkCoverageReader(file, context.expectedReader);
  if (file.version !== COVERAGE_VERSION) {
    throw new CoverageError(
      `coverage file version ${file.version} is not ${COVERAGE_VERSION}`,
    );
  }
  if (file.requirementList?.name !== context.listName) {
    throw new CoverageError(
      `coverage was read against requirement list ${file.requirementList?.name}, not ${context.listName}`,
    );
  }
  if (file.requirementList.digest !== context.listDigest) {
    throw new CoverageError(
      `coverage was read against requirement list digest ${file.requirementList.digest}, but the current list's digest is ${context.listDigest}`,
    );
  }
  const recorded = file.requirementFiles?.[context.benchmark];
  if (recorded === undefined) {
    throw new CoverageError(
      `coverage was not read against the ${context.benchmark} requirement file`,
    );
  }
  if (recorded !== context.requirementFileDigest) {
    throw new CoverageError(
      `coverage was read against ${context.benchmark} requirement file digest ${recorded}, but the current file's digest is ${context.requirementFileDigest}`,
    );
  }
  const byId = new Map<string, CoverageEntry>();
  const known = new Set(context.list.requirements.map((entry) => entry.id));
  for (const entry of file.entries ?? []) {
    if (!known.has(entry.id)) {
      throw new CoverageError(
        `coverage cites requirement ${entry.id}, which is not in the list`,
      );
    }
    if (byId.has(entry.id)) {
      throw new CoverageError(`coverage lists requirement ${entry.id} twice`);
    }
    if (!(VERDICTS as readonly string[]).includes(entry.verdict)) {
      throw new CoverageError(
        `coverage gives ${entry.id} the unknown verdict ${entry.verdict}`,
      );
    }
    const facets = entry.facets ?? [];
    if (entry.verdict === "answered" && facets.length === 0) {
      throw new CoverageError(`coverage answers ${entry.id} with no Facet`);
    }
    if (entry.verdict !== "answered" && facets.length > 0) {
      throw new CoverageError(
        `coverage cites Facets for ${entry.id} with verdict ${entry.verdict}`,
      );
    }
    for (const facet of facets) {
      if (!context.facets.has(facet.id)) {
        throw new CoverageError(
          `coverage cites Facet ${facet.id} for ${entry.id}, which is not in the design's tree`,
        );
      }
    }
    byId.set(entry.id, entry);
  }
  const missing = context.list.requirements.filter((entry) =>
    !byId.has(entry.id)
  ).map((entry) => entry.id);
  if (missing.length > 0) {
    throw new CoverageError(`coverage has no entry for ${missing.join(", ")}`);
  }
  const entries = context.list.requirements.map((requirement) => {
    const entry = byId.get(requirement.id)!;
    return {
      id: entry.id,
      verdict: entry.verdict,
      // Labels come from the current tree, so they match the other tables.
      facets: entry.facets.map((facet) => ({
        id: facet.id,
        label: context.facets.get(facet.id)!,
      })),
      ...(entry.note ? { note: entry.note } : {}),
    };
  });
  return { digest, ...countVerdicts(entries), entries };
}

/** How many entries have each verdict. */
export function countVerdicts(
  entries: readonly { readonly verdict: Verdict }[],
): { answered: number; none: number; notRead: number } {
  const count = (verdict: Verdict) =>
    entries.filter((entry) => entry.verdict === verdict).length;
  return {
    answered: count("answered"),
    none: count("none"),
    notRead: count("not-read"),
  };
}

/** Parse the bytes of the coverage file at `path`. */
export function parseCoverageFile(
  bytes: Uint8Array,
  path: string,
): CoverageFile {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as CoverageFile;
  } catch (cause) {
    throw new CoverageError(`${path} is not JSON: ${errorMessage(cause)}`);
  }
}
