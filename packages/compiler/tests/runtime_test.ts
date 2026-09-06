import { assert, assertEquals, assertThrows } from "@std/assert";
import { resolveSemanticRuntime } from "../src/semantic/runtime.ts";
import { validateRuntimeManifest } from "../src/semantic/runtime-protocol.ts";

async function hash(source: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
    ),
  ].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.test("runtime manifest resolution validates every staged payload", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-runtime-" });
  try {
    await Deno.mkdir(`${root}/egglog`, { recursive: true });
    await Deno.mkdir(`${root}/typescript`, { recursive: true });
    await Deno.writeTextFile(`${root}/egglog/sigil-semantic-engine`, "engine");
    await Deno.writeTextFile(`${root}/typescript/tsc`, "tsc");
    const files = [
      ["egglog/sigil-semantic-engine", "engine", true],
      ["typescript/tsc", "tsc", true],
    ] as const;
    const manifest = {
      version: 1,
      sigilVersion: "0.7.1",
      target: "x86_64-unknown-linux-gnu",
      engineProtocolVersion: 1,
      kernelFingerprint: "a".repeat(64),
      typescriptVersion: "7.0.2",
      typescriptExtractorVersion: 3,
      egglogPath: "egglog/sigil-semantic-engine",
      typescriptPath: "typescript/tsc",
      files: await Promise.all(
        files.map(async ([path, source, executable]) => ({
          path,
          sha256: await hash(source),
          executable,
        })),
      ),
    } as const;
    validateRuntimeManifest(manifest);
    await Deno.writeTextFile(
      `${root}/manifest.json`,
      `${JSON.stringify(manifest)}\n`,
    );
    const runtime = await resolveSemanticRuntime({
      runtimeDirectory: root,
      sigilVersion: "0.7.1",
    });
    assertEquals(runtime.mode, "explicit");
    assert(runtime.typescriptExecutable?.endsWith("typescript/tsc"));
    await Deno.writeTextFile(`${root}/typescript/tsc`, "changed");
    await assertRejects(() =>
      resolveSemanticRuntime({ runtimeDirectory: root, sigilVersion: "0.7.1" })
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runtime manifests reject unsafe and duplicate files", () => {
  assertThrows(() =>
    validateRuntimeManifest({
      version: 1,
      sigilVersion: "0.7.1",
      target: "x86_64-unknown-linux-gnu",
      engineProtocolVersion: 1,
      kernelFingerprint: "a".repeat(64),
      typescriptVersion: "7.0.2",
      typescriptExtractorVersion: 3,
      egglogPath: "../engine",
      typescriptPath: "typescript/tsc",
      files: [],
    })
  );
});

async function assertRejects(operation: () => Promise<unknown>): Promise<void> {
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  }
  assert(rejected, "expected operation to reject");
}
