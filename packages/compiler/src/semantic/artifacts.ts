import { resolve } from "node:path";
import { digest, SemanticInputError } from "./turtle.ts";

export const COMPILE_ARTIFACT_KINDS = [
  "world",
  "handoffs",
  "receipts",
  "runs",
  "cache",
] as const;
export type CompileArtifactKind = typeof COMPILE_ARTIFACT_KINDS[number];
/** Generated artifacts must not feed back into source or implementation discovery. */
export function isCompileArtifactDirectory(
  parent: string,
  name: string,
): boolean {
  return resolve(parent).replaceAll("\\", "/").endsWith("/.sigil") &&
    [...COMPILE_ARTIFACT_KINDS, "beams", "worlds"].includes(name);
}
export interface CompileArtifactInput {
  readonly kind: CompileArtifactKind;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, string>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface CompileArtifactManifest {
  readonly version: 1;
  readonly kind: CompileArtifactKind;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, string>>;
  readonly metadata: Readonly<Record<string, unknown>>;
}
export interface CompileArtifact {
  readonly id: string;
  readonly manifest: CompileArtifactManifest;
  readonly files: Readonly<Record<string, string>>;
}
export const isFingerprint = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export interface CompileArtifactLockOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
const MAX_BYTES = 32 * 1024 * 1024;
const IGNORE_MARKER =
  "# Sigil incremental artifacts (accepted world and policy remain tracked)";
const IGNORES = ["/receipts/", "/handoffs/", "/runs/", "/cache/", "/beams/"];

/** Canonical JSON for transport identities, not an additional semantic language. */
export function artifactJson(value: unknown): string {
  const seen = new Set<object>();
  function encode(value: unknown, depth: number): string {
    if (depth > 64) throw new Error("Artifact metadata is too deeply nested.");
    if (
      value === null || typeof value === "string" || typeof value === "boolean"
    ) return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) {
      return JSON.stringify(value);
    }
    if (typeof value !== "object" || !value || seen.has(value)) {
      throw new Error("Artifact metadata must contain acyclic JSON values.");
    }
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        return "[" + value.map((v) => encode(v, depth + 1)).join(",") + "]";
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new Error("Artifact metadata must contain plain JSON objects.");
      }
      return "{" + Object.entries(value).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0
      ).map(([key, item]) =>
        JSON.stringify(key) + ":" + encode(item, depth + 1)
      ).join(",") + "}";
    } finally {
      seen.delete(value);
    }
  }
  return encode(value, 0) + "\n";
}
function invalid(message: string): never {
  throw new SemanticInputError("INVALID_COMPILE_ARTIFACT", message);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function kind(value: unknown): value is CompileArtifactKind {
  return COMPILE_ARTIFACT_KINDS.includes(value as CompileArtifactKind);
}
function filename(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) &&
    name !== "manifest.json";
}
function manifest(value: unknown): CompileArtifactManifest {
  if (
    !object(value) || value.version !== 1 || !kind(value.kind) ||
    Object.keys(value).some((key) =>
      !["version", "kind", "dependencies", "files", "metadata"].includes(key)
    ) ||
    !object(value.dependencies) ||
    Object.keys(value.dependencies).length > 1000 ||
    Object.entries(value.dependencies).some(([key, value]) =>
      !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(key) || !isFingerprint(value)
    ) ||
    !object(value.files) || !Object.keys(value.files).length ||
    Object.keys(value.files).length > 64 ||
    Object.entries(value.files).some(([name, hash]) =>
      !filename(name) || !isFingerprint(hash)
    ) || !object(value.metadata)
  ) {
    invalid(
      "Invalid artifact manifest, dependency fingerprint or payload name.",
    );
  }
  if (artifactJson(value).length > 1024 * 1024) {
    invalid("Artifact manifest exceeds its 1 MiB limit.");
  }
  return value as unknown as CompileArtifactManifest;
}
async function directory(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
  const stat = await Deno.lstat(path);
  if (!stat.isDirectory || stat.isSymlink) {
    invalid(`Artifact directory must be a real directory: ${path}.`);
  }
}
async function regularText(
  path: string,
  maxBytes = MAX_BYTES,
): Promise<string> {
  const stat = await Deno.lstat(path);
  if (!stat.isFile || stat.isSymlink || stat.size > maxBytes) {
    invalid(`Artifact payload is not a bounded regular file: ${path}.`);
  }
  const bytes = await Deno.readFile(path);
  if (bytes.length > maxBytes) {
    invalid("Artifact payload exceeds its byte limit.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    invalid("Artifact payload is not valid UTF-8.");
  }
}

/** Locks are released by the OS if a writer exits. Keep lock files in place so
 * waiting writers always coordinate on the same inode. */
export async function withCompileArtifactLock<T>(
  root: string,
  name: string,
  action: () => Promise<T>,
  options: CompileArtifactLockOptions = {},
): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name)) {
    invalid("Invalid artifact lock name.");
  }
  await directory(resolve(root, ".sigil"));
  await directory(resolve(root, ".sigil/cache"));
  await directory(resolve(root, ".sigil/cache/locks"));
  const path = resolve(root, ".sigil/cache/locks", name + ".lock");
  try {
    if ((await Deno.lstat(path)).isSymlink) {
      invalid("Artifact lock cannot be a symlink.");
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  using file = await Deno.open(path, { create: true, read: true, write: true });
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    invalid("Artifact lock timeout must be a positive safe integer.");
  }
  const deadline = performance.now() + timeoutMs;
  let acquired = false;
  try {
    while (!acquired) {
      options.signal?.throwIfAborted();
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        throw new SemanticInputError(
          "ARTIFACT_LOCK_TIMEOUT",
          `Timed out acquiring compile artifact lock ${name}.`,
        );
      }
      acquired = await file.tryLock(true);
      if (!acquired) {
        await abortableDelay(options.signal, Math.min(25, remaining));
      }
    }
    return await action();
  } finally {
    if (acquired) await file.unlock();
  }
}

