import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeRuntimeInfo,
  type NativeRuntimeManifestV1,
  RUNTIME_MANIFEST_MAX_BYTES,
  RUNTIME_PAYLOAD_MAX_BYTES,
  validateRuntimeManifest,
} from "./runtime-protocol.ts";

export type SemanticRuntimeMode = "standalone" | "source" | "explicit";
export interface SemanticRuntime {
  readonly mode: SemanticRuntimeMode;
  readonly root?: string;
  readonly manifest?: NativeRuntimeManifestV1;
  readonly engineExecutable: string;
  readonly typescriptExecutable?: string;
}

export interface RuntimeDoctorResultV1 {
  readonly version: 1;
  readonly ok: boolean;
  readonly mode: SemanticRuntimeMode;
  readonly target: string;
  readonly sigilVersion: string;
  readonly kernelFingerprint?: string;
  readonly typescriptVersion?: string;
  readonly checks: readonly { id: string; ok: boolean; message: string }[];
}

let standaloneIdentity: {
  manifestHash: string;
  sigilVersion: string;
  target: string;
} | undefined;

export function configureStandaloneRuntime(
  identity: { manifestHash: string; sigilVersion: string; target: string },
): void {
  if (
    !/^[a-f0-9]{64}$/.test(identity.manifestHash) || !identity.sigilVersion ||
    !identity.target
  ) throw new Error("Invalid standalone runtime identity.");
  if (
    standaloneIdentity &&
    JSON.stringify(standaloneIdentity) !== JSON.stringify(identity)
  ) {
    throw new Error(
      "Standalone runtime identity was already configured differently.",
    );
  }
  standaloneIdentity = { ...identity };
}

export async function resolveSemanticRuntime(
  options: {
    runtimeDirectory?: string;
    binaryPath?: string;
    sigilVersion?: string;
  } = {},
): Promise<SemanticRuntime> {
  if (options.binaryPath) {
    return { mode: "explicit", engineExecutable: options.binaryPath };
  }
  let environmentOverride: string | undefined;
  try {
    environmentOverride = Deno.env.get("SIGIL_RUNTIME_DIR");
  } catch {
    // Library callers may intentionally omit environment permission.
  }
  const override = options.runtimeDirectory ?? environmentOverride;
  if (override) {
    return await loadRuntime(override, "explicit", options.sigilVersion);
  }
  const executable = await standaloneRoot();
  if (standaloneIdentity && executable) {
    return await loadRuntime(
      executable,
      "standalone",
      standaloneIdentity.sigilVersion,
      standaloneIdentity,
    );
  }
  const sourceEngine = new URL(
    "../../native/target/release/sigil-semantic-engine" +
      (Deno.build.os === "windows" ? ".exe" : ""),
    import.meta.url,
  );
  const sourcePath = sourceEngine.protocol === "file:"
    ? fileURLToPath(sourceEngine)
    : "";
  try {
    if (sourcePath && (await Deno.stat(sourcePath)).isFile) {
      return { mode: "source", engineExecutable: sourcePath };
    }
  } catch { /* source build is optional */ }
  throw new Error(
    "Sigil's native runtime is unavailable. Run deno task build:semantic or select SIGIL_RUNTIME_DIR.",
  );
}

async function standaloneRoot(): Promise<string | undefined> {
  try {
    const executable = await Deno.realPath(Deno.execPath());
    const bin = dirname(executable);
    const root = join(bin, "..", "lib", "sigil", "runtime");
    if ((await Deno.stat(join(root, "manifest.json"))).isFile) return root;
  } catch { /* source/test mode */ }
  return undefined;
}

