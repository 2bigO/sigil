import { dirname, isAbsolute, relative, resolve } from "node:path";
import { digest } from "./turtle.ts";
import { isCompileArtifactDirectory } from "./artifacts.ts";

export interface ImplementationFile {
  readonly path: string;
  readonly hash: string;
  readonly bytes?: Uint8Array;
  readonly symlink?: string;
  readonly executable: boolean;
}
export interface ImplementationSnapshot {
  readonly fingerprint: string;
  readonly files: readonly ImplementationFile[];
}
const EXCLUDED = new Set([
  ".git",
  ".codex-progress",
  ".deno",
  ".vscode-test",
  "repos",
  "target",
  "build",
  "coverage",
  "node_modules",
]);

export function implementationPath(path: string): boolean {
  return typeof path === "string" && !!path && !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((part) =>
      !!part && part !== "." && part !== ".." && !EXCLUDED.has(part)
    );
}
export async function bytesHash(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function snapshotFromFiles(
  files: readonly ImplementationFile[],
): Promise<ImplementationSnapshot> {
  const ordered = [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  );
  return {
    fingerprint: await digest(
      JSON.stringify(
        ordered.map((
          file,
        ) => [file.path, file.hash, file.symlink, file.executable]),
      ),
    ),
    files: ordered,
  };
}

/** Capture dirty working files too. Internal symlinks stay internal in every copy. */
// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationHandoff::RetainedHandoff interface
export async function captureImplementationSnapshot(
  root: string,
  signal?: AbortSignal,
): Promise<ImplementationSnapshot> {
  root = await Deno.realPath(root);
  const files: ImplementationFile[] = [];
  let bytes = 0;
  async function visit(directory: string) {
    for await (const entry of Deno.readDir(directory)) {
      signal?.throwIfAborted();
      if (
        EXCLUDED.has(entry.name) ||
        isCompileArtifactDirectory(directory, entry.name) ||
        directory.endsWith("/.sigil") && entry.name === ".gitignore"
      ) continue;
      const full = resolve(directory, entry.name);
      const path = relative(root, full).replaceAll("\\", "/");
      if (!implementationPath(path)) {
        throw new Error(`Unsupported implementation path: ${path}.`);
      }
      if (entry.isDirectory) await visit(full);
      else if (entry.isSymlink) {
        const target = await Deno.readLink(full);
        const resolved = await Deno.realPath(full);
        const internal = relative(root, resolved).replaceAll("\\", "/");
        if (isAbsolute(target) || !implementationPath(internal)) {
          throw new Error(
            `Implementation symlink escapes its snapshot: ${path}.`,
          );
        }
        files.push({
          path,
          symlink: target,
          hash: await digest(target),
          executable: false,
        });
      } else if (entry.isFile) {
        const metadata = await Deno.stat(full);
        bytes += metadata.size;
        if (bytes > 256 * 1024 * 1024) {
          throw new Error("Implementation snapshot exceeds its 256 MiB limit.");
        }
        const contents = await Deno.readFile(full);
        bytes += contents.length - metadata.size;
        if (bytes > 256 * 1024 * 1024) {
          throw new Error(
            "Implementation snapshot grew beyond its byte limit.",
          );
        }
        files.push({
          path,
          bytes: contents,
          hash: await bytesHash(contents),
          executable: !!((metadata.mode ?? 0) & 0o111),
        });
      } else {throw new Error(
          `Unsupported implementation filesystem entry: ${path}.`,
        );}
      if (files.length > 30_000) {
        throw new Error(
          "Implementation snapshot exceeds its 30000-file limit.",
        );
      }
    }
  }
  await visit(root);
  return snapshotFromFiles(files);
}

/** Filesystem work isolation, with no persistent verdict or source mutation. */
export async function withImplementationSnapshot<T>(
  snapshot: ImplementationSnapshot,
  operation: (root: string) => Promise<T>,
): Promise<T> {
  if (
    (await snapshotFromFiles(snapshot.files)).fingerprint !==
      snapshot.fingerprint ||
    new Set(snapshot.files.map((f) => f.path)).size !== snapshot.files.length
  ) throw new Error("Invalid implementation snapshot identity.");
  for (const file of snapshot.files) {
    if (
      !implementationPath(file.path) ||
      snapshot.files.some((parent) =>
        parent.symlink && file.path.startsWith(parent.path + "/")
      )
    ) throw new Error("Unsafe snapshot path.");
    if (file.symlink) {
      const target = relative(
        "/snapshot",
        resolve("/snapshot", dirname(file.path), file.symlink),
      ).replaceAll("\\", "/");
      if (
        isAbsolute(file.symlink) || !implementationPath(target) ||
        await digest(file.symlink) !== file.hash ||
        !snapshot.files.some((f) =>
          f.path === target || f.path.startsWith(target + "/")
        )
      ) throw new Error("Unsafe snapshot symlink.");
    } else if (!file.bytes || await bytesHash(file.bytes) !== file.hash) {
      throw new Error("Snapshot bytes differ from their identity.");
    }
  }
  const root = await Deno.makeTempDir({ prefix: "sigil-implementation-" });
  try {
    for (const file of snapshot.files.filter((file) => !file.symlink)) {
      const path = resolve(root, file.path);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeFile(path, file.bytes!, {
        mode: file.executable ? 0o755 : 0o644,
      });
    }
    for (const file of snapshot.files.filter((file) => file.symlink)) {
      const path = resolve(root, file.path);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.symlink(file.symlink!, path);
    }
    return await operation(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}
