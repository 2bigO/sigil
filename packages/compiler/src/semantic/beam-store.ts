import { validateWorldBeam, type WorldBeamCheckpoint } from "./beam.ts";
import { digest, SemanticInputError } from "./turtle.ts";

export interface StoredWorldBeam {
  readonly revision: string;
  readonly checkpoint: WorldBeamCheckpoint;
}

function beamPath(root: string, name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new SemanticInputError(
      "INVALID_BEAM_NAME",
      "Beam names use 1 to 64 lowercase letters, digits, underscores, or hyphens.",
    );
  }
  return `${root}/.sigil/beams/${name}.json`;
}

export async function readWorldBeam(
  root: string,
  name: string,
): Promise<StoredWorldBeam | undefined> {
  let source: string;
  try {
    source = await Deno.readTextFile(beamPath(root, name));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  if (source.length > 16 * 1024 * 1024) {
    throw new SemanticInputError(
      "INVALID_BEAM",
      "Beam checkpoint exceeds its size limit.",
    );
  }
  let checkpoint: unknown;
  try {
    checkpoint = JSON.parse(source);
  } catch {
    throw new SemanticInputError(
      "INVALID_BEAM",
      "Beam checkpoint is not valid JSON.",
    );
  }
  validateWorldBeam(checkpoint);
  return { revision: await digest(source), checkpoint };
}

/** Atomic compare-and-swap checkpoint transport. Loading never returns cached proof. */
export async function writeWorldBeam(
  root: string,
  name: string,
  checkpoint: WorldBeamCheckpoint,
  expectedRevision?: string,
): Promise<StoredWorldBeam> {
  validateWorldBeam(checkpoint);
  const path = beamPath(root, name);
  await Deno.mkdir(`${root}/.sigil/beams`, { recursive: true });
  const lock = `${path}.lock`;
  try {
    await Deno.mkdir(lock);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw new SemanticInputError(
        "BEAM_BUSY",
        "Another write owns this beam checkpoint lock.",
      );
    }
    throw error;
  }
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    const current = await readWorldBeam(root, name);
    if (current?.revision !== expectedRevision) {
      throw new SemanticInputError(
        "STALE_BEAM",
        "The beam changed before the write could commit.",
      );
    }
    const source = JSON.stringify(checkpoint) + "\n";
    await Deno.writeTextFile(temporary, source, { createNew: true });
    await Deno.rename(temporary, path);
    return { revision: await digest(source), checkpoint };
  } finally {
    try {
      await Deno.remove(temporary).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    } finally {
      await Deno.remove(lock);
    }
  }
}
