import { resolve } from "node:path";
import {
  artifactJson,
  atomicCompileFile,
  initializeCompileArtifacts,
  isFingerprint,
  readCompileArtifact,
  withCompileArtifactLock,
  writeCompileArtifact,
} from "./artifacts.ts";
import { parseEggWorld, serializeEggWorld } from "./egg-world.ts";
import type { SemanticEngineOptions } from "./engine.ts";
import {
  digest,
  parseSemanticWorld,
  SemanticInputError,
  type SemanticWorld,
} from "./turtle.ts";

export interface SemanticStateReceipt {
  readonly version: 1;
  readonly worldFingerprint: string;
  readonly sourceFingerprint: string;
  readonly componentBindings: Readonly<Record<string, string>>;
}
export interface StoredSemanticState {
  readonly receipt: SemanticStateReceipt;
  readonly world: SemanticWorld;
  /** Covers bindings/source metadata as well as the accepted assertion set. */
  readonly revision: string;
}
function validateReceipt(value: unknown): SemanticStateReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SemanticInputError(
      "INVALID_SEMANTIC_STATE",
      "Semantic state receipt must be an object.",
    );
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1 || !isFingerprint(raw.worldFingerprint) ||
    !isFingerprint(raw.sourceFingerprint) ||
    !raw.componentBindings || typeof raw.componentBindings !== "object" ||
    Array.isArray(raw.componentBindings) ||
    Object.values(raw.componentBindings).some((id) =>
      typeof id !== "string" || !id
    ) ||
    Object.keys(raw).some((key) =>
      !["version", "worldFingerprint", "sourceFingerprint", "componentBindings"]
        .includes(key)
    )
  ) {
    throw new SemanticInputError(
      "INVALID_SEMANTIC_STATE",
      "Semantic state receipt has an invalid version, fingerprint, or component binding.",
    );
  }
  return raw as unknown as SemanticStateReceipt;
}
async function readJson(path: string): Promise<unknown | undefined> {
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isFile || stat.isSymlink || stat.size > 1024 * 1024) {
      throw new SemanticInputError(
        "INVALID_SEMANTIC_STATE",
        "Semantic state metadata must be a bounded regular file.",
      );
    }
    return JSON.parse(await Deno.readTextFile(path));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    if (error instanceof SyntaxError) {
      throw new SemanticInputError(
        "INVALID_SEMANTIC_STATE",
        "Semantic state receipt is not valid JSON.",
      );
    }
    throw error;
  }
}

export async function readSemanticState(
  root: string,
  engine: SemanticEngineOptions = {},
): Promise<StoredSemanticState | undefined> {
  engine.signal?.throwIfAborted();
  const head = await readJson(resolve(root, ".sigil/world/current.json"));
  if (head !== undefined) {
    if (
      !head || typeof head !== "object" || Array.isArray(head) ||
      (head as Record<string, unknown>).version !== 1 ||
      !isFingerprint((head as Record<string, unknown>).revision) ||
      Object.keys(head).some((key) => !["version", "revision"].includes(key))
    ) {
      throw new SemanticInputError(
        "INVALID_SEMANTIC_STATE",
        "Invalid canonical world revision pointer.",
      );
    }
    const revision = (head as { revision: string }).revision;
    const artifact = await readCompileArtifact(root, "world", revision);
    if (!artifact || Object.keys(artifact.files).join() !== "assertions.egg") {
      throw new SemanticInputError(
        "INVALID_SEMANTIC_STATE",
        "The canonical assertion bundle is missing or malformed.",
      );
    }
    const receipt = validateReceipt(artifact.manifest.metadata.receipt);
    const world = await parseEggWorld(artifact.files["assertions.egg"], engine);
    if (
      world.fingerprint !== receipt.worldFingerprint ||
      artifact.manifest.dependencies.world !== world.fingerprint ||
      artifact.manifest.dependencies.source !== receipt.sourceFingerprint
    ) {
      throw new SemanticInputError(
        "INVALID_SEMANTIC_STATE",
        "Canonical assertions differ from their recorded identity.",
      );
    }
    return { world, receipt, revision };
  }
  // Read old assertion-only state without modifying a checkout during inspection.
  const raw = await readJson(resolve(root, ".sigil/semantic.json"));
  if (raw === undefined) return;
  const receipt = validateReceipt(raw);
  let turtle: string;
  try {
    turtle = await Deno.readTextFile(
      resolve(root, ".sigil/worlds", receipt.worldFingerprint + ".ttl"),
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new SemanticInputError(
        "INVALID_SEMANTIC_STATE",
        "The semantic state's Turtle file is missing.",
      );
    }
    throw error;
  }
  const world = await parseSemanticWorld([{
    sourceId: "canonical-semantic-state",
    turtle,
  }]);
  if (world.fingerprint !== receipt.worldFingerprint) {
    throw new SemanticInputError(
      "INVALID_SEMANTIC_STATE",
      "Canonical Turtle differs from its recorded fingerprint.",
    );
  }
  return { world, receipt, revision: await digest(artifactJson(receipt)) };
}

/** Commit accepted assertions as a lossless data-only .egg bundle. CAS compares
 * the whole revision, including metadata-only changes, and OS locks survive crashes. */
export async function writeSemanticState(
  root: string,
  state: Omit<StoredSemanticState, "revision">,
  expectedRevision?: string,
): Promise<StoredSemanticState> {
  const receipt = validateReceipt(state.receipt);
  const assertions = serializeEggWorld(state.world);
  const world = await parseEggWorld(assertions);
  if (
    receipt.worldFingerprint !== state.world.fingerprint ||
    world.fingerprint !== state.world.fingerprint
  ) {
    throw new SemanticInputError(
      "INVALID_SEMANTIC_STATE",
      "Receipt and world fingerprints differ, or assertions do not round-trip.",
    );
  }
  await initializeCompileArtifacts(root);
  return withCompileArtifactLock(root, "world", async () => {
    const current = await readSemanticState(root);
    if (current?.revision !== expectedRevision) {
      throw new SemanticInputError(
        "STALE_WORLD",
        "Semantic state changed before the write could commit.",
      );
    }
    const artifact = await writeCompileArtifact(root, {
      kind: "world",
      dependencies: {
        world: world.fingerprint,
        source: receipt.sourceFingerprint,
      },
      files: { "assertions.egg": assertions },
      metadata: { receipt },
    });
    await atomicCompileFile(
      root,
      resolve(root, ".sigil/world/current.json"),
      artifactJson({ version: 1, revision: artifact.id }),
    );
    return { world, receipt, revision: artifact.id };
  });
}
