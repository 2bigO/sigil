/**
 * Measure mode (R12, R14–R16): score one committed design from its contracts
 * and stored readings without calling a model. The same design, store,
 * coverage reading and `sigilc` always give the same measures.
 *
 * Nothing is written into the design or the store: `sigilc tree` and
 * `sigilc check` run with a throwaway store, and the check gets a scratch copy
 * of the stored interpretations.
 */
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exists } from "../agent-runner/files.ts";
import {
  designDigest,
  fileDigest,
  readingsDigest,
  textDigest,
} from "./baseline.ts";
import {
  CoverageError,
  type CoverageMeasures,
  measureCoverage,
  readCoverageFile,
} from "./coverage.ts";
import {
  benchmarkNamed,
  compareText,
  PACKAGE_DIR,
  readJsonFile,
  type RequirementList,
} from "./records.ts";
import {
  facetHandles,
  measureStructure,
  readDesignTree,
  runSigilc,
  type StructureMeasures,
} from "./structure.ts";

/** The report version of `sigilc check` this benchmark reads. */
export const CHECK_REPORT_VERSION = 6;

export type Availability<T> =
  | { readonly status: "available"; readonly value: T }
  | { readonly status: "unavailable"; readonly reason: string };

export interface ClaimsMeasures {
  readonly state: string;
  readonly findings: number;
  /** `class / law` to count, sorted. */
  readonly byClassLaw: Readonly<Record<string, number>>;
  /** Component name to count, sorted. */
  readonly byComponent: Readonly<Record<string, number>>;
  readonly unreadUnits: number;
  readonly unread: readonly {
    readonly source: string;
    readonly component: string;
    readonly section: string;
    readonly facets: number;
  }[];
  readonly unresolvedImports: number;
  readonly guidanceFingerprint: string;
  readonly vocabularyGeneration: number;
  readonly workspaceDigest: string;
  /** How many stored readings the check used, and their identity. */
  readonly interpretations: number;
  readonly interpretationsDigest: string;
}

export interface DesignMeasures {
  readonly identity: {
    readonly design: string;
    /** `readingsDigest` of the store, or null with no store. */
    readonly readings: string | null;
    readonly coverage: string | null;
  };
  readonly structure: StructureMeasures;
  readonly claims: Availability<ClaimsMeasures>;
  readonly coverage: Availability<CoverageMeasures>;
}

export interface SigilcIdentity {
  /** What `sigilc --version` prints, such as `sigilc 0.3.0`. */
  readonly version: string;
  readonly digest: string;
}

export async function sigilcIdentity(sigilc: string): Promise<SigilcIdentity> {
  const result = await runSigilc(sigilc, ["--version"]);
  if (result.code !== 0) {
    throw new Error(`${sigilc} --version failed: ${result.stderr.trim()}`);
  }
  return { version: result.stdout.trim(), digest: await fileDigest(sigilc) };
}

/** The current requirement inputs a coverage reading is checked against. */
export interface RequirementInputs {
  readonly benchmark: string;
  readonly listName: string;
  readonly list: RequirementList;
  readonly listDigest: string;
  readonly requirementFileDigest: string;
}

/** A benchmark's current requirement list and file, with their digests. */
export async function requirementInputs(
  benchmark: string,
  packageDir = PACKAGE_DIR,
): Promise<RequirementInputs> {
  const definition = benchmarkNamed(benchmark);
  const listPath = join(
    packageDir,
    "benchmarks",
    definition.list,
    "requirements.json",
  );
  return {
    benchmark,
    listName: definition.list,
    list: await readJsonFile<RequirementList>(listPath),
    listDigest: await fileDigest(listPath),
    requirementFileDigest: await fileDigest(
      join(packageDir, definition.requirementFile),
    ),
  };
}

export interface MeasureInput {
  readonly sigilc: string;
  readonly root: string;
  /** A `sigilc --store` directory holding the claims readings, or null. */
  readonly store: string | null;
  /** The coverage reading, or why there is none. */
  readonly coverage: { readonly path: string } | { readonly reason: string };
  /** Set when the claims stage did not finish, so the check is not run. */
  readonly claimsUnavailable?: string;
  readonly requirements: RequirementInputs;
  /**
   * What a rejected coverage reading does: `throw` (measure mode) names the
   * file and stops; `unavailable` (reports) shows the rejection in its column.
   */
  readonly onCoverageError?: "throw" | "unavailable";
}

const unavailable = (reason: string) => ({
  status: "unavailable" as const,
  reason,
});