async function loadRuntime(
  root: string,
  mode: SemanticRuntimeMode,
  sigilVersion?: string,
  identity?: { manifestHash: string; sigilVersion: string; target: string },
): Promise<SemanticRuntime> {
  const manifestPath = join(root, "manifest.json");
  const source = await Deno.readTextFile(manifestPath);
  if (new TextEncoder().encode(source).length > RUNTIME_MANIFEST_MAX_BYTES) {
    throw new Error("Native runtime manifest exceeds its size limit.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new Error("Native runtime manifest is not valid JSON.");
  }
  validateRuntimeManifest(raw);
  const manifest = raw;
  if (sigilVersion && manifest.sigilVersion !== sigilVersion) {
    throw new Error("Native runtime Sigil version does not match the CLI.");
  }
  if (identity) {
    const hash = await sha256(source);
    if (hash !== identity.manifestHash) {
      throw new Error("Native runtime manifest hash does not match the CLI.");
    }
    if (manifest.target !== identity.target) {
      throw new Error("Native runtime target does not match the CLI.");
    }
  }
  let payloadBytes = 0;
  for (const file of manifest.files) {
    const path = join(root, ...file.path.split("/"));
    const stat = await Deno.lstat(path);
    if (stat.isSymlink || !stat.isFile) {
      throw new Error(
        `Native runtime file failed integrity validation: ${file.path}`,
      );
    }
    payloadBytes += stat.size;
    if (payloadBytes > RUNTIME_PAYLOAD_MAX_BYTES) {
      throw new Error("Native runtime payload exceeds its size limit.");
    }
    const bytes = await Deno.readFile(path);
    if (await sha256(bytes) !== file.sha256) {
      throw new Error(
        `Native runtime file failed integrity validation: ${file.path}`,
      );
    }
  }
  const engineExecutable = join(root, ...manifest.egglogPath.split("/"));
  const typescriptExecutable = join(
    root,
    ...manifest.typescriptPath.split("/"),
  );
  return { mode, root, manifest, engineExecutable, typescriptExecutable };
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

/** Validate a native engine's identity handshake against a runtime manifest. */
export function validateRuntimeHandshake(
  source: string,
  manifest: Pick<
    NativeRuntimeManifestV1,
    "engineProtocolVersion" | "kernelFingerprint"
  >,
): void {
  const info = decodeRuntimeInfo(source);
  if (
    info.engineProtocolVersion !== manifest.engineProtocolVersion ||
    info.kernelFingerprint !== manifest.kernelFingerprint
  ) throw new Error("Native runtime handshake does not match its manifest.");
}

export async function runtimeDoctor(
  options: {
    runtimeDirectory?: string;
    sigilVersion?: string;
    signal?: AbortSignal;
  } = {},
): Promise<RuntimeDoctorResultV1> {
  const deadline = new AbortController();
  const timer = setTimeout(
    () =>
      deadline.abort(
        new DOMException("Runtime doctor timed out.", "TimeoutError"),
      ),
    30_000,
  );
  const signal = AbortSignal.any([
    deadline.signal,
    ...(options.signal ? [options.signal] : []),
  ]);
  let temporary: string | undefined;
  try {
    signal.throwIfAborted();
    const runtime = await resolveSemanticRuntime({
      runtimeDirectory: options.runtimeDirectory,
      sigilVersion: options.sigilVersion,
    });
    const checks: { id: string; ok: boolean; message: string }[] = [];
    if (runtime.manifest) {
      const child = new Deno.Command(runtime.engineExecutable, {
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const writer = child.stdin.getWriter();
      try {
        await writer.write(
          new TextEncoder().encode('{"version":1,"runtime_info":true}'),
        );
        await writer.close();
      } finally {
        writer.releaseLock();
      }
      const [stdout, stderr, status] = await Promise.all([
        bounded(runtime.engineExecutable, child.stdout),
        bounded(runtime.engineExecutable, child.stderr),
        child.status,
      ]);
      signal.throwIfAborted();
      if (!status.success) {
        throw new Error(
          `Native runtime handshake failed: ${
            new TextDecoder().decode(stderr)
          }`,
        );
      }
      validateRuntimeHandshake(
        new TextDecoder().decode(stdout),
        runtime.manifest,
      );
      checks.push({
        id: "native-handshake",
        ok: true,
        message: "Native egglog bridge identity matches the manifest.",
      });
    } else {
      checks.push({
        id: "native-engine",
        ok: true,
        message: "Source checkout native engine is available.",
      });
    }
    if (runtime.typescriptExecutable) {
      const tsStat = await Deno.stat(runtime.typescriptExecutable);
      if (!tsStat.isFile) {
        throw new Error("TypeScript runtime executable is missing.");
      }
    }
    temporary = await Deno.makeTempDir({ prefix: "sigil-doctor-" });
    await Deno.writeTextFile(
      join(temporary, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "es2020" },
        files: ["fixture.ts"],
      }),
    );
    await Deno.writeTextFile(
      join(temporary, "fixture.ts"),
      'export function answer(value: string): string { return value; }\nanswer("ok");\n',
    );
    const { analyzeTypeScript7 } = await import("./typescript7.ts");
    const analysis = await analyzeTypeScript7({
      root: temporary,
      project: "tsconfig.json",
      signal,
      ...(runtime.root ? { runtimeDirectory: runtime.root } : {}),
    });
    if (
      analysis.diagnostics.length > 0 ||
      !analysis.calls.some((call) => call.expression === "answer")
    ) {
      throw new Error(
        "TypeScript runtime could not resolve the doctor fixture.",
      );
    }
    checks.push({
      id: "typescript-runtime",
      ok: true,
      message: `TypeScript ${
        runtime.manifest?.typescriptVersion ?? "7.0.2"
      } runtime resolved a direct call and standard types.`,
    });
    return {
      version: 1,
      ok: checks.every((check) => check.ok),
      mode: runtime.mode,
      target: runtime.manifest?.target ?? `${Deno.build.arch}-${Deno.build.os}`,
      sigilVersion: runtime.manifest?.sigilVersion ?? options.sigilVersion ??
        "0.7.1",
      kernelFingerprint: runtime.manifest?.kernelFingerprint,
      typescriptVersion: runtime.manifest?.typescriptVersion ?? "7.0.2",
      checks,
    };
  } finally {
    clearTimeout(timer);
    if (temporary) {
      await Deno.remove(temporary, { recursive: true }).catch(() => {});
    }
  }
}

async function bounded(
  _identity: string,
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > 1024 * 1024) {
      throw new Error("Runtime doctor output exceeds 1 MiB.");
    }
    chunks.push(next.value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
