import { parseUniqueJson } from "./proposal-protocol.ts";

export const NATIVE_RUNTIME_MANIFEST_VERSION = 1 as const;
export const PINNED_TYPESCRIPT_VERSION = "7.0.2" as const;
export const TYPESCRIPT_RUNTIME_EXTRACTOR_VERSION = 3 as const;
export const RUNTIME_MANIFEST_MAX_BYTES = 1024 * 1024;
export const RUNTIME_FILE_LIMIT = 4096;
export const RUNTIME_PAYLOAD_MAX_BYTES = 512 * 1024 * 1024;

export interface NativeRuntimeManifestV1 {
  readonly version: 1;
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
  readonly files: readonly {
    path: string;
    sha256: string;
    executable: boolean;
  }[];
}

export interface RuntimeInfoV1 {
  readonly version: 1;
  readonly engineProtocolVersion: 1;
  readonly kernelFingerprint: string;
  readonly bridgeVersion: string;
}

export function validateRuntimeManifest(
  value: unknown,
): asserts value is NativeRuntimeManifestV1 {
  const object = (candidate: unknown): candidate is Record<string, unknown> =>
    !!candidate && typeof candidate === "object" && !Array.isArray(candidate);
  const hash = (candidate: unknown): candidate is string =>
    typeof candidate === "string" && /^[a-f0-9]{64}$/.test(candidate);
  const safePath = (candidate: unknown): candidate is string =>
    typeof candidate === "string" && candidate.length > 0 &&
    candidate.length <= 512 && !candidate.startsWith("/") &&
    !candidate.includes("\\") &&
    !candidate.split("/").some((part) => part === ".." || part === ".") &&
    !candidate.split("/").includes("") && candidate !== ".";
  if (
    !object(value) || value.version !== 1 ||
    typeof value.sigilVersion !== "string" ||
    !value.sigilVersion || typeof value.target !== "string" || !value.target ||
    value.engineProtocolVersion !== 1 || !hash(value.kernelFingerprint) ||
    value.typescriptVersion !== PINNED_TYPESCRIPT_VERSION ||
    value.typescriptExtractorVersion !== TYPESCRIPT_RUNTIME_EXTRACTOR_VERSION ||
    (value.egglogPath !== "egglog/sigil-semantic-engine" &&
      value.egglogPath !== "egglog/sigil-semantic-engine.exe") ||
    (value.typescriptPath !== "typescript/tsc" &&
      value.typescriptPath !== "typescript/tsc.exe") ||
    !Array.isArray(value.files) || value.files.length > RUNTIME_FILE_LIMIT ||
    Object.keys(value).some((key) =>
      ![
        "version",
        "sigilVersion",
        "target",
        "engineProtocolVersion",
        "kernelFingerprint",
        "typescriptVersion",
        "typescriptExtractorVersion",
        "egglogPath",
        "typescriptPath",
        "files",
      ].includes(key)
    )
  ) {
    throw new Error("Invalid native runtime manifest.");
  }
  const paths = new Set<string>();
  let previousPath = "";
  for (const file of value.files) {
    if (
      !object(file) || !safePath(file.path) || paths.has(file.path) ||
      !hash(file.sha256) || typeof file.executable !== "boolean" ||
      Object.keys(file).some((key) =>
        !["path", "sha256", "executable"].includes(key)
      )
    ) {
      throw new Error("Invalid native runtime manifest file entry.");
    }
    if (file.path <= previousPath) {
      throw new Error("Native runtime manifest files are not sorted.");
    }
    previousPath = file.path;
    paths.add(file.path);
  }
  if (
    !paths.has(value.egglogPath) || !paths.has(value.typescriptPath) ||
    !value.files.find((file) => file.path === value.egglogPath)?.executable ||
    !value.files.find((file) => file.path === value.typescriptPath)?.executable
  ) {
    throw new Error("Native runtime manifest omits a required executable.");
  }
}

export function decodeRuntimeInfo(source: string): RuntimeInfoV1 {
  if (new TextEncoder().encode(source).length > 1024 * 1024) {
    throw new Error("Runtime handshake exceeds its size limit.");
  }
  let value: unknown;
  try {
    value = parseUniqueJson(source, 1024 * 1024);
  } catch {
    throw new Error("Runtime handshake is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid runtime handshake.");
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1 || raw.engineProtocolVersion !== 1 ||
    typeof raw.kernelFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.kernelFingerprint) ||
    typeof raw.bridgeVersion !== "string" || !raw.bridgeVersion ||
    Object.keys(raw).some((key) =>
      ![
        "version",
        "engineProtocolVersion",
        "kernelFingerprint",
        "bridgeVersion",
      ].includes(key)
    )
  ) {
    throw new Error("Invalid runtime handshake.");
  }
  return raw as unknown as RuntimeInfoV1;
}
