import { join, relative } from "node:path";

export interface RuntimeManifestFile {
  readonly path: string;
  readonly sha256: string;
  readonly executable: boolean;
}

export interface RuntimeManifestInput {
  readonly sigilVersion: string;
  readonly target: string;
  readonly engineProtocolVersion: 1;
  readonly kernelFingerprint: string;
  readonly typescriptVersion: "7.0.2";
  readonly typescriptExtractorVersion: 3;
  readonly egglogPath:
    | "egglog/sigil-semantic-engine"
    | "egglog/sigil-semantic-engine.exe";
  readonly typescriptPath: "typescript/tsc" | "typescript/tsc.exe";
}

export interface RuntimeManifestV1 extends RuntimeManifestInput {
  readonly version: 1;
  readonly files: readonly RuntimeManifestFile[];
}

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FILES = 4096;
const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;

export async function createRuntimeManifest(
  runtimeRoot: string,
  input: RuntimeManifestInput,
): Promise<{ manifest: RuntimeManifestV1; source: string; hash: string }> {
  const files: RuntimeManifestFile[] = [];
  let payloadBytes = 0;
  await walk(runtimeRoot, runtimeRoot, files, (size) => {
    payloadBytes += size;
    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      throw new Error("Native runtime payload exceeds its 512 MiB limit.");
    }
  });
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (files.length > MAX_FILES) {
    throw new Error("Native runtime contains more than 4096 files.");
  }
  if (!files.some((file) => file.path === input.egglogPath)) {
    throw new Error(`Runtime is missing ${input.egglogPath}.`);
  }
  if (!files.some((file) => file.path === input.typescriptPath)) {
    throw new Error(`Runtime is missing ${input.typescriptPath}.`);
  }
  const manifest: RuntimeManifestV1 = { version: 1, ...input, files };
  const source = canonicalJson(manifest);
  if (new TextEncoder().encode(source).byteLength > MAX_MANIFEST_BYTES) {
    throw new Error("Native runtime manifest exceeds its 1 MiB limit.");
  }
  return { manifest, source, hash: await sha256(source) };
}

async function walk(
  root: string,
  directory: string,
  files: RuntimeManifestFile[],
  count: (size: number) => void,
): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    if (entry.name === "manifest.json") continue;
    const path = join(directory, entry.name);
    const stat = await Deno.lstat(path);
    if (stat.isSymlink) {
      throw new Error(`Runtime cannot contain symlinks: ${path}`);
    }
    if (stat.isDirectory) {
      await walk(root, path, files, count);
      continue;
    }
    if (!stat.isFile) {
      throw new Error(`Runtime entry is not a regular file: ${path}`);
    }
    const bytes = await Deno.readFile(path);
    count(bytes.byteLength);
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (
      !relativePath || relativePath.includes("..") ||
      relativePath.startsWith("/")
    ) {
      throw new Error(`Runtime path escapes its root: ${relativePath}`);
    }
    files.push({
      path: relativePath,
      sha256: await sha256(bytes),
      executable: /(?:^|\/)(?:tsc|sigil-semantic-engine)(?:\.exe)?$/.test(
        relativePath,
      ),
    });
  }
}

function canonicalJson(value: unknown): string {
  const encode = (item: unknown): string => {
    if (
      item === null || typeof item === "string" || typeof item === "boolean"
    ) {
      return JSON.stringify(item);
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`;
    if (item && typeof item === "object") {
      return `{${
        Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([key, child]) => `${JSON.stringify(key)}:${encode(child)}`)
          .join(",")
      }}`;
    }
    throw new Error("Runtime manifest contains unsupported JSON.");
  };
  return encode(value) + "\n";
}

async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((
    byte,
  ) => byte.toString(16).padStart(2, "0")).join("");
}
