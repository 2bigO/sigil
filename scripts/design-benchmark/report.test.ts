import { beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { treeSha256, writeJson } from "../agent-runner/files.ts";
import { designDigest, referenceStoreDigest } from "./baseline.ts";
import { requirementInputs, sigilcIdentity } from "./measure.ts";
import {
  attemptPaths,
  type BatchManifest,
  type PassRecord,
} from "./records.ts";
import { buildReport, MEASURES } from "./report.ts";
import { facetHandles, readDesignTree } from "./structure.ts";
import {
  component,
  coverageFile,
  passRecord,
  READER,
  SIGILC,
  tempDir,
  TWO_COMPONENTS,
  writeBatch,
  writeDesign,
} from "./testing.ts";

const WITH = "slotted-with-split";
const WITHOUT = "slotted-without-split";

interface Setup {
  referenceRoot: string;
  referenceDir: string;
  ids: string[];
  digests: { list: string; files: Record<string, string> };
  manifest(
    benchmark: string,
    overrides?: Partial<BatchManifest>,
  ): BatchManifest;
  report(dirs: string[]): Promise<string>;
}

let setup: Setup;

/** The pass design: A without its state, and C, which the reference lacks. */
const PASS_DESIGN = {
  "a.sigil": component("A", {
    goal: ["Keep each *gadget* in one place."],
    interface: ["A provides the gadget."],
  }),
  "c.sigil": component("C", {
    goal: ["Run each *cable* once."],
    interface: ["C provides the cable."],
  }),
};

beforeAll(async () => {
  const referenceRoot = await writeDesign(await tempDir(), TWO_COMPONENTS);
  const referenceDir = await tempDir();
  const withInputs = await requirementInputs(WITH);
  const withoutInputs = await requirementInputs(WITHOUT);
  const ids = withInputs.list.requirements.map((entry) => entry.id);
  const digests: Setup["digests"] = {
    list: withInputs.listDigest,
    files: {
      [WITH]: withInputs.requirementFileDigest,
      [WITHOUT]: withoutInputs.requirementFileDigest,
    },
  };
  // The reference answers R22 with A's state Facet.
  const handles = facetHandles(await readDesignTree(SIGILC, referenceRoot));
  const stateFacet = handles.find((handle) => handle.label === "A state 1")!;
  await mkdir(join(referenceDir, "store", "claims", "interpretations"), {
    recursive: true,
  });
  await writeJson(join(referenceDir, "reader.json"), READER);
  await writeJson(join(referenceDir, "readings.json"), {
    guidanceFingerprint: "g-current",
    vocabularyGeneration: 5,
  });
  await writeJson(
    join(referenceDir, "coverage.json"),
    coverageFile(ids, digests, {
      R22: [{ id: stateFacet.id, label: stateFacet.label }],
    }),
  );
  const reference = {
    tree: await designDigest(referenceRoot),
    store: await referenceStoreDigest(referenceDir),
  };
  setup = {
    referenceRoot,
    referenceDir,
    ids,
    digests,
    manifest: (benchmark, overrides = {}) => ({
      version: 1,
      benchmark,
      writers: [{ agent: "claude", model: "writer-model" }],
      effort: "high",
      passes: 1,
      skillDigests: { "sigil-write": "skill-1" },
      writerBinaries: { sigil: "sigil-1", sigilc: "sigilc-1" },
      reader: READER,
      requirements: {
        requirementFile: digests.files[benchmark]!,
        requirementList: digests.list,
      },
      reference,
      readings: { guidanceFingerprint: "g-current", vocabularyGeneration: 5 },
      createdAt: new Date().toISOString(),
      ...overrides,
    }),
    report: (dirs) =>
      buildReport({
        batchDirs: dirs,
        sigilc: SIGILC,
        references: {
          slotted: { root: referenceRoot, dir: referenceDir },
        },
      }),
  };
});

async function batch(
  name: string,
  benchmark: string,
  overrides: Partial<BatchManifest> = {},
  passes: {
    record?: Partial<PassRecord>;
    design?: Record<string, string>;
  }[] = [{}],
): Promise<string> {
  const dir = join(await tempDir(), name);
  return await writeBatch(
    dir,
    setup.manifest(benchmark, overrides),
    passes.map((pass, index) => ({
      record: passRecord(`p${index + 1}`, pass.record),
      design: pass.design ?? PASS_DESIGN,
      coverage: coverageFile(setup.ids, {
        list: setup.digests.list,
        files: { [benchmark]: setup.digests.files[benchmark]! },
      }),
    })),
  );
}

function section(report: string, start: string, end?: string): string {
  const from = report.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = end === undefined ? -1 : report.indexOf(end, from + 1);
  return report.slice(from, to < 0 ? undefined : to);
}

describe("report", () => {
  test("withholds pass coverage from a different reader", async () => {
    const dir = await batch("stale-pass-coverage", WITH);
    const path = attemptPaths(dir, "p1").coverage;
    const file = JSON.parse(await readFile(path, "utf8"));
    await writeJson(path, {
      ...file,
      reader: { ...READER, model: "other-reader" },
    });
    const report = await setup.report([dir]);
    expect(report).toContain("coverage reading rejected: coverage was read by");
    expect(report).toContain("other-reader");
  });

  test("rejects reference coverage whose reader differs from its pin", async () => {
    const dir = await batch("stale-reference", WITH);
    const referenceDir = await tempDir();
    await cp(setup.referenceDir, referenceDir, { recursive: true });
    await writeJson(join(referenceDir, "reader.json"), {
      ...READER,
      model: "new-reader",
    });
    await writeJson(
      join(dir, "manifest.json"),
      setup.manifest(WITH, { reader: { ...READER, model: "new-reader" } }),
    );
    await expect(buildReport({
      batchDirs: [dir],
      sigilc: SIGILC,
      references: { slotted: { root: setup.referenceRoot, dir: referenceDir } },
    })).rejects.toThrow(/reader-model.*new-reader/);
  });

  test("AE3: a pass with no Facet for R22 shows it unanswered beside the reference's Facet", async () => {
    const report = await setup.report([await batch("b1", WITH)]);
    expect(report).toContain("| Design: R22 | answered: A state 1 | none |");
    expect(report).toContain("| Design: answered | 1 | 0 (-1) |");
  });

  test("shows the reference and matches components by name, listing unmatched ones", async () => {
    const report = await setup.report([await batch("b1", WITH)]);
    const facets = section(
      report,
      "#### Facets per contract role",
      "#### Components without",
    );
    expect(facets).toContain("| Row | Reference | P1 |");
    expect(facets).toContain("| A: state | 1 | 0 (-1) |");
    expect(facets).toContain("| B: goal | 1 | — |");
    expect(facets).not.toContain("| C: goal");
    expect(facets).toContain(
      "- P1 has C, which matches no reference component: goal 1;",
    );
    expect(facets).toContain("- P1 has no B");
    expect(facets).toContain("| Design: goal | 2 | 2 (=) |");
    // Every measure names its closer direction from the shared definition.
    for (const definition of MEASURES) {
      expect(report).toContain(`#### ${definition.title}`);
      expect(report).toContain(`Closer to the reference: ${definition.closer}`);
    }
  });

  test("is byte-identical when built twice, and leaves the reference and its store unchanged", async () => {
    const dir = await batch("b1", WITH);
    const before = [
      await treeSha256(setup.referenceRoot),
      await treeSha256(setup.referenceDir),
      await treeSha256(dir),
    ];
    const first = await setup.report([dir]);
    expect(await setup.report([dir])).toBe(first);
    expect([
      await treeSha256(setup.referenceRoot),
      await treeSha256(setup.referenceDir),
      await treeSha256(dir),
    ]).toEqual(before);
    expect(first).not.toContain(setup.referenceRoot);
    expect(first).not.toContain(dir);
  });

  test("contains no single score, rank or threshold", async () => {
    const report = await setup.report([
      await batch("b1", WITH),
      await batch("b2", WITHOUT),
    ]);
    expect(report).not.toMatch(/score|rank|threshold|overall|winner/i);
  });

  test("AE5: batches whose guidance fingerprints differ land in separate baselines", async () => {
    const current = await batch("current", WITH);
    const old = await batch("old", WITH, {
      readings: { guidanceFingerprint: "g-old", vocabularyGeneration: 5 },
    });
    const report = await setup.report([old, current]);
    const first = section(report, "## Baseline 1", "## Baseline 2");
    const second = section(report, "## Baseline 2");
    expect(first).toContain("(the current reference)");
    expect(first).toContain("| P1 | current | p1 |");
    expect(first).not.toContain("| old |");
    expect(second).toContain("guidance fingerprint (law set)");
    expect(second).toContain("| P1 | old | p1 |");
    expect(second).not.toContain("| Row | Reference");
    expect(second).toContain("- guidance fingerprint (law set): g-old");
  });

  test("a changed requirement file starts a new baseline", async () => {
    const report = await setup.report([
      await batch("stale", WITH, {
        requirements: {
          requirementFile: "old-file",
          requirementList: setup.digests.list,
        },
      }),
    ]);
    expect(report).not.toContain("(the current reference)");
    expect(report).toContain("slotted-with-split requirement file");
  });

  test("refuses a batch whose reader differs from the reference store's, naming both", async () => {
    const dir = await batch("b1", WITH, {
      reader: { ...READER, model: "other-reader" },
    });
    const built = setup.report([dir]);
    await expect(built).rejects.toThrow("other-reader");
    await expect(built).rejects.toThrow("reader-model");
  });

  test("re-measures batches first measured with other sigilc builds", async () => {
    const one = await batch("one", WITH, {
      writerBinaries: { sigil: "sigil-1", sigilc: "old-build" },
    });
    const two = await batch("two", WITH, {
      writerBinaries: { sigil: "sigil-1", sigilc: "older-build" },
    }, [{ design: TWO_COMPONENTS }]);
    // Measures an older build left behind are never read.
    for (const dir of [one, two]) {
      await writeJson(join(dir, "attempts", "p1", "measures.json"), {
        sigilc: "sigilc 0.0.1",
        structure: { components: 99 },
      });
    }
    const report = await setup.report([one, two]);
    const current = await sigilcIdentity(SIGILC);
    expect(report).toContain(`- sigilc: ${current.version}`);
    expect(report).not.toContain("0.0.1");
    expect(report).toContain("| Design: components | 2 | 2 (=) | 2 (=) |");
    expect(report).toContain("| Design: state | 1 | 0 (-1) | 1 (=) |");
  });

  test("a pass that does not parse is measured structurally, with claims and coverage unavailable", async () => {
    const report = await setup.report([
      await batch("b1", WITH, {}, [{
        design: {
          "a.sigil": "component A {\n  goal {\n    Keep it.\n  }\n  state {\n",
        },
      }]),
    ]);
    expect(report).toContain(
      "| Design: sources that do not parse | none | a.sigil |",
    );
    const claims = section(report, "#### Claims state", "#### Findings");
    expect(claims).toContain(
      "- P1 unavailable: the design does not parse: a.sigil",
    );
    const coverage = section(report, "#### Requirement coverage");
    expect(coverage).toContain(
      "| Design: R22 | answered: A state 1 | unavailable |",
    );
  });

  test("an invalid pass is listed but not measured", async () => {
    const report = await setup.report([
      await batch("b1", WITH, {}, [{ record: { reads: "forbidden" } }]),
    ]);
    expect(report).toContain(
      "| not measured: invalid: a forbidden read | b1 |",
    );
    expect(report).not.toContain("| P1 |");
  });

  test("passes without a completed read scan are listed but not measured", async () => {
    const report = await setup.report([
      await batch("b1", WITH, {}, [
        {
          record: {
            stages: {
              writer: { status: "done", error: null },
              readScan: { status: "failed", error: "scan failed" },
              claims: { status: "pending", error: null },
              coverage: { status: "pending", error: null },
            },
          },
        },
        {
          record: {
            stages: {
              writer: { status: "done", error: null },
              readScan: { status: "running", error: null },
              claims: { status: "pending", error: null },
              coverage: { status: "pending", error: null },
            },
          },
        },
      ]),
    ]);
    expect(report).toContain(
      "| not measured: read scan failed: scan failed | b1 | p1 |",
    );
    expect(report).toContain(
      "| not measured: read scan interrupted | b1 | p2 |",
    );
    expect(report).not.toContain("| P1 |");
    expect(report).not.toContain("| P2 |");
  });

  test("a running pass shows as interrupted", async () => {
    const report = await setup.report([
      await batch("b1", WITH, {}, [{
        record: {
          stages: {
            writer: { status: "done", error: null },
            readScan: { status: "done", error: null },
            claims: { status: "running", error: null },
            coverage: { status: "pending", error: null },
          },
        },
      }]),
    ]);
    expect(report).toContain("claims interrupted");
    expect(report).toContain("- P1 unavailable: claims stage interrupted");
  });
});

describe("split comparison (R21)", () => {
  test("compares with-split and without-split passes that share writer, reasoning, skills, passes and binaries", async () => {
    const report = await setup.report([
      await batch("w", WITH),
      await batch("o", WITHOUT),
    ]);
    expect(report).toContain(
      "#### w (claude:writer-model) and o (claude:writer-model)",
    );
    expect(report).not.toContain("Not compared");
  });

  test("does not compare batches whose reasoning levels differ", async () => {
    const report = await setup.report([
      await batch("w", WITH, { effort: "high" }),
      await batch("o", WITHOUT, { effort: "low" }),
    ]);
    expect(report).toContain(
      "- Not compared: w (claude:writer-model) and o (claude:writer-model): reasoning level differs (high and low).",
    );
    expect(report).not.toContain("#### w (");
  });

  test("does not compare batches whose writer sigil digests differ", async () => {
    const report = await setup.report([
      await batch("w", WITH),
      await batch("o", WITHOUT, {
        writerBinaries: { sigil: "sigil-2", sigilc: "sigilc-1" },
      }),
    ]);
    expect(report).toContain("writer sigil digest differs");
    expect(report).not.toContain("#### w (");
  });

  test("does not compare batches whose skill revisions or pass counts differ", async () => {
    const report = await setup.report([
      await batch("w", WITH, { skillDigests: { "sigil-write": "skill-2" } }),
      await batch("o", WITHOUT, { passes: 2 }),
    ]);
    expect(report).toContain("skill revisions differ");
    expect(report).toContain("pass count differs (1 and 2)");
  });
});

test("the README's Measures section states each measure's closer direction (R19)", async () => {
  const readme =
    (await readFile(new URL("./README.md", import.meta.url), "utf8"))
      .replace(/\s+/g, " ");
  for (const definition of MEASURES) {
    expect(readme).toContain(
      `**${definition.title}.** Closer to the reference: ${definition.closer} It does not say ${definition.notSaid}`,
    );
  }
});
