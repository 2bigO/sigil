import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BaselineKey,
  baselineKeyDigest,
  batchBaselineKey,
  designDigest,
  keyDifferences,
  readingsDigest,
  referenceStoreDigest,
  sharedKeyDigest,
} from "./baseline.ts";
import type { BatchManifest } from "./records.ts";
import { READER, tempDir, TWO_COMPONENTS, writeDesign } from "./testing.ts";

const manifest: BatchManifest = {
  version: 1,
  benchmark: "slotted-with-split",
  writers: [{ agent: "claude", model: "writer-model" }],
  effort: "high",
  passes: 1,
  skillDigests: { "sigil-write": "s1" },
  writerBinaries: { sigil: "b1", sigilc: "b2" },
  reader: READER,
  requirements: { requirementFile: "file", requirementList: "list" },
  reference: { tree: "tree", store: "store" },
  readings: { guidanceFingerprint: "g1", vocabularyGeneration: 5 },
  createdAt: "2026-10-21T00:00:00Z",
};

describe("the baseline key (KTD10)", () => {
  test("holds guidance, vocabulary, reference, reader and requirement digests", () => {
    expect(batchBaselineKey(manifest)).toEqual({
      guidanceFingerprint: "g1",
      vocabularyGeneration: 5,
      referenceTree: "tree",
      referenceStore: "store",
      reader: READER,
      requirementList: "list",
      requirementFile: { benchmark: "slotted-with-split", digest: "file" },
    });
  });

  test("does not depend on when the batch was made", async () => {
    const later = { ...manifest, createdAt: "2027-01-01T00:00:00Z" };
    expect(await baselineKeyDigest(batchBaselineKey(later))).toBe(
      await baselineKeyDigest(batchBaselineKey(manifest)),
    );
  });

  test("every part changes the key, and the shared key leaves out only the requirement file", async () => {
    const key = batchBaselineKey(manifest);
    const variants: BaselineKey[] = [
      { ...key, guidanceFingerprint: "g2" },
      { ...key, vocabularyGeneration: 6 },
      { ...key, referenceTree: "tree2" },
      { ...key, referenceStore: "store2" },
      { ...key, reader: { ...READER, model: "other" } },
      { ...key, requirementList: "list2" },
    ];
    const base = await sharedKeyDigest(key);
    for (const variant of variants) {
      expect(await sharedKeyDigest(variant)).not.toBe(base);
      expect(keyDifferences(key, variant).length).toBe(1);
    }
    const otherFile = {
      ...key,
      requirementFile: { benchmark: "slotted-with-split", digest: "f2" },
    };
    expect(await sharedKeyDigest(otherFile)).toBe(base);
    expect(await baselineKeyDigest(otherFile)).not.toBe(
      await baselineKeyDigest(key),
    );
    expect(keyDifferences(key, otherFile)).toEqual([
      "slotted-with-split requirement file",
    ]);
    expect(keyDifferences(key, { ...key, guidanceFingerprint: "g2" })).toEqual(
      ["guidance fingerprint (law set)"],
    );
  });
});

describe("digests", () => {
  test("a design's digest ignores caches and readings under .sigil but not its config", async () => {
    const root = await writeDesign(await tempDir(), TWO_COMPONENTS);
    const before = await designDigest(root);
    await mkdir(join(root, ".sigil", "trees"), { recursive: true });
    await writeFile(join(root, ".sigil", "trees", "x.json"), "{}");
    expect(await designDigest(root)).toBe(before);
    await writeFile(join(root, ".sigil", "config.json"), "{}\n");
    expect(await designDigest(root)).not.toBe(before);
  });

  test("the readings digest follows the stored interpretations only", async () => {
    const store = await tempDir();
    const empty = await readingsDigest(store);
    await mkdir(join(store, "claims", "interpretations"), { recursive: true });
    await writeFile(join(store, "claims", "workspace.linked.json"), "{}");
    expect(await readingsDigest(store)).toBe(empty);
    await writeFile(join(store, "claims", "interpretations", "k.json"), "{}");
    expect(await readingsDigest(store)).not.toBe(empty);
  });

  test("the reference store digest follows readings, their identity and coverage", async () => {
    const dir = await tempDir();
    const digests = [await referenceStoreDigest(dir)];
    await writeFile(join(dir, "readings.json"), "{}");
    digests.push(await referenceStoreDigest(dir));
    await writeFile(join(dir, "coverage.json"), "{}");
    digests.push(await referenceStoreDigest(dir));
    await mkdir(join(dir, "store", "claims", "interpretations"), {
      recursive: true,
    });
    await writeFile(
      join(dir, "store", "claims", "interpretations", "k.json"),
      "{}",
    );
    digests.push(await referenceStoreDigest(dir));
    expect(new Set(digests).size).toBe(4);
    // The reader is keyed on its own, so its file does not move this digest.
    await writeFile(join(dir, "reader.json"), "{}");
    expect(await referenceStoreDigest(dir)).toBe(digests[3]!);
  });
});
