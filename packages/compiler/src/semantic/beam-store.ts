import {
  atomicCompileFile,
  type CompileArtifactLockOptions,
  initializeCompileArtifacts,
  withCompileArtifactLock,
} from "./artifacts.ts";
import { validateWorldBeam, type WorldBeamCheckpoint } from "./beam.ts";
import { digest, SemanticInputError } from "./turtle.ts";
import { parseUniqueJson } from "./proposal-protocol.ts";

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
  const path = beamPath(root, name);
  let source: string;
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isFile || stat.isSymlink || stat.size > 16 * 1024 * 1024) {
      throw new SemanticInputError(
        "INVALID_BEAM",
        "Beam checkpoint must be a bounded regular file.",
      );
    }
    const bytes = await Deno.readFile(path);
    if (bytes.byteLength > 16 * 1024 * 1024) {
      throw new SemanticInputError(
        "INVALID_BEAM",
        "Beam checkpoint exceeds its size limit.",
      );
    }
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new SemanticInputError(
        "INVALID_BEAM",
        "Beam checkpoint is not valid UTF-8.",
      );
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  let checkpoint: unknown;
  try {
    checkpoint = parseUniqueJson(source, 16 * 1024 * 1024);
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
  options: { readonly lock?: CompileArtifactLockOptions } = {},
): Promise<StoredWorldBeam> {
  validateWorldBeam(checkpoint);
  const path = beamPath(root, name);
  await Deno.mkdir(`${root}/.sigil/beams`, { recursive: true });
  await initializeCompileArtifacts(root);
  return withCompileArtifactLock(root, `beam-${name}`, async () => {
    const current = await readWorldBeam(root, name);
    if (current?.revision !== expectedRevision) {
      throw new SemanticInputError(
        "STALE_BEAM",
        "The beam changed before the write could commit.",
      );
    }
    const source = JSON.stringify(checkpoint) + "\n";
    await atomicCompileFile(root, path, source);
    return { revision: await digest(source), checkpoint };
  }, options.lock);
}