function abortableDelay(
  signal: AbortSignal | undefined,
  milliseconds: number,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Operation cancelled.", "AbortError"),
    );
  }
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(
        signal?.reason ??
          new DOMException("Operation cancelled.", "AbortError"),
      );
    };
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    timer = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

export async function initializeCompileArtifacts(
  root: string,
): Promise<Readonly<Record<CompileArtifactKind, string>>> {
  await directory(resolve(root, ".sigil"));
  for (const name of COMPILE_ARTIFACT_KINDS) {
    await directory(resolve(root, ".sigil", name));
  }
  await directory(resolve(root, ".sigil/cache/tmp"));
  await withCompileArtifactLock(root, "layout", async () => {
    const path = resolve(root, ".sigil/.gitignore");
    let existing = "";
    try {
      existing = await regularText(path, 1024 * 1024);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (existing.includes(IGNORE_MARKER)) return;
    await atomicCompileFile(
      root,
      path,
      existing + (existing && !existing.endsWith("\n") ? "\n" : "") + "\n" +
        IGNORE_MARKER + "\n" + IGNORES.join("\n") + "\n",
    );
  });
  return Object.fromEntries(
    COMPILE_ARTIFACT_KINDS.map((name) => [name, resolve(root, ".sigil", name)]),
  ) as Record<CompileArtifactKind, string>;
}

/** Caller coordinates any mutable destination using a revision lock. */
export async function atomicCompileFile(
  root: string,
  destination: string,
  text: string,
): Promise<void> {
  const temporary = resolve(root, ".sigil/cache/tmp", crypto.randomUUID());
  await directory(resolve(root, ".sigil/cache/tmp"));
  try {
    const bytes = new TextEncoder().encode(text);
    using file = await Deno.open(temporary, {
      createNew: true,
      write: true,
    });
    let offset = 0;
    while (offset < bytes.byteLength) {
      offset += await file.write(bytes.subarray(offset));
    }
    await file.sync();
    file.close();
    await Deno.rename(temporary, destination);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

/** Integrity-checked data only. Loading never grants evidence authority. */
export async function readCompileArtifact(
  root: string,
  artifactKind: CompileArtifactKind,
  id: string,
): Promise<CompileArtifact | undefined> {
  if (!kind(artifactKind) || !isFingerprint(id)) {
    invalid("Invalid artifact kind or identity.");
  }
  const base = resolve(root, ".sigil", artifactKind, id);
  try {
    for (
      const path of [
        resolve(root, ".sigil"),
        resolve(root, ".sigil", artifactKind),
        base,
      ]
    ) {
      const stat = await Deno.lstat(path);
      if (!stat.isDirectory || stat.isSymlink) {
        invalid("Artifact path must contain only real directories.");
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  let source: string;
  try {
    source = await regularText(resolve(base, "manifest.json"), 1024 * 1024);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      try {
        await Deno.lstat(base);
      } catch (nested) {
        if (nested instanceof Deno.errors.NotFound) return;
        throw nested;
      }
      invalid("An existing artifact is missing its manifest.");
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    invalid("Artifact manifest is not valid JSON.");
  }
  const value = manifest(parsed);
  if (value.kind !== artifactKind || await digest(artifactJson(value)) !== id) {
    invalid("Artifact manifest differs from its recorded identity.");
  }
  const files: Record<string, string> = {};
  let bytes = 0;
  for (const [name, expected] of Object.entries(value.files)) {
    const text = await regularText(resolve(base, name));
    bytes += new TextEncoder().encode(text).length;
    if (bytes > MAX_BYTES || await digest(text) !== expected) {
      invalid(`Artifact payload differs from its recorded hash: ${name}.`);
    }
    files[name] = text;
  }
  return { id, manifest: value, files };
}

export async function writeCompileArtifact(
  root: string,
  input: CompileArtifactInput,
): Promise<CompileArtifact> {
  const files = { ...input.files };
  let bytes = 0;
  const hashes: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) {
    if (!filename(name) || typeof text !== "string") {
      invalid("Invalid artifact payload name or text.");
    }
    bytes += new TextEncoder().encode(text).length;
    if (bytes > MAX_BYTES) {
      invalid("Artifact payloads exceed the 32 MiB limit.");
    }
    hashes[name] = await digest(text);
  }
  const value = manifest({
    version: 1,
    kind: input.kind,
    dependencies: { ...input.dependencies },
    files: hashes,
    metadata: input.metadata ?? {},
  });
  const source = artifactJson(value);
  const id = await digest(source);
  await initializeCompileArtifacts(root);
  return withCompileArtifactLock(root, id, async () => {
    const existing = await readCompileArtifact(root, input.kind, id);
    if (existing) return existing;
    const temporary = resolve(root, ".sigil/cache/tmp", crypto.randomUUID());
    await Deno.mkdir(temporary);
    try {
      for (const [name, text] of Object.entries(files)) {
        await Deno.writeTextFile(resolve(temporary, name), text, {
          createNew: true,
        });
      }
      await Deno.writeTextFile(resolve(temporary, "manifest.json"), source, {
        createNew: true,
      });
      await Deno.rename(temporary, resolve(root, ".sigil", input.kind, id));
    } finally {
      await Deno.remove(temporary, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
    return { id, manifest: value, files };
  });
}
