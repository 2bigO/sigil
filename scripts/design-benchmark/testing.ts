/**
 * Helpers for the measure and report tests: small canned designs written to
 * temp directories and read with the real `sigilc`. No test starts a host.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeJson } from "../agent-runner/files.ts";
import type { CoverageEntry, CoverageFile } from "./coverage.ts";
import {
  type BatchManifest,
  COVERAGE_VERSION,
  defaultSigilc,
  type PassRecord,
  type ReaderIdentity,
} from "./records.ts";

export const SIGILC = defaultSigilc();

const made: string[] = [];

/**
 * Remove every directory `tempDir` made. `test-setup.ts`, preloaded by
 * `bunfig.toml`, runs it once after the whole run: an `afterAll` in this
 * module would bind to the first test file only and leak the others' dirs.
 */
export async function removeTempDirs(): Promise<void> {
  const dirs = made.splice(0);
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
}

export async function tempDir(prefix = "design-benchmark-test-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

const CONFIG = {
  sigilVersion: "0.9.0",
  workspace: { name: "canned", members: [] },
  files: { include: ["**/*.sigil"], exclude: [".git/**"] },
  tools: {},
};

/** Sigil source for one component: sections of paragraphs, and imports. */
export function component(
  name: string,
  sections: Record<string, readonly string[]>,
  imports: readonly { path: string; provider: string; names: string[] }[] = [],
): string {
  const head = imports.map((entry) =>
    `@${entry.path} from ${entry.provider} import { ${
      entry.names.join(", ")
    } }\n`
  ).join("");
  const body = Object.entries(sections).map(([section, paragraphs]) =>
    `  ${section} {\n${
      paragraphs.map((paragraph) => `    ${paragraph}\n`).join("\n")
    }  }\n`
  ).join("\n");
  return `${head}component ${name} {\n${body}}\n`;
}

/** Write a design workspace: `.sigil/config.json` and the given sources. */
export async function writeDesign(
  dir: string,
  files: Record<string, string>,
): Promise<string> {
  await mkdir(join(dir, ".sigil"), { recursive: true });
  await writeFile(
    join(dir, ".sigil", "config.json"),
    `${JSON.stringify(CONFIG, null, 2)}\n`,
  );
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return dir;
}

/** Two components where A imports and mentions B's Tag. */
export const TWO_COMPONENTS = {
  "a.sigil": component("A", {
    goal: ["Keep each *gadget* attached to one widget."],
    state: ["A owns each gadget, which points at one widget."],
    interface: ["A provides the gadget to callers."],
  }, [{ path: "b.sigil", provider: "B", names: ["widget"] }]),
  "b.sigil": component("B", {
    goal: ["Hold every *widget* in one place."],
    interface: ["B provides the widget."],
  }),
};

export const READER: ReaderIdentity = {
  agent: "claude",
  model: "reader-model",
  effort: "high",
  skillDigests: { "sigil-compute-design": "aaa" },
  coveragePromptDigest: "bbb",
};

export function coverageFile(
  ids: readonly string[],
  digests: {
    list: string;
    files: Record<string, string>;
  },
  answers: Record<string, { id: string; label: string }[]> = {},
  overrides: Partial<CoverageFile> = {},
): CoverageFile {
  return {
    version: COVERAGE_VERSION,
    requirementList: { name: "slotted", digest: digests.list },
    requirementFiles: digests.files,
    reader: READER,
    entries: ids.map((id): CoverageEntry =>
      answers[id]
        ? { id, verdict: "answered", facets: answers[id]! }
        : { id, verdict: "none", facets: [] }
    ),
    ...overrides,
  };
}

/** A passing record with every stage done. */
export function passRecord(
  id: string,
  overrides: Partial<PassRecord> = {},
): PassRecord {
  const done = { status: "done", error: null } as const;
  return {
    version: 1,
    id,
    agent: "claude",
    model: "writer-model",
    stages: { writer: done, readScan: done, claims: done, coverage: done },
    reads: "clean",
    review: "delegated",
    stagingPath: null,
    ...overrides,
  };
}

/** Write a batch directory from a manifest and its passes' designs. */
export async function writeBatch(
  dir: string,
  manifest: BatchManifest,
  passes: readonly {
    record: PassRecord;
    design?: Record<string, string>;
    coverage?: CoverageFile;
  }[],
): Promise<string> {
  await writeJson(join(dir, "manifest.json"), manifest);
  for (const pass of passes) {
    const attempt = join(dir, "attempts", pass.record.id);
    await writeJson(join(attempt, "record.json"), pass.record);
    if (pass.design) await writeDesign(join(attempt, "design"), pass.design);
    await mkdir(join(attempt, "store", "claims", "interpretations"), {
      recursive: true,
    });
    if (pass.coverage) {
      await writeJson(join(attempt, "coverage.json"), pass.coverage);
    }
  }
  return dir;
}
