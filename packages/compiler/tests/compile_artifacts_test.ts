import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  artifactJson,
  initializeCompileArtifacts,
  readCompileArtifact,
  writeCompileArtifact,
} from "../src/semantic/artifacts.ts";
import { parseEggWorld, serializeEggWorld } from "../src/semantic/egg-world.ts";
import {
  readSemanticState,
  writeSemanticState,
} from "../src/semantic/store.ts";
import {
  digest,
  parseSemanticWorld,
  serializeSemanticWorld,
} from "../src/semantic/turtle.ts";

Deno.test("native egglog assertions preserve canonical RDF identities without executing rules", async () => {
  const world = await parseSemanticWorld([{
    sourceId: "mixed",
    turtle: `
@prefix s: <https://sigil.dev/ontology/1#> .
@prefix x: <http://www.w3.org/2001/XMLSchema#> .
[] a s:Component; s:label "Bridge"@en, "Pont"@fr; s:cost "1.00"^^x:decimal; s:required true;
 s:description "escaped \\"quotes\\" and \\\\ slash" .`,
  }]);
  const encoded = serializeEggWorld(world);
  const restored = await parseEggWorld(encoded);
  assertEquals(restored.fingerprint, world.fingerprint);
  assertEquals(restored.facts, world.facts);
  assertEquals(serializeEggWorld(restored), encoded);
  assertEquals(
    (await parseSemanticWorld([{
      sourceId: "export",
      turtle: serializeSemanticWorld(restored),
    }])).fingerprint,
    world.fingerprint,
  );
  for (
    const source of [
      '(include "missing.egg")',
      "(run 100)",
      '(rule () ((assert-iri "a" "b" "c")))',
      '(assert-iri "a" "b" (+ "c" "d"))',
      '(observation "a" "b" "c" "e")',
      '(assert-literal "urn:a" "https://sigil.dev/ontology/1#label" "word" "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString" "")',
      '(assert-iri "urn:a" "urn:invented" "urn:b")',
    ]
  ) await assertRejects(() => parseEggWorld(source));
});

Deno.test("content-addressed artifacts reuse completed stages and detect dependency changes and corruption", async () => {
  const root = await Deno.makeTempDir();
  try {
    const world = await digest("world");
    const input = {
      kind: "cache" as const,
      dependencies: { world },
      files: { "closure.json": "{}\n" },
      metadata: { stage: "semantic-closure" },
    };
    const [a, b] = await Promise.all([
      writeCompileArtifact(root, input),
      writeCompileArtifact(root, input),
    ]);
    assertEquals(a.id, b.id);
    assertEquals(await readCompileArtifact(root, "cache", a.id), a);
    const changed = await writeCompileArtifact(root, {
      ...input,
      dependencies: { world: await digest("changed") },
    });
    assert(changed.id !== a.id);
    await Deno.writeTextFile(
      `${root}/.sigil/cache/${a.id}/closure.json`,
      '{"forged":"green"}',
    );
    await assertRejects(
      () => readCompileArtifact(root, "cache", a.id),
      Error,
      "hash",
    );
    await assertRejects(() => writeCompileArtifact(root, input), Error, "hash");
    await assertRejects(() =>
      writeCompileArtifact(root, { ...input, files: { "../escape": "bad" } })
    );
    const receipt = await writeCompileArtifact(root, {
      kind: "receipts",
      dependencies: { world },
      files: { "claims.ttl": "# claim data\n" },
    });
    assertEquals(receipt.manifest.kind, "receipts");
    assertEquals(Object.keys(receipt), ["id", "manifest", "files"]);
    const temporary = [];
    for await (const entry of Deno.readDir(`${root}/.sigil/cache/tmp`)) {
      temporary.push(entry.name);
    }
    assertEquals(temporary, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("artifact initialization preserves ignore rules and leaves accepted world trackable", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/.sigil`);
    await Deno.writeTextFile(`${root}/.sigil/.gitignore`, "/local.json\n");
    await initializeCompileArtifacts(root);
    const text = await Deno.readTextFile(`${root}/.sigil/.gitignore`);
    await initializeCompileArtifacts(root);
    assertEquals(await Deno.readTextFile(`${root}/.sigil/.gitignore`), text);
    assert(text.startsWith("/local.json\n"));
    const init = await new Deno.Command("git", { args: ["init", "-q", root] })
      .output();
    assert(init.success);
    const ignored = await new Deno.Command("git", {
      cwd: root,
      args: [
        "check-ignore",
        ".sigil/receipts/a/claims.ttl",
        ".sigil/cache/a/closure.json",
        ".sigil/runs/a/report.json",
        ".sigil/handoffs/a/slice.egg",
        ".sigil/world/current.json",
        ".sigil/implementation.json",
      ],
    }).output();
    assertEquals(new TextDecoder().decode(ignored.stdout).trim().split("\n"), [
      ".sigil/receipts/a/claims.ttl",
      ".sigil/cache/a/closure.json",
      ".sigil/runs/a/report.json",
      ".sigil/handoffs/a/slice.egg",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("legacy canonical state migrates on acceptance and concurrent stale writers cannot overwrite revisions", async () => {
  const root = await Deno.makeTempDir();
  try {
    const world = await parseSemanticWorld([]);
    const receipt = {
      version: 1 as const,
      worldFingerprint: world.fingerprint,
      sourceFingerprint: world.fingerprint,
      componentBindings: {},
    };
    await Deno.mkdir(`${root}/.sigil/worlds`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.sigil/worlds/${world.fingerprint}.ttl`,
      serializeSemanticWorld(world),
    );
    await Deno.writeTextFile(
      `${root}/.sigil/semantic.json`,
      artifactJson(receipt),
    );
    const old = await readSemanticState(root);
    assert(old);
    const outcomes = await Promise.allSettled(
      ["urn:a", "urn:b"].map((entity) =>
        writeSemanticState(root, {
          world,
          receipt: { ...receipt, componentBindings: { a: entity } },
        }, old.revision)
      ),
    );
    assertEquals(outcomes.map((item) => item.status).sort(), [
      "fulfilled",
      "rejected",
    ]);
    const stored = await readSemanticState(root);
    assert(stored && stored.revision !== old.revision);
    assert(
      await Deno.stat(`${root}/.sigil/world/${stored.revision}/assertions.egg`),
    );
    await Deno.writeTextFile(
      `${root}/.sigil/semantic.json`,
      "bad legacy state",
    );
    assertEquals((await readSemanticState(root))?.revision, stored.revision);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
