import {
  parseSemanticWorld,
  SemanticInputError,
  type SemanticWorld,
  serializeSemanticWorld,
} from "./turtle.ts";

export interface SemanticStateReceipt {
  readonly version: 1;
  readonly worldFingerprint: string;
  readonly sourceFingerprint: string;
  /** Maps source component identities to their canonical semantic entities. */
  readonly componentBindings: Readonly<Record<string, string>>;
}

export interface StoredSemanticState {
  readonly receipt: SemanticStateReceipt;
  readonly world: SemanticWorld;
}

const fingerprint = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function validateReceipt(value: unknown): SemanticStateReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SemanticInputError(
      "INVALID_SEMANTIC_STATE",
      "Semantic state receipt must be an object.",
    );
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1 || !fingerprint(raw.worldFingerprint) ||
    !fingerprint(raw.sourceFingerprint) ||
    !raw.componentBindings || typeof raw.componentBindings !== "object" ||
    Array.isArray(raw.componentBindings) ||
    Object.values(raw.componentBindings).some((id) =>
      typeof id !== "string" || !id
    )
  ) {
    throw new SemanticInputError(
      "INVALID_SEMANTIC_STATE",
      "Semantic state receipt has an invalid version, fingerprint, or component binding.",
    );
  }
  return raw as unknown as SemanticStateReceipt;
}

export async function readSemanticState(
  root: string,
): Promise<StoredSemanticState | undefined> {
  let source: string;
  try {
    source = await Deno.readTextFile(`${root}/.sigil/semantic.json`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  let raw;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new SemanticInputError(
      "INVALID_SEMANTIC_STATE",
      "Semantic state receipt is not valid JSON.",
    );
  }
  const receipt = validateReceipt(raw);
  let turtle: string;
  try {
    turtle = await Deno.readTextFile(
      `${root}/.sigil/worlds/${receipt.worldFingerprint}.ttl`,
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
  return { world, receipt };
}

/** Content-addressed Turtle plus an atomic head; no cached proof is persisted. */
export async function writeSemanticState(
  root: string,
  state: StoredSemanticState,
  expectedFingerprint?: string,
): Promise<void> {
  const receipt = validateReceipt(state.receipt);
  if (receipt.worldFingerprint !== state.world.fingerprint) {
    throw new SemanticInputError(
      "INVALID_SEMANTIC_STATE",
      "Receipt and world fingerprints differ.",
    );
  }
  const directory = `${root}/.sigil`;
  await Deno.mkdir(`${directory}/worlds`, { recursive: true });
  const lock = `${directory}/semantic-write.lock`;
  try {
    await Deno.mkdir(lock);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw new SemanticInputError(
        "SEMANTIC_STATE_BUSY",
        "Another semantic state write owns the workspace lock.",
      );
    }
    throw error;
  }
  const temporary = `${directory}/semantic-${crypto.randomUUID()}.tmp`;
  try {
    const current = await readSemanticState(root);
    if (current?.world.fingerprint !== expectedFingerprint) {
      throw new SemanticInputError(
        "STALE_WORLD",
        "Semantic state changed before the write could commit.",
      );
    }
    const turtle = serializeSemanticWorld(state.world);
    const reparsed = await parseSemanticWorld([{
      sourceId: "canonical-semantic-state",
      turtle,
    }]);
    if (reparsed.fingerprint !== receipt.worldFingerprint) {
      throw new SemanticInputError(
        "INVALID_SEMANTIC_STATE",
        "Semantic state is not stable under Turtle serialization.",
      );
    }
    await Deno.writeTextFile(
      `${directory}/worlds/${receipt.worldFingerprint}.ttl`,
      turtle,
    );
    await Deno.writeTextFile(temporary, JSON.stringify(receipt) + "\n", {
      createNew: true,
    });
    await Deno.rename(temporary, `${directory}/semantic.json`);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
    await Deno.remove(lock);
  }
}
