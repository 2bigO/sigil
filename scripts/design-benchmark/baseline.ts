/**
 * The baseline key. Numbers are compared in one table only when
 * their batches share a key; a change to any part starts a new baseline.
 *
 * The key holds:
 * - the guidance fingerprint and vocabulary generation the claims readings
 *   were taken under (the fingerprint is the law set plus the guidance, the
 *   only law identity `sigilc` exposes; stored readings are keyed by it);
 * - the reference design digest and the reference store digest;
 * - the pinned reader identity;
 * - the requirement list digest and the benchmark's requirement file digest.
 *
 * Batches of different benchmarks that share a list can still share a
 * baseline: `sharedKey` leaves out the requirement file, and each batch's file
 * digest is checked against the current file for its own benchmark.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileDigest, isNotFound, sha256 } from "../agent-runner/files.ts";
import {
  type BatchManifest,
  canonicalJson,
  compareText,
  INTERPRETATIONS_DIR,
  type ReaderIdentity,
  type ReadingsIdentity,
  referenceStorePaths,
  sameJson,
} from "./records.ts";

export interface BaselineKey {
  readonly guidanceFingerprint: string | null;
  readonly vocabularyGeneration: number | null;
  readonly referenceTree: string;
  readonly referenceStore: string;
  readonly reader: ReaderIdentity;
  readonly requirementList: string;
  readonly requirementFile: {
    readonly benchmark: string;
    readonly digest: string;
  };
}

const encoder = new TextEncoder();

export async function textDigest(text: string): Promise<string> {
  return await sha256(encoder.encode(text));
}

export async function optionalFileDigest(path: string): Promise<string | null> {
  try {
    return await fileDigest(path);
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw cause;
  }
}

/** Relative paths of every regular file under `root`, with `/` separators. */
async function listFiles(
  root: string,
  keep: (path: string) => boolean,
): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string, prefix: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (cause) {
      if (isNotFound(cause) && prefix === "") return;
      throw cause;
    }
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(dir, entry.name), path);
      else if (entry.isFile() && keep(path)) out.push(path);
    }
  };
  await visit(root, "");
  return out.sort(compareText);
}

async function filesDigest(
  root: string,
  keep: (path: string) => boolean,
): Promise<string> {
  const rows: string[] = [];
  for (const path of await listFiles(root, keep)) {
    rows.push(`${path}:${await fileDigest(join(root, path))}`);
  }
  return await textDigest(rows.join("\n"));
}

/**
 * A design's identity: its sources and its `.sigil/config.json`, leaving out
 * caches and readings that a tool may have left in `.sigil/`.
 */
export async function designDigest(root: string): Promise<string> {
  return await filesDigest(
    root,
    (path) => !path.startsWith(".sigil/") || path === ".sigil/config.json",
  );
}

/** The identity of a store's claims readings: its stored interpretations. */
export async function readingsDigest(store: string): Promise<string> {
  return await filesDigest(
    join(store, INTERPRETATIONS_DIR),
    (path) => path.endsWith(".json"),
  );
}

/**
 * The reference store's identity: its claims readings, the identity they were
 * taken under, and its coverage reading. The reader is keyed on its own.
 */
export async function referenceStoreDigest(dir: string): Promise<string> {
  const paths = referenceStorePaths(dir);
  return await textDigest(
    [
      `claims:${await readingsDigest(paths.store)}`,
      `readings:${(await optionalFileDigest(paths.readings)) ?? "none"}`,
      `coverage:${(await optionalFileDigest(paths.coverage)) ?? "none"}`,
    ].join("\n"),
  );
}

export function describeReader(reader: ReaderIdentity): string {
  return canonicalJson(reader);
}

/** The key a batch ran under, from its manifest. */
export function batchBaselineKey(manifest: BatchManifest): BaselineKey {
  return {
    guidanceFingerprint: manifest.readings?.guidanceFingerprint ?? null,
    vocabularyGeneration: manifest.readings?.vocabularyGeneration ?? null,
    referenceTree: manifest.reference.tree,
    referenceStore: manifest.reference.store,
    reader: manifest.reader,
    requirementList: manifest.requirements.requirementList,
    requirementFile: {
      benchmark: manifest.benchmark,
      digest: manifest.requirements.requirementFile,
    },
  };
}

/** The current reference's key for one benchmark. */
export function referenceBaselineKey(input: {
  readonly readings: ReadingsIdentity | null;
  readonly referenceTree: string;
  readonly referenceStore: string;
  readonly reader: ReaderIdentity;
  readonly requirementList: string;
  readonly benchmark: string;
  readonly requirementFile: string;
}): BaselineKey {
  return {
    guidanceFingerprint: input.readings?.guidanceFingerprint ?? null,
    vocabularyGeneration: input.readings?.vocabularyGeneration ?? null,
    referenceTree: input.referenceTree,
    referenceStore: input.referenceStore,
    reader: input.reader,
    requirementList: input.requirementList,
    requirementFile: {
      benchmark: input.benchmark,
      digest: input.requirementFile,
    },
  };
}

/** Everything in the key but the benchmark's own requirement file. */
export async function sharedKeyDigest(key: BaselineKey): Promise<string> {
  const { requirementFile: _file, ...shared } = key;
  return await textDigest(canonicalJson(shared));
}

/** The digest of the whole key. */
export async function baselineKeyDigest(key: BaselineKey): Promise<string> {
  return await textDigest(canonicalJson(key));
}

/** The names of the key parts that differ, for a report to state. */
export function keyDifferences(a: BaselineKey, b: BaselineKey): string[] {
  const out: string[] = [];
  if (a.guidanceFingerprint !== b.guidanceFingerprint) {
    out.push("guidance fingerprint (law set)");
  }
  if (a.vocabularyGeneration !== b.vocabularyGeneration) {
    out.push("vocabulary generation");
  }
  if (a.referenceTree !== b.referenceTree) out.push("reference design");
  if (a.referenceStore !== b.referenceStore) out.push("reference readings");
  if (!sameJson(a.reader, b.reader)) {
    out.push("pinned reader");
  }
  if (a.requirementList !== b.requirementList) out.push("requirement list");
  if (
    a.requirementFile.benchmark === b.requirementFile.benchmark &&
    a.requirementFile.digest !== b.requirementFile.digest
  ) out.push(`${a.requirementFile.benchmark} requirement file`);
  return out;
}
