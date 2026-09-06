import { assert, assertEquals, assertRejects } from "@std/assert";
import { verifyImplementationWorld } from "../src/semantic/verification.ts";
import { parseSemanticWorld } from "../src/semantic/turtle.ts";
import { writeSemanticState } from "../src/semantic/store.ts";
import { AdapterFailure } from "../src/adapter-execution-coordinator.ts";

async function fixture() {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(`${root}/app.ts`, "export const value = 1;");
  await Deno.writeTextFile(`${root}/oracle.ts`, "// host-selected check input");
  await Deno.writeTextFile(
    `${root}/tsconfig.json`,
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true },
      files: ["app.ts"],
    }),
  );
  const world = await parseSemanticWorld([]);
  await writeSemanticState(root, {
    world,
    receipt: {
      version: 1,
      worldFingerprint: world.fingerprint,
      sourceFingerprint: world.fingerprint,
      componentBindings: {},
    },
  });
  const verify = (script: string, timeoutMs = 10_000) =>
    verifyImplementationWorld({
      root,
      world,
      timeoutMs,
      policy: {
        version: 1,
        project: "tsconfig.json",
        components: [],
        targets: [],
        checks: [{
          id: "host",
          command: Deno.execPath(),
          args: ["eval", script],
          files: ["oracle.ts"],
        }],
      },
    });
  return { root, verify };
}

Deno.test("shared verification rejects source or canonical changes made during a passing check", async () => {
  for (const kind of ["source", "canonical"]) {
    const { root, verify } = await fixture();
    try {
      const path = kind === "source"
        ? `${root}/app.ts`
        : `${root}/.sigil/world/current.json`;
      const contents = kind === "source"
        ? "export const value = 2;"
        : JSON.stringify({ version: 1, revision: "f".repeat(64) });
      await assertRejects(() =>
        verify(
          `await Deno.writeTextFile(${JSON.stringify(path)},${
            JSON.stringify(contents)
          });`,
        )
      );
      const stages = [];
      for await (const entry of Deno.readDir(`${root}/.sigil/cache`)) {
        if (!/^[a-f0-9]{64}$/.test(entry.name)) continue;
        const manifest = JSON.parse(
          await Deno.readTextFile(
            `${root}/.sigil/cache/${entry.name}/manifest.json`,
          ),
        );
        stages.push(manifest.metadata.stage);
      }
      assert(stages.includes("native-evidence"));
      assert(stages.includes("command-check"));
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("whole verification timeout includes analysis and commands and returns no partial verdict", async () => {
  const { root, verify } = await fixture();
  try {
    const before = performance.now();
    const error = await assertRejects(
      () => verify("await new Promise(r=>setTimeout(r,2000));", 400),
      Error,
    );
    assert(
      error.name === "TimeoutError" ||
        error instanceof AdapterFailure && error.kind === "elapsed-time",
    );
    assert(performance.now() - before < 1500);
    const complete = await verify("console.log('checked');");
    assertEquals(complete.compilation.status, "green");
    assertEquals(complete.commands.checks[0].passed, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
