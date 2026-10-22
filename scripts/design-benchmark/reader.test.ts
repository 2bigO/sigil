import { beforeAll, describe, expect, test } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exists, treeSha256, writeJson } from "../agent-runner/files.ts";
import {
  INTERPRETER_CHILD,
  orchestratorPrompt,
} from "../slotted-benchmark/agents.ts";
import { rereadReference, runBatch } from "./batch.ts";
import type { CoverageFile } from "./coverage.ts";
import {
  copyPinnedReference,
  fakeHosts,
  fakeReader,
  type PinnedReference,
  pinnedReference,
} from "./fakes.ts";
import { requirementInputs } from "./measure.ts";
import {
  claimsPromptDigest,
  coverageFromAnswer,
  coveragePrompt,
  coveragePromptDigest,
  coverageTask,
  facetsDocument,
  loadPinnedReader,
  parseCoverageHandback,
  pinReader,
  READER_SKILLS,
} from "./reader.ts";
import {
  type ReaderIdentity,
  readJsonFile,
  referenceStorePaths,
  REPO_ROOT,
  type RequirementList,
} from "./records.ts";
import { type FacetHandle, facetHandles, readDesignTree } from "./structure.ts";
import { SIGILC, tempDir, TWO_COMPONENTS, writeDesign } from "./testing.ts";

const LONG = 120_000;
const SKILLS = join(REPO_ROOT, "skills");

const LIST: RequirementList = {
  benchmark: "slotted",
  requirements: [
    { id: "R1", label: "one" },
    { id: "R2", label: "two" },
    { id: "R3", label: "three" },
    { id: "R4", label: "four" },
  ],
};

const HANDLES: FacetHandle[] = [
  {
    handle: "#1",
    id: "facet:aaa",
    source: "a.sigil",
    component: "A",
    section: "state",
    label: "A state 1",
    prose: "A owns each gadget.",
  },
  {
    handle: "#2",
    id: "facet:bbb",
    source: "b.sigil",
    component: "B",
    section: "goal",
    label: "B goal 1",
    prose: "Hold every widget.\nIn one place.",
  },
];

const READER: ReaderIdentity = {
  agent: "claude",
  model: "reader-model",
  effort: "high",
  skillDigests: {},
  coveragePromptDigest: "digest",
};

const HEADER = {
  listName: "slotted",
  listDigest: "list-digest",
  requirementFiles: { "slotted-with-split": "file-digest" },
  reader: READER,
};

describe("coverage answers", () => {
  test("cited handles map to Facet ids, and an unknown handle such as #999 is not read", () => {
    const file = coverageFromAnswer({
      answer: {
        entries: [
          { id: "R1", verdict: "answered", facets: ["#2", "#1", "#2"] },
          { id: "R2", verdict: "answered", facets: ["#1", "#999"] },
          { id: "R3", verdict: "none", facets: [], note: "nothing on it" },
        ],
      },
      failure: null,
      list: LIST,
      handles: HANDLES,
      header: HEADER,
    });
    expect(file.entries).toEqual([
      {
        id: "R1",
        verdict: "answered",
        facets: [
          { id: "facet:bbb", label: "B goal 1" },
          { id: "facet:aaa", label: "A state 1" },
        ],
      },
      {
        id: "R2",
        verdict: "not-read",
        facets: [],
        note: "the reader cited #999, which no Facet of the design has",
      },
      { id: "R3", verdict: "none", facets: [], note: "nothing on it" },
      {
        id: "R4",
        verdict: "not-read",
        facets: [],
        note: "the reader gave no verdict",
      },
    ]);
    expect(file.requirementList).toEqual({
      name: "slotted",
      digest: "list-digest",
    });
    expect(file.requirementFiles).toEqual(HEADER.requirementFiles);
    expect(file.reader).toEqual(READER);
  });

  test("a reader that timed out or refused leaves every requirement not read", () => {
    const file = coverageFromAnswer({
      answer: null,
      failure: "the coverage reader timed out",
      list: LIST,
      handles: HANDLES,
      header: HEADER,
    });
    expect(new Set(file.entries.map((entry) => entry.verdict))).toEqual(
      new Set(["not-read"]),
    );
    expect(file.entries[0]!.note).toBe("the coverage reader timed out");
    const refused = coverageFromAnswer({
      answer: {
        entries: [{ id: "R1", verdict: "not-read", note: "refused" }, {
          id: "R2",
          verdict: "maybe",
        }, { id: "R3", verdict: "answered", facets: [] }],
      },
      failure: null,
      list: LIST,
      handles: HANDLES,
      header: HEADER,
    });
    expect(refused.entries.map((entry) => entry.note)).toEqual([
      "refused",
      "the reader gave the unknown verdict maybe",
      "the reader answered it with no Facet",
      "the reader gave no verdict",
    ]);
  });

  test("the coverage prompt gives the reader the inputs, the handles and the output format", () => {
    const prompt = coveragePrompt({
      spawnInstruction: "SPAWN-HERE",
      model: "m",
      effort: "high",
    });
    expect(prompt).toContain("SPAWN-HERE");
    expect(prompt).toContain(coverageTask());
    for (
      const part of [
        "requirement.md",
        "requirement-list.json",
        "facets.md",
        "answer/coverage.json",
        "`#N`",
        "only mentions",
        "Coverage: written",
      ]
    ) {
      expect({ part, found: prompt.includes(part) }).toEqual({
        part,
        found: true,
      });
    }
    expect(parseCoverageHandback("done\nCoverage: written")).toBe("written");
    expect(parseCoverageHandback("**Coverage:** failed")).toBe("failed");
    expect(parseCoverageHandback("Coverage: maybe")).toBeNull();
    const document = facetsDocument(HANDLES);
    expect(document).toContain("## #1 A state 1 (a.sigil)");
    expect(document).toContain("> Hold every widget.\n> In one place.");
  });
});