export async function measureDesign(
  input: MeasureInput,
): Promise<DesignMeasures> {
  if (!(await exists(input.root))) {
    throw new Error(`The design ${input.root} does not exist`);
  }
  const tree = await readDesignTree(input.sigilc, input.root);
  const structure = measureStructure(tree);
  const storeExists = input.store !== null && await exists(input.store);
  const readings = storeExists ? await readingsDigest(input.store!) : null;
  const coverageDigest = "path" in input.coverage &&
      await exists(input.coverage.path)
    ? await fileDigest(input.coverage.path)
    : null;
  const identity = {
    design: await designDigest(input.root),
    readings,
    coverage: coverageDigest,
  };

  // A design that does not parse is still measured structurally (KTD13).
  if (structure.invalidSources.length > 0 || structure.sources === 0) {
    const reason = structure.sources === 0
      ? "the design has no sources"
      : `the design does not parse: ${structure.invalidSources.join(", ")}`;
    return {
      identity,
      structure,
      claims: unavailable(reason),
      coverage: unavailable(reason),
    };
  }

  const claims = input.claimsUnavailable !== undefined
    ? unavailable(input.claimsUnavailable)
    : await measureClaims(
      input.sigilc,
      input.root,
      storeExists ? input.store : null,
    );

  let coverage: Availability<CoverageMeasures>;
  if ("reason" in input.coverage) coverage = unavailable(input.coverage.reason);
  else if (coverageDigest === null) {
    coverage = unavailable("no coverage reading");
  } else {
    const facets = new Map(
      facetHandles(tree).map((handle) => [handle.id, handle.label]),
    );
    try {
      const { file, digest } = await readCoverageFile(input.coverage.path);
      coverage = {
        status: "available",
        value: measureCoverage(file, digest, {
          benchmark: input.requirements.benchmark,
          list: input.requirements.list,
          listName: input.requirements.listName,
          listDigest: input.requirements.listDigest,
          requirementFileDigest: input.requirements.requirementFileDigest,
          facets,
        }),
      };
    } catch (cause) {
      if (!(cause instanceof CoverageError)) throw cause;
      if (input.onCoverageError === "unavailable") {
        return {
          identity,
          structure,
          claims,
          coverage: unavailable(`coverage reading rejected: ${cause.message}`),
        };
      }
      throw new CoverageError(
        `${input.coverage.path} is rejected: ${cause.message}`,
      );
    }
  }
  return { identity, structure, claims, coverage };
}

/**
 * `sigilc check --root DESIGN --store SCRATCH`, where SCRATCH holds a copy of
 * the stored interpretations and nothing else.
 */
export async function measureClaims(
  sigilc: string,
  root: string,
  store: string | null,
): Promise<Availability<ClaimsMeasures>> {
  const scratch = await mkdtemp(join(tmpdir(), "design-benchmark-check-"));
  try {
    const interpretations = join("claims", "interpretations");
    await mkdir(join(scratch, interpretations), { recursive: true });
    if (store !== null && await exists(join(store, interpretations))) {
      await cp(join(store, interpretations), join(scratch, interpretations), {
        recursive: true,
      });
    }
    const result = await runSigilc(sigilc, [
      "check",
      "--root",
      root,
      "--store",
      scratch,
    ]);
    if (result.code !== 0 && result.code !== 1) {
      return unavailable(
        `sigilc check exited ${result.code}: ${
          (result.stderr || result.stdout).trim()
        }`,
      );
    }
    let summary: Record<string, unknown>;
    try {
      summary = JSON.parse(result.stdout);
    } catch {
      return unavailable(
        `sigilc check gave no result: ${result.stderr.trim()}`,
      );
    }
    if (summary.version !== CHECK_REPORT_VERSION) {
      return unavailable(
        `sigilc check report version ${summary.version} is not ${CHECK_REPORT_VERSION}`,
      );
    }
    const report = JSON.parse(
      await readFile(String(summary.report), "utf8"),
    ) as CheckReport;
    const claims = claimsFromReport(report, summary);
    return {
      status: "available",
      value: {
        ...claims,
        interpretationsDigest: await textDigest(claims.interpretationsDigest),
      },
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

interface CheckReport {
  readonly version: number;
  readonly state: string;
  readonly identity: {
    readonly interpretations: readonly string[];
    readonly guidanceFingerprint: string;
    readonly vocabularyGeneration: number;
  };
  readonly findings: readonly {
    readonly class: string;
    readonly law: string;
    readonly component?: string | null;
  }[];
  readonly unread: readonly {
    readonly source: string;
    readonly component: string;
    readonly section: string;
    readonly facets: readonly string[];
  }[];
  readonly unresolvedImports: readonly unknown[];
  readonly linked?: { readonly workspaceDigest?: string };
}

function sortedCounts(keys: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return Object.fromEntries(
    [...counts].sort(([a], [b]) => compareText(a, b)),
  );
}

/** The component name an IRI ends with. */
function componentName(iri: string): string {
  return iri.slice(iri.lastIndexOf(":") + 1);
}

export function claimsFromReport(
  report: CheckReport,
  summary: Record<string, unknown>,
): ClaimsMeasures {
  const unread = report.unread.map((unit) => ({
    source: unit.source,
    component: unit.component,
    section: unit.section,
    facets: unit.facets.length,
  })).sort((a, b) =>
    compareText(
      `${a.source}\n${a.component}\n${a.section}`,
      `${b.source}\n${b.component}\n${b.section}`,
    )
  );
  const keys = [...report.identity.interpretations].sort(compareText);
  return {
    state: report.state,
    findings: report.findings.length,
    byClassLaw: sortedCounts(
      report.findings.map((finding) => `${finding.class} / ${finding.law}`),
    ),
    byComponent: sortedCounts(
      report.findings.filter((finding) => finding.component)
        .map((finding) => componentName(finding.component!)),
    ),
    unreadUnits: unread.length,
    unread,
    unresolvedImports: report.unresolvedImports.length,
    guidanceFingerprint: report.identity.guidanceFingerprint,
    vocabularyGeneration: report.identity.vocabularyGeneration,
    workspaceDigest: String(
      report.linked?.workspaceDigest ?? summary.workspaceDigest ?? "",
    ),
    interpretations: keys.length,
    // The sorted memo keys; measureClaims replaces them with their digest.
    interpretationsDigest: keys.join("\n"),
  };
}
