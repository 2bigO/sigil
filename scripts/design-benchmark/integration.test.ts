/**
 * One fake-host batch of `slotted-without-split`, end to end, and its report
 * beside a canned reference with a pinned fake reader. No test starts a real
 * host.
 */
import { beforeAll, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { exists } from "../agent-runner/files.ts";
import { runBatch } from "./batch.ts";
import {
  copyPinnedReference,
  fakeHosts,
  fakeReader,
  fakeWriter,
  type PinnedReference,
  pinnedReference,
} from "./fakes.ts";
import { executeCommand, HANDLERS } from "./main.ts";
import { attemptPaths, readBatch, readJsonFile } from "./records.ts";
import { buildReport } from "./report.ts";
import { facetHandles, readDesignTree } from "./structure.ts";
import {
  component,
  SIGILC,
  tempDir,
  TWO_COMPONENTS,
  writeDesign,
} from "./testing.ts";

/** The pass leaves out A's state, so the report has a difference to show. */
const PASS_DESIGN = {
  "a.sigil": component("A", {
    goal: ["Keep each *gadget* in one place."],
    interface: ["A provides the gadget."],
  }),
  "b.sigil": TWO_COMPONENTS["b.sigil"],
};

/** Pinned once for the file; each test copies its store. */
let pinned: PinnedReference;
let reader: Awaited<ReturnType<typeof fakeReader>>;

beforeAll(async () => {
  const scratch = await tempDir();
  const referenceRoot = await writeDesign(
    join(scratch, "reference-design"),
    TWO_COMPONENTS,
  );
  const handles = facetHandles(await readDesignTree(SIGILC, referenceRoot));
  reader = await fakeReader(scratch, {
    coverage: { R1: [handles[0]!.handle] },
  });
  pinned = await pinnedReference({
    root: referenceRoot,
    dir: join(scratch, "reference-store"),
    scratch,
    reader,
  });
});

test(
  "a fake-host batch of slotted-without-split is scored and reported beside the reference",
  async () => {
    const scratch = await tempDir();
    const reference = await copyPinnedReference(pinned, scratch);
    const writer = await fakeWriter(scratch, {
      design: PASS_DESIGN,
      review: "delegated",
    });
    const batchDir = join(scratch, "batch");
    const result = await runBatch({
      ...reference.environment,
      hostFor: fakeHosts(writer, reader),
      benchmark: "slotted-without-split",
      writers: [{ agent: "claude", model: "writer-model" }],
      effort: "high",
      passes: 1,
      out: batchDir,
    });
    expect(result.reportError).toBeNull();
    const batch = await readBatch(batchDir);
    expect(batch.records).toHaveLength(1);
    const record = batch.records[0]!;
    expect(record.stages).toEqual({
      writer: { status: "done", error: null },
      readScan: { status: "done", error: null },
      claims: { status: "done", error: null },
      coverage: { status: "done", error: null },
    });
    expect(record.reads).toBe("clean");
    expect(record.review).toBe("delegated");
    expect(record.stagingPath).toBeNull();
    expect(record.writer?.reviewerStarts).toBe(1);
    expect(batch.manifest.readings).not.toBeNull();
    expect(batch.manifest.reader.model).toBe("reader-model");
    expect(Object.keys(batch.manifest.skillDigests).sort()).toEqual([
      "sigil-compute-design",
      "sigil-egglog",
      "sigil-evaluate",
      "sigil-understand",
      "sigil-write",
    ]);

    // The evidence of every stage is kept with the attempt.
    const paths = attemptPaths(batchDir, record.id);
    for (
      const kept of [
        "writer/stdout.jsonl",
        "writer/prompt.txt",
        "writer/run/review/report.md",
        "writer/store/claims/interpretations/fake.json",
        "read-scan.json",
        "claims/stdout.jsonl",
        "claims/run/start-state.json",
        "coverage/stdout.jsonl",
        "coverage/answer/coverage.json",
      ]
    ) {
      expect({ kept, exists: await exists(join(paths.evidence, kept)) })
        .toEqual({ kept, exists: true });
    }
    const coverage = await readJsonFile<{ entries: { verdict: string }[] }>(
      paths.coverage,
    );
    expect(coverage.entries.filter((e) => e.verdict === "answered").length)
      .toBe(1);

    const report = await buildReport({
      batchDirs: [batchDir],
      sigilc: SIGILC,
      references: reference.environment.references,
    });
    expect(report).toBe(await readFile(result.reportPath, "utf8"));
    if (process.env.SHOW_REPORT) console.log(report);
    expect(report).toMatch(/Reference/);
    expect(report).toMatch(/writer-model/);
    expect(report).toMatch(/Components without state, logic or cases/);
    // The pass's claims are read, not missing.
    expect(report).not.toMatch(/claims stage/);

    // The report command rebuilds it without starting a host.
    const rebuilt = join(scratch, "rebuilt.md");
    await writeFile(
      writer.args[0]!,
      "throw new Error('report started a host');\n",
    );
    await executeCommand(["report", batchDir, "--out", rebuilt], HANDLERS, {
      environment: reference.environment,
    });
    expect(await readFile(rebuilt, "utf8")).toBe(report);
  },
  120_000,
);

test(
  "the run command refuses a writer that is the pinned reader, before any host starts",
  async () => {
    const scratch = await tempDir();
    const reference = await copyPinnedReference(pinned, scratch);
    const hostFor = () => {
      throw new Error("a host was started");
    };
    await expect(
      executeCommand(
        [
          "run",
          "--benchmark",
          "slotted-with-split",
          "--agent",
          "claude:reader-model",
          "--reasoning",
          "high",
          "--passes",
          "1",
          "--out",
          join(scratch, "batch"),
        ],
        HANDLERS,
        { environment: { ...reference.environment, hostFor } },
      ),
    ).rejects.toThrow(/is the pinned reader/);
    expect(await exists(join(scratch, "batch"))).toBe(false);
  },
  120_000,
);
