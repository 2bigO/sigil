import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  loadSigilWorkspace,
  resolveSigilWorkspace,
  type SigilFileSystem,
} from "@qoherent/sigil-core";
import {
  createSemanticComponentRegistry,
  parseSemanticWorld,
  projectSigilIntent,
  semanticComponentId,
} from "../src/mod.ts";

const fs: SigilFileSystem = {
  readTextFile: (path) => Deno.readTextFile(path),
  async exists(path) {
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  },
  async listFiles(root) {
    const files: string[] = [];
    async function visit(path: string): Promise<void> {
      for await (const entry of Deno.readDir(path)) {
        const child = `${path}/${entry.name}`;
        if (entry.isDirectory) await visit(child);
        else if (entry.isFile) files.push(child);
      }
    }
    await visit(root);
    return files.sort();
  },
};

async function fixture(): Promise<{
  root: string;
  resolved: ReturnType<typeof resolveSigilWorkspace>;
  source: Awaited<ReturnType<typeof projectSigilIntent>>;
}> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/.sigil`);
  await Deno.writeTextFile(
    `${root}/.sigil/config.json`,
    JSON.stringify({
      sigilVersion: "0.7.0",
      workspace: { name: "registry", members: [] },
      files: { include: ["**/*.sigil"], exclude: [] },
      tools: {},
    }),
  );
  await Deno.writeTextFile(
    `${root}/main.sigil`,
    `component Bridge {\n  goal {\n    Route work.\n  }\n}\n`,
  );
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: root }),
  );
  const source = await projectSigilIntent(
    resolved.components,
    root,
    resolved.imports,
  );
  return { root, resolved, source };
}

Deno.test("registry preserves canonical bindings and resolves every exact alias", async () => {
  const { root, resolved, source } = await fixture();
  try {
    const structural = semanticComponentId(resolved.components[0], root);
    const canonical = "urn:canonical:bridge";
    const world = await parseSemanticWorld([{
      sourceId: "accepted",
      turtle:
        `@prefix s: <https://sigil.dev/ontology/1#> . <${structural}> a s:Component . <${canonical}> a s:Component; s:label "Stable Bridge" .`,
    }]);
    const registry = await createSemanticComponentRegistry({
      root,
      resolved,
      world,
      bindings: source.bindings,
      componentBindings: { [structural]: canonical },
    });
    assertEquals(registry.entries.length, 1);
    const entry = registry.entries[0];
    assertEquals(entry.entity, canonical);
    assertEquals(entry.authored?.name, "Bridge");
    assertEquals(registry.resolve(canonical)[0], entry);
    assertEquals(registry.resolve("Bridge")[0], entry);
    assertEquals(registry.resolve("Stable Bridge")[0], entry);
    assertEquals(registry.entitiesFor([resolved.components[0]]), [canonical]);
    assert(entry.projectedName.startsWith("Stable_Bridge_"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry rejects invalid and duplicate canonical bindings", async () => {
  const { root, resolved, source } = await fixture();
  try {
    const structural = semanticComponentId(resolved.components[0], root);
    const world = await parseSemanticWorld([{
      sourceId: "accepted",
      turtle:
        `@prefix s: <https://sigil.dev/ontology/1#> . <${structural}> a s:Component .`,
    }]);
    await assertRejects(
      () =>
        createSemanticComponentRegistry({
          root,
          resolved,
          world,
          bindings: source.bindings,
          componentBindings: { [structural]: "urn:not-a-component" },
        }),
      Error,
      "non-component",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