describe("the pinned reader", () => {
  test("pin-reader freezes the reader's skills and records their digests and the prompt digest", async () => {
    const dir = await tempDir();
    const reader = await pinReader({
      referenceDir: dir,
      skillsDir: SKILLS,
      agent: "claude",
      model: "reader-model",
      effort: "high",
    });
    const paths = referenceStorePaths(dir);
    expect((await readdir(paths.readerSkills)).sort()).toEqual(
      [...READER_SKILLS].sort(),
    );
    for (const name of READER_SKILLS) {
      expect(reader.skillDigests[name]).toBe(
        await treeSha256(join(paths.readerSkills, name)),
      );
    }
    expect(reader.coveragePromptDigest).toBe(await coveragePromptDigest());
    expect(reader.claimsPromptDigest).toBe(await claimsPromptDigest());
    expect(await readJsonFile<ReaderIdentity>(paths.reader)).toEqual(reader);
    expect(await loadPinnedReader(dir)).toEqual(reader);
    await expect(
      pinReader({
        referenceDir: dir,
        skillsDir: SKILLS,
        agent: "codex",
        model: "other",
        effort: "low",
      }),
    ).rejects.toThrow(/--force/);
    const replaced = await pinReader({
      referenceDir: dir,
      skillsDir: SKILLS,
      agent: "codex",
      model: "other",
      effort: "low",
      force: true,
    });
    expect(replaced.model).toBe("other");
  });

  test("a missing reader or a changed frozen skill is refused", async () => {
    const dir = await tempDir();
    await expect(loadPinnedReader(dir)).rejects.toThrow(
      /Pin the reference first/,
    );
    await pinReader({
      referenceDir: dir,
      skillsDir: SKILLS,
      agent: "claude",
      model: "reader-model",
      effort: "high",
    });
    await writeFile(
      join(referenceStorePaths(dir).readerSkills, "sigil-egglog", "SKILL.md"),
      "edited\n",
    );
    await expect(loadPinnedReader(dir)).rejects.toThrow(
      /frozen sigil-egglog .* does not match reader.json/,
    );
  });

  test("pin rejects a changed claims orchestrator or child prompt", async () => {
    const dir = await tempDir();
    const reader = await pinReader({
      referenceDir: dir,
      skillsDir: SKILLS,
      agent: "claude",
      model: "reader-model",
      effort: "high",
    });
    const prompts = {
      orchestrator: orchestratorPrompt,
      child: INTERPRETER_CHILD,
    };
    const changedChild = {
      ...prompts,
      child: {
        ...INTERPRETER_CHILD,
        prompt: `${INTERPRETER_CHILD.prompt} changed`,
      },
    };
    expect(await claimsPromptDigest(changedChild)).not.toBe(
      reader.claimsPromptDigest,
    );
    await expect(loadPinnedReader(dir, changedChild)).rejects.toThrow(
      /claims prompt changed since the reader was pinned.*pin-reader --force and reread reference --coverage/,
    );

    const changedOrchestrator = {
      ...prompts,
      orchestrator: (context: Parameters<typeof orchestratorPrompt>[0]) =>
        `${orchestratorPrompt(context)} changed`,
    };
    expect(await claimsPromptDigest(changedOrchestrator)).not.toBe(
      reader.claimsPromptDigest,
    );
    await expect(loadPinnedReader(dir, changedOrchestrator)).rejects.toThrow(
      /claims prompt changed since the reader was pinned/,
    );
  });
});

