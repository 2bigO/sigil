import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** True when a node file-system error says the path does not exist. */
export function isNotFound(cause: unknown): boolean {
  return (cause as { code?: unknown } | null)?.code === "ENOENT";
}

/** An error's message, or the thrown value as text. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (cause) {
    if (isNotFound(cause)) return false;
    throw cause;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}

/**
 * Run `body` in a fresh directory under the OS temp directory, removed
 * afterwards however `body` ends.
 */
export async function withTempDir<T>(
  prefix: string,
  body: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await body(dir);
  } finally {
    // Windows may hold a just-killed process's files open for a moment.
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

/** The lowercase hex sha256 of `bytes`. */
export function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash("sha256").update(bytes).digest("hex"));
}

/** The sha256 of a file's bytes. */
export async function fileDigest(path: string): Promise<string> {
  return await sha256(await readFile(path));
}

export interface CopyTreeOptions {
  /**
   * Relative paths (with `/` separators) left out, together with everything
   * beneath them.
   */
  readonly skip?: ReadonlySet<string>;
  /** `reject` (default): a symbolic link is an error. `keep`: copied as a link. */
  readonly symlinks?: "reject" | "keep";
  /**
   * What happens to an entry that is neither a file, a directory nor a kept
   * link: `reject` (default) throws, `skip` leaves it out.
   */
  readonly special?: "reject" | "skip";
  /** Copy nothing, and make no destination, when the source does not exist. */
  readonly allowMissingRoot?: boolean;
}

/**
 * Copy a directory tree. By default only regular files and directories may
 * be in it. The third argument is the options, or a `skip` set on its own.
 */
export async function copyTree(
  source: string,
  destination: string,
  options: CopyTreeOptions | ReadonlySet<string> = {},
): Promise<void> {
  const settings: CopyTreeOptions = options instanceof Set
    ? { skip: options as ReadonlySet<string> }
    : options as CopyTreeOptions;
  await copyEntries(source, destination, settings, "");
}

async function copyEntries(
  source: string,
  destination: string,
  options: CopyTreeOptions,
  prefix: string,
): Promise<void> {
  let entries;
  if (options.allowMissingRoot) {
    try {
      entries = await readdir(source, { withFileTypes: true });
    } catch (cause) {
      if (prefix === "" && isNotFound(cause)) return;
      throw cause;
    }
    await mkdir(destination, { recursive: true });
  } else {
    await mkdir(destination, { recursive: true });
    entries = await readdir(source, { withFileTypes: true });
  }
  for (const entry of entries) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (options.skip?.has(name)) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyEntries(from, to, options, name);
    else if (entry.isSymbolicLink()) {
      if (options.symlinks !== "keep") throw unsupported(from);
      await symlink(await readlink(from), to);
    } else if (entry.isFile()) await copyFile(from, to);
    else if (options.special !== "skip") throw unsupported(from);
  }
}

function unsupported(path: string): Error {
  return new Error(`Unsupported entry in a copied tree: ${path}`);
}

/** Copy the files a staged skill needs: SKILL.md, VERSION and references/. */
export async function copySkill(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const file of ["SKILL.md", "VERSION"]) {
    try {
      await copyFile(join(source, file), join(destination, file));
    } catch (cause) {
      if (file === "VERSION" && isNotFound(cause)) continue;
      throw cause;
    }
  }
  await copyTree(join(source, "references"), join(destination, "references"));
}

/** A stable hash of every file name and its content under a directory. */
export async function treeSha256(root: string): Promise<string> {
  const rows: string[] = [];
  async function visit(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(dir, entry.name), name);
      else if (entry.isFile()) {
        rows.push(`${name}:${await fileDigest(join(dir, entry.name))}`);
      }
    }
  }
  await visit(root, "");
  return sha256(new TextEncoder().encode(rows.join("\n")));
}
