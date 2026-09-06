import { assertEquals, assertRejects } from "@std/assert";
import { runImplementationChecks } from "../src/semantic/checks.ts";
import { captureImplementationSnapshot } from "../src/semantic/implementation-workspace.ts";
import { AdapterFailure } from "../src/adapter-execution-coordinator.ts";

Deno.test("host checks bound timeout, cancellation and output without certifying incomplete execution", async () => {
  const root = await Deno.makeTempDir();
  try {
    const snapshot = await captureImplementationSnapshot(root);
    const run = (code: string, options = {}) =>
      runImplementationChecks(
        root,
        [{
          id: "bounded",
          command: Deno.execPath(),
          args: ["eval", code],
          files: [],
        }],
        snapshot.fingerprint,
        { snapshot, ...options },
      );
    const timeout = await assertRejects(
      () => run("setInterval(() => {}, 1000)", { timeoutMs: 200 }),
      AdapterFailure,
    );
    assertEquals(timeout.kind, "elapsed-time");
    const controller = new AbortController();
    const pending = run("setInterval(() => {}, 1000)", {
      signal: controller.signal,
    });
    const timer = setTimeout(() => controller.abort(), 200);
    try {
      const cancelled = await assertRejects(() => pending, AdapterFailure);
      assertEquals(cancelled.kind, "cancelled");
    } finally {
      clearTimeout(timer);
    }
    const output = await assertRejects(
      () => run('console.log("x".repeat(1024 * 1024 + 1))'),
      AdapterFailure,
    );
    assertEquals(output.kind, "operational-limit");
    await assertRejects(
      () => runImplementationChecks(root, [], "invented", { snapshot }),
      Error,
      "fingerprint",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("checks preserve input bytes and modes and each receives a fresh snapshot", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${root}/input.txt`, "original");
    const snapshot = await captureImplementationSnapshot(root);
    const command = (id: string, code: string) => ({
      id,
      command: Deno.execPath(),
      args: ["eval", code],
      files: ["input.txt"],
    });
    await assertRejects(
      () =>
        runImplementationChecks(
          root,
          [command(
            "mutate",
            'await Deno.writeTextFile("input.txt", "changed")',
          )],
          snapshot.fingerprint,
          { snapshot },
        ),
      Error,
      "Verification input changed",
    );
    assertEquals(await Deno.readTextFile(`${root}/input.txt`), "original");
    if (Deno.build.os !== "windows") {
      await assertRejects(
        () =>
          runImplementationChecks(
            root,
            [command("mode", 'await Deno.chmod("input.txt", 0o755)')],
            snapshot.fingerprint,
            { snapshot },
          ),
        Error,
        "Verification input changed",
      );
    }
    const result = await runImplementationChecks(
      root,
      [
        command(
          "generate",
          'await Deno.writeTextFile("generated.txt", "output")',
        ),
        command(
          "fresh",
          'try { await Deno.readFile("generated.txt"); Deno.exit(8); } catch(e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }',
        ),
      ],
      snapshot.fingerprint,
      { snapshot },
    );
    assertEquals(result.checks.map((check) => check.passed), [true, true]);
    await assertRejects(
      () => Deno.stat(`${root}/generated.txt`),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
