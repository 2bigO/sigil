import { assert, assertEquals } from "@std/assert";
import {
  parseSemanticWorld,
  type SemanticWorld,
  serializeSemanticWorld,
} from "../src/semantic/turtle.ts";
import { withCompileArtifactLock } from "../src/semantic/artifacts.ts";
import { readWorldBeam, writeWorldBeam } from "../src/semantic/beam-store.ts";
import type { WorldBeamCheckpoint } from "../src/semantic/beam.ts";

function checkpoint(
  base: SemanticWorld,
  id = "candidate",
): WorldBeamCheckpoint {
  return {
    version: 1,
    kernelVersion: "1",
    base: {
      fingerprint: base.fingerprint,
      turtle: serializeSemanticWorld(base),
    },
    candidates: [{
      id,
      patch: {
        baseFingerprint: base.fingerprint,
        additions: "",
        retractions: "",
      },
    }],
    mutableFactIds: [],
    answers: [],
  };
}

Deno.test("beam publication uses permanent locks and compare-and-swap", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-beam-" });
  try {
    const base = await parseSemanticWorld([]);
    const first = await writeWorldBeam(root, "choice", checkpoint(base));
    assertEquals(
      (await readWorldBeam(root, "choice"))?.revision,
      first.revision,
    );
    await Deno.mkdir(`${root}/.sigil/beams/choice.json.lock`, {
      recursive: true,
    });
    const next = await writeWorldBeam(
      root,
      "choice",
      checkpoint(base),
      first.revision,
    );
    assert(next.revision);
    const outcomes = await Promise.allSettled([
      writeWorldBeam(root, "choice", checkpoint(base, "a"), next.revision),
      writeWorldBeam(root, "choice", checkpoint(base, "b"), next.revision),
    ]);
    assertEquals(
      outcomes.filter((item) => item.status === "fulfilled").length,
      1,
    );
    assertEquals(
      outcomes.filter((item) => item.status === "rejected").length,
      1,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("artifact lock contention observes cancellation and orphan files", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-lock-" });
  const release = Promise.withResolvers<void>();
  try {
    const held = withCompileArtifactLock(
      root,
      "held",
      async () => release.promise,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assertRejects(
      () =>
        withCompileArtifactLock(root, "held", async () => {}, {
          timeoutMs: 50,
        }),
      "ARTIFACT_LOCK_TIMEOUT",
    );
    release.resolve();
    await held;
    await Deno.mkdir(`${root}/.sigil/beams`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.sigil/beams/choice.json.orphan.tmp`,
      "partial",
    );
    assertEquals(await readWorldBeam(root, "choice"), undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function assertRejects(
  operation: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(
      String(error).includes(message) ||
        error && typeof error === "object" && "code" in error &&
          (error as { code?: string }).code === message,
      `expected ${message}, got ${error}`,
    );
    return;
  }
  throw new Error(`expected rejection containing ${message}`);
}
