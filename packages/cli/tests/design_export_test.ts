import { assert, assertEquals } from "@std/assert";
import { SIGIL_VERSION } from "@qoherent/sigil-core";
import { runCli } from "../src/main.ts";
import { DenoSigilFileSystem } from "../src/fs-adapter.ts";
import { CoreAdapter } from "../src/core-adapter.ts";

async function workspace() {
  const root = await Deno.makeTempDir({ prefix: "sigil-export-" });
  await Deno.mkdir(`${root}/.sigil`);
  const config = JSON.stringify({
    sigilVersion: SIGIL_VERSION,
    workspace: { name: "export", members: [] },
    files: { include: ["**/*.sigil"], exclude: [] },
  });
  await Deno.writeTextFile(`${root}/.sigil/config.json`, config);
  const source =
    `component Exact {\n  goal {\n    Preserve ${root}/verbatim and café.\n  }\n  interface {\n    Text { Preserve captured text. }\n  }\n}\n`;
  await Deno.writeTextFile(`${root}/main.sigil`, source);
  return { root, source, config };
}

Deno.test("export emits the raw native bundle and preserves captured text without invoking a compiler", async () => {
  const { root, source, config } = await workspace();
  try {
    const result = await runCli(["export", "design", ".", "--pretty"], {
      core: new CoreAdapter({ currentDirectory: root }),
    });
    assertEquals(result.exitCode, 0, result.stdout);
    assertEquals(result.stderr, "");
    const bundle = JSON.parse(result.stdout);
    assertEquals(Object.keys(bundle).sort(), [
      "context",
      "diagnostics",
      "entities",
      "frontendVersion",
      "imports",
      "schemaVersion",
      "sources",
      "units",
    ]);
    assertEquals(bundle.schemaVersion, 1);
    assertEquals(bundle.sources, [{ path: "main.sigil", text: source }]);
    assertEquals(
      bundle.context.find((c: { path: string }) =>
        c.path === ".sigil/config.json"
      ).text,
      config,
    );
    assertEquals(
      bundle.context.find((c: { path: string }) =>
        c.path === ".sigil/local.json"
      ).text,
      null,
    );
    assert(bundle.units.length > 0);
    assertEquals(
      JSON.parse(
        (await runCli(["export", "design", "--root", root, "--format", "json"]))
          .stdout,
      ),
      bundle,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("export retains language errors in its bundle and never reports them as semantic success", async () => {
  const { root } = await workspace();
  try {
    await Deno.writeTextFile(
      `${root}/main.sigil`,
      "expand Missing { goal { Keep unknown meaning. } }",
    );
    const result = await runCli(["export", "design", root]);
    assertEquals(result.exitCode, 1);
    const bundle = JSON.parse(result.stdout);
    assert(
      bundle.diagnostics.some((d: { severity: string }) =>
        d.severity === "error"
      ),
    );
    assertEquals(bundle.sources[0].path, "main.sigil");
    assertEquals(bundle.world, undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("export rejects incomplete, lossy and compiler-specific invocations", async () => {
  for (
    const args of [
      ["export"],
      ["export", "implementation"],
      ["export", "design", "a", "b"],
      ["export", "design", "--quiet"],
      ["export", "design", "--format", "markdown"],
      ["export", "design", "--profile", "legacy"],
      ["export", "design", "--scope", "native.json"],
    ]
  ) {
    const result = await runCli(args);
    assertEquals(result.exitCode, 2, args.join(" "));
    assertEquals(result.stdout, "");
  }
  const help = await runCli(["export", "design", "--help"]);
  assertEquals(help.exitCode, 0);
  assert(help.stdout.includes("sigilc"));
});

Deno.test("host discovery preserves nested configs while excluding generated Sigil metadata", async () => {
  const { root, config } = await workspace();
  try {
    await Deno.mkdir(`${root}/nested/.sigil`, { recursive: true });
    await Deno.writeTextFile(`${root}/nested/.sigil/config.json`, config);
    for (const dir of ["worlds", "unrecognized-generated-tree"]) {
      await Deno.mkdir(`${root}/.sigil/${dir}`);
      await Deno.writeTextFile(
        `${root}/.sigil/${dir}/fake.sigil`,
        "not authored",
      );
    }
    const files = await new DenoSigilFileSystem().listFiles(root);
    assert(files.includes(`${root}/nested/.sigil/config.json`));
    assert(!files.some((p) => p.endsWith("fake.sigil")));
    const result = await runCli(["export", "design", root]);
    assertEquals(result.exitCode, 1);
    assert(
      JSON.parse(result.stdout).diagnostics.some((d: { code: string }) =>
        d.code === "SIGIL_NESTED_CONFIG"
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