describe("reread reference", () => {
  /** Pinned once for these tests; each test copies its store. */
  let pinned: PinnedReference;
  beforeAll(async () => {
    const scratch = await tempDir();
    pinned = await pinnedReference({
      root: await writeDesign(join(scratch, "design"), TWO_COMPONENTS),
      dir: join(scratch, "committed"),
      scratch,
      reader: await fakeReader(scratch),
    });
  });

  test(
    "reread reference --coverage writes new readings into a new store and leaves the committed one alone",
    async () => {
      const scratch = await tempDir();
      const root = await writeDesign(join(scratch, "design"), TWO_COMPONENTS);
      const handles = facetHandles(await readDesignTree(SIGILC, root));
      const reader = await fakeReader(scratch, {
        coverage: { R1: ["#999"], R2: [handles[1]!.handle] },
      });
      // Pinned with reader.json and reader-skills/ only, before any readings.
      const dir = join(scratch, "committed");
      await pinReader({
        referenceDir: dir,
        skillsDir: SKILLS,
        agent: "claude",
        model: "reader-model",
        effort: "high",
      });
      const before = await treeSha256(dir);
      const rootBefore = await treeSha256(root);
      const out = join(scratch, "new-store");
      const result = await rereadReference({
        references: { slotted: { root, dir } },
        slottedWorkspace: null,
        timeoutMs: 60_000,
        hostFor: fakeHosts(null, reader),
        coverage: true,
        out,
      });
      expect(result.outDir).toBe(out);
      expect(result.state).toBe("coherent");
      expect(result.unreadUnits).toBe(0);
      expect(await treeSha256(dir)).toBe(before);
      expect(await treeSha256(root)).toBe(rootBefore);
      const paths = referenceStorePaths(out);
      expect(
        (await readdir(join(paths.store, "claims", "interpretations"))).length,
      ).toBeGreaterThan(0);
      expect(await readJsonFile(paths.readings)).toEqual(result.readings);
      expect(await readJsonFile(paths.reader)).toEqual(
        await readJsonFile(referenceStorePaths(dir).reader),
      );

      // The reference reading names both benchmarks that share the list.
      const coverage = await readJsonFile<CoverageFile>(paths.coverage);
      const withSplit = await requirementInputs("slotted-with-split");
      const withoutSplit = await requirementInputs("slotted-without-split");
      expect(coverage.requirementFiles).toEqual({
        "slotted-with-split": withSplit.requirementFileDigest,
        "slotted-without-split": withoutSplit.requirementFileDigest,
      });
      expect(coverage.entries[0]).toEqual({
        id: "R1",
        verdict: "not-read",
        facets: [],
        note: "the reader cited #999, which no Facet of the design has",
      });
      expect(coverage.entries[1]).toEqual({
        id: "R2",
        verdict: "answered",
        facets: [{ id: handles[1]!.id, label: handles[1]!.label }],
      });
      // The reference reader is given the requirement text without the split.
      const given = await readFile(
        join(out, "evidence", "coverage", "requirement.md"),
        "utf8",
      );
      expect(given).not.toContain("## Module split");
      expect(given).toContain("R28");
      expect(result.coverage).toEqual({
        answered: 1,
        none: coverage.entries.length - 2,
        notRead: 1,
      });
      await expect(
        rereadReference({
          references: { slotted: { root, dir } },
          slottedWorkspace: null,
          hostFor: fakeHosts(null, reader),
          coverage: true,
          out,
        }),
      ).rejects.toThrow(/already exists/);
    },
    LONG,
  );

  test(
    "reread reference without --coverage keeps the stored coverage reading",
    async () => {
      const scratch = await tempDir();
      const reference = await copyPinnedReference(pinned, scratch);
      const out = join(scratch, "law-change");
      const result = await rereadReference({
        ...reference.environment,
        coverage: false,
        out,
      });
      expect(result.coverage).toBeNull();
      expect(await readFile(join(out, "coverage.json"), "utf8")).toBe(
        await readFile(referenceStorePaths(reference.dir).coverage, "utf8"),
      );
      expect(await exists(join(out, "evidence", "coverage"))).toBe(false);
    },
    LONG,
  );

  test(
    "run refuses a reference whose readings were taken under another law set",
    async () => {
      const scratch = await tempDir();
      const reference = await copyPinnedReference(pinned, scratch);
      await writeJson(referenceStorePaths(reference.dir).readings, {
        guidanceFingerprint: "old-laws",
        vocabularyGeneration: 1,
      });
      await expect(
        runBatch({
          ...reference.environment,
          benchmark: "slotted-with-split",
          writers: [{ agent: "claude", model: "writer-model" }],
          effort: "high",
          passes: 1,
          out: join(scratch, "batch"),
        }),
      ).rejects.toThrow(/Re-pin the reference first/);
    },
    LONG,
  );
});
