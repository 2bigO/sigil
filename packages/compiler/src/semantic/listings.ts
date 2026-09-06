import { resolve } from "node:path";
import { canonicalWorkspacePath } from "../compilation-target.ts";
import { isFingerprint, readCompileArtifact } from "./artifacts.ts";
import { readWorldBeam } from "./beam-store.ts";
import { readImplementationHandoff } from "./handoff.ts";
import type { SemanticEngineOptions } from "./engine.ts";
import { SemanticInputError } from "./turtle.ts";
import type { SemanticComponentRegistry } from "./component-registry.ts";

export const SEMANTIC_LISTING_KINDS = [
  "components",
  "beams",
  "handoffs",
  "receipts",
] as const;
export type SemanticListingKind = typeof SEMANTIC_LISTING_KINDS[number];

export interface SemanticComponentListItem {
  readonly id: string;
  readonly label: string | null;
  readonly authoredPath: string | null;
  readonly viewPath: string;
}
export interface SemanticBeamListItem {
  readonly id: string;
  readonly revision: string;
}
export interface SemanticHandoffListItem {
  readonly id: string;
  readonly subjects: readonly string[];
  readonly worldFingerprint: string;
}
export interface SemanticReceiptListItem {
  readonly id: string;
  readonly handoff: string;
}
export type SemanticListingItem =
  | SemanticComponentListItem
  | SemanticBeamListItem
  | SemanticHandoffListItem
  | SemanticReceiptListItem;

const MAX_ITEMS = 1_000;

function invalid(message: string): never {
  throw new SemanticInputError("INVALID_SEMANTIC_LISTING", message);
}

async function entries(root: string, kind: "beams" | "handoffs" | "receipts") {
  const directory = resolve(root, ".sigil", kind);
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.lstat(directory);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [] as Deno.DirEntry[];
    throw error;
  }
  if (!stat.isDirectory || stat.isSymlink) {
    invalid(`Semantic ${kind} inventory is not a real directory.`);
  }
  const result: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(directory)) result.push(entry);
  return result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function limit(kind: SemanticListingKind, count: number): void {
  if (count > MAX_ITEMS) {
    invalid(`Semantic ${kind} inventory exceeds the ${MAX_ITEMS} item limit.`);
  }
}

/**
 * Lists documentary semantic inventory after validating every retained entry.
 * No item returned here is a semantic verdict or an authorization to execute.
 */
export async function listSemanticInventory(options: {
  readonly root: string;
  readonly kind: Exclude<SemanticListingKind, "components">;
  readonly engine?: SemanticEngineOptions;
}): Promise<readonly SemanticListingItem[]> {
  const { root, kind, engine } = options;
  const result: SemanticListingItem[] = [];
  if (kind === "beams") {
    const all = await entries(root, kind);
    const files = all.filter((entry) => entry.name.endsWith(".lock"));
    // Permanent OS lock files and old lock directories are operational state,
    // never beams. All other entries must be canonical beam JSON files.
    for (const entry of all) {
      if (files.includes(entry)) continue;
      if (!entry.name.endsWith(".json")) {
        invalid(`Unexpected semantic beam inventory entry: ${entry.name}.`);
      }
      const name = entry.name.slice(0, -5);
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
        invalid(`Invalid semantic beam inventory entry: ${entry.name}.`);
      }
      if (!entry.isFile || entry.isSymlink) {
        invalid(`Semantic beam entry is not a regular file: ${entry.name}.`);
      }
      const beam = await readWorldBeam(root, name);
      if (!beam) invalid(`Semantic beam disappeared while listing: ${name}.`);
      result.push({ id: name, revision: beam.revision });
    }
    limit(kind, result.length);
    return result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  const all = await entries(root, kind);
  limit(kind, all.length);
  for (const entry of all) {
    if (!entry.isDirectory || entry.isSymlink || !isFingerprint(entry.name)) {
      invalid(`Invalid semantic ${kind} inventory entry: ${entry.name}.`);
    }
    const artifact = await readCompileArtifact(root, kind, entry.name);
    if (!artifact) {
      invalid(`Semantic ${kind} entry disappeared: ${entry.name}.`);
    }
    if (kind === "handoffs") {
      const handoff = await readImplementationHandoff(root, entry.name, engine);
      result.push({
        id: handoff.id,
        subjects: handoff.manifest.subjects,
        worldFingerprint: handoff.manifest.worldFingerprint,
      });
      continue;
    }
    if (artifact.manifest.metadata.role !== "untrusted-receipts") {
      invalid(`Receipt artifact ${entry.name} has an invalid role.`);
    }
    const handoff = artifact.manifest.dependencies.handoff;
    if (!isFingerprint(handoff)) {
      invalid(
        `Receipt artifact ${entry.name} has no retained handoff identity.`,
      );
    }
    result.push({ id: entry.name, handoff });
  }
  return result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function listSemanticComponents(
  registry: SemanticComponentRegistry,
  root: string,
): readonly SemanticComponentListItem[] {
  const items = registry.entries.map((entry) => ({
    id: entry.entity,
    label: entry.label ?? null,
    authoredPath: entry.authored
      ? canonicalWorkspacePath(entry.authored.filePath, root)
      : null,
    viewPath: entry.projectedPath,
  })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  limit("components", items.length);
  return items;
}

export type { SemanticComponentRegistry };
