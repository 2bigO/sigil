import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { exists, writeJson } from "../agent-runner/files.ts";
import { defaultForbiddenRoots } from "../agent-runner/read-scan.ts";
import { defaultSigil } from "./batch.ts";
import { fakeWriter } from "./fakes.ts";
import { REPO_ROOT } from "./records.ts";
import {
  checkWriterIntegrity,
  copyDesign,
  type HostOptions,
  launchWriter,
  outcomeOf,
  snapshotDifferences,
  stageWriter,
  type WriterSources,
} from "./stages.ts";
import { SIGILC, tempDir } from "./testing.ts";
import { WRITER_SKILLS } from "./writer.ts";

const SOURCES: WriterSources = {
  requirementFile: join(
    REPO_ROOT,
    "scripts/design-benchmark/benchmarks/slotted-with-split/requirement.md",
  ),
  skillsDir: join(REPO_ROOT, "skills"),
  sigil: defaultSigil(),
  sigilc: SIGILC,
};

const ROOTS = defaultForbiddenRoots({ repoRoot: REPO_ROOT, home: homedir() });

function hostOptions(writer: { executable: string; args: readonly string[] }) {
  return {
    hostFor: () => writer,
    forbiddenRoots: ROOTS,
    home: homedir(),
    timeoutMs: 30_000,
  } satisfies HostOptions;
}

describe("the writer's staging directory", () => {
  test(
    "holds the requirement, the five skills, both binaries and the three writable directories",
    async () => {
      const dir = join(await tempDir(), "writer");
      const staged = await stageWriter(dir, SOURCES);
      expect((await readdir(dir)).sort()).toEqual([
        "bin",
        "design",
        "requirement.md",
        "run",
        "skills",
        "store",
      ]);
      expect(await readFile(join(dir, "requirement.md"), "utf8")).toBe(
        await readFile(SOURCES.requirementFile, "utf8"),
      );
      expect((await readdir(join(dir, "skills"))).sort()).toEqual(
        [...WRITER_SKILLS].sort(),
      );
      expect((await readdir(join(dir, "bin"))).sort()).toEqual([
        "sigil",
        "sigilc",
      ]);
      expect(await exists(join(dir, "design", ".sigil", "config.json"))).toBe(
        true,
      );
      expect(await readdir(join(dir, "run"))).toEqual([]);
      expect(await readdir(join(dir, "store"))).toEqual([]);
      expect(Object.keys(staged.digests).sort()).toEqual([
        "bin/sigil",
        "bin/sigilc",
        "requirement.md",
        ...WRITER_SKILLS.map((name) => `skills/${name}`).sort(),
      ]);
      // The snapshot covers everything but the writable directories.
      expect(staged.snapshot.has("requirement.md")).toBe(true);
      expect(staged.snapshot.has("skills/sigil-write/SKILL.md")).toBe(true);
      expect(
        [...staged.snapshot.keys()].some((key) => key.startsWith("design")),
      )
        .toBe(false);
      await expect(stageWriter(dir, SOURCES)).rejects.toThrow(/not empty/);
    },
    30_000,
  );

  test("snapshot differences name what was added, changed or removed", () => {
    const before = new Map([["a", "1"], ["b", "2"], [".pi/agents/x.md", "3"]]);
    const after = new Map([["a", "1"], ["b", "9"], ["c", "4"]]);
    expect(snapshotDifferences(before, after)).toEqual([
      "added c",
      "changed b",
      "removed .pi/agents/x.md",
    ]);
    expect(
      snapshotDifferences(before, after, (path) => path.startsWith(".pi")),
    ).toEqual(["added c", "changed b"]);
  });

  test("a design copy leaves out the claims readings a tool left in it", async () => {
    const scratch = await tempDir();
    const source = join(scratch, "design");
    await mkdir(join(source, ".sigil", "claims", "interpretations"), {
      recursive: true,
    });
    await writeFile(join(source, ".sigil", "config.json"), "{}");
    await writeFile(
      join(source, ".sigil", "claims", "interpretations", "x.json"),
      "{}",
    );
    await writeFile(join(source, "a.sigil"), "component A {}\n");
    await copyDesign(source, join(scratch, "copy"));
    expect(await exists(join(scratch, "copy", "a.sigil"))).toBe(true);
    expect(await exists(join(scratch, "copy", ".sigil", "config.json"))).toBe(
      true,
    );
    expect(await exists(join(scratch, "copy", ".sigil", "claims"))).toBe(false);
  });
});

describe("launching the writer", () => {
  test(
    "Claude gets both child definitions and deny rules on the forbidden roots",
    async () => {
      const scratch = await tempDir();
      const dir = join(scratch, "writer");
      await stageWriter(dir, SOURCES);
      const writer = await fakeWriter(scratch, { review: "delegated" });
      const result = await launchWriter({
        agent: "claude",
        model: "writer-model",
        effort: "high",
        dir,
        evidenceDir: join(scratch, "evidence"),
        host: hostOptions(writer),
      });
      expect(result.status).toBe("completed");
      expect(result.handback).toEqual({
        state: "written",
        review: "delegated",
      });
      const seen = JSON.parse(
        await readFile(join(dir, "run", "argv.json"), "utf8"),
      ) as { argv: string[]; sigil: string };
      const settings = JSON.parse(
        seen.argv[seen.argv.indexOf("--settings") + 1]!,
      );
      expect(settings.permissions.deny).toContain(`Read(/${REPO_ROOT}/**)`);
      const agents = JSON.parse(seen.argv[seen.argv.indexOf("--agents") + 1]!);
      expect(Object.keys(agents).sort()).toEqual(["interpreter", "reviewer"]);
      expect(agents.reviewer.tools).not.toContain("Write");
      expect(agents.interpreter.model).toBe("writer-model");
      expect(seen.argv).toContain("Bash(sigil *)");
      // `sigil` on PATH is the staged copy.
      expect(seen.sigil).toMatch(/\d+\.\d+/);
      const prompt = await readFile(
        join(scratch, "evidence", "prompt.txt"),
        "utf8",
      );
      expect(prompt).toContain("Hand-back: STATE, review REVIEW");
    },
    30_000,
  );

  test(
    "Pi gets both child definitions as agent files and no Claude settings",
    async () => {
      const scratch = await tempDir();
      const dir = join(scratch, "writer");
      await stageWriter(dir, SOURCES);
      const writer = await fakeWriter(scratch, { host: "pi" });
      const result = await launchWriter({
        agent: "pi",
        model: "writer-model",
        effort: "high",
        dir,
        evidenceDir: join(scratch, "evidence"),
        host: hostOptions(writer),
      });
      expect(result.status).toBe("completed");
      expect(result.handback).toEqual({ state: "written", review: "none" });
      const seen = JSON.parse(
        await readFile(join(dir, "run", "argv.json"), "utf8"),
      ) as { argv: string[]; piAgents: string[] };
      expect(seen.argv).not.toContain("--settings");
      expect(seen.piAgents).toEqual(["interpreter.md", "reviewer.md"]);
    },
    30_000,
  );
});

describe("the read scan", () => {
  async function scanned(events: unknown[]) {
    const scratch = await tempDir();
    const dir = join(scratch, "writer");
    const staged = await stageWriter(dir, SOURCES);
    const evidenceDir = join(scratch, "evidence");
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      join(evidenceDir, "stdout.jsonl"),
      events.map((event) => JSON.stringify(event).replaceAll("STAGING", dir))
        .join("\n"),
    );
    return {
      dir,
      result: await checkWriterIntegrity({
        agent: "claude",
        dir,
        evidenceDir,
        staged,
        forbiddenRoots: ROOTS,
        home: homedir(),
      }),
    };
  }

  test("a run that stays in its staging directory is clean", async () => {
    const { result } = await scanned([
      { type: "system", subtype: "init", cwd: "STAGING" },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "requirement.md" },
            },
            {
              type: "tool_use",
              name: "Bash",
              input: {
                command: "mkdir -p run/prep && sigil fmt design/a.sigil",
              },
            },
          ],
        },
      },
    ]);
    expect(result.reads).toBe("clean");
    expect(result.invalid).toBeNull();
    expect(result.reviewerStarts).toBe(0);
  }, 30_000);

  test(
    "a child with no visible calls leaves the reads unverified but the pass valid",
    async () => {
      const { result } = await scanned([
        { type: "system", subtype: "init", cwd: "STAGING" },
        {
          type: "assistant",
          message: {
            content: [{
              type: "tool_use",
              id: "toolu_1",
              name: "Agent",
              input: { subagent_type: "reviewer" },
            }],
          },
        },
      ]);
      expect(result.reads).toBe("unverified");
      expect(result.invalid).toBeNull();
      expect(result.reviewerStarts).toBe(1);
    },
    30_000,
  );

  test(
    "a shell write into skills/ is invalid even when the bytes come back unchanged",
    async () => {
      const { result } = await scanned([
        { type: "system", subtype: "init", cwd: "STAGING" },
        {
          type: "assistant",
          message: {
            content: [{
              type: "tool_use",
              name: "Bash",
              input: { command: "cp skills/sigil-write/SKILL.md skills/x.md" },
            }],
          },
        },
      ]);
      expect(result.invalid).toMatch(
        /a write outside design\/, run\/ and store\//,
      );
      expect(result.findings.outsideWrites[0]).toMatch(/skills\/x\.md$/);
    },
    30_000,
  );

  test("a staged binary that changed is invalid", async () => {
    const scratch = await tempDir();
    const dir = join(scratch, "writer");
    const staged = await stageWriter(dir, SOURCES);
    await writeFile(join(dir, "bin", "sigilc"), "#!/bin/sh\n");
    await writeJson(join(scratch, "evidence", "unused.json"), {});
    const result = await checkWriterIntegrity({
      agent: "codex",
      dir,
      evidenceDir: join(scratch, "evidence"),
      staged,
      forbiddenRoots: ROOTS,
      home: homedir(),
    });
    expect(result.findings.changedInputs).toEqual(["bin/sigilc"]);
    expect(result.invalid).toMatch(/staged inputs changed: bin\/sigilc/);
  }, 30_000);
});

test("a stage's status follows how its host ended", () => {
  const base = { error: null } as Parameters<typeof outcomeOf>[0];
  expect(outcomeOf({ ...base, status: "completed" }, "writer")).toEqual({
    status: "done",
    error: null,
  });
  expect(outcomeOf({ ...base, status: "timeout" }, "writer")).toEqual({
    status: "failed",
    error: "the writer timed out",
  });
  expect(outcomeOf({ ...base, status: "cancelled" }, "writer").status).toBe(
    "interrupted",
  );
  expect(
    outcomeOf({ ...base, status: "failed", error: "Agent exited 2" }, "writer"),
  ).toEqual({ status: "failed", error: "Agent exited 2" });
});
