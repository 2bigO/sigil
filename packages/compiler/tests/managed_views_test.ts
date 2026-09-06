import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  matchesSigilFile,
  parseSigilDocument,
  SIGIL_VERSION,
} from "@qoherent/sigil-core";
import { compileSemanticWorld } from "../src/semantic/compile.ts";
import {
  inspectManagedViews,
  readManagedViewReceipt,
  viewReceiptFor,
  writeManagedViews,
} from "../src/semantic/views.ts";
import { renderManagedViewSet } from "../src/semantic/projections.ts";
import { digest, parseSemanticWorld } from "../src/semantic/turtle.ts";

const source =
  `@prefix s: <https://sigil.dev/ontology/1#> .\n@prefix : <urn:test:> .\n:A a s:Component; s:label "Display A"; s:description "Keep A stable." .\n:B a s:Component, s:System; s:label "Display B"; s:description "Keep B stable." .\n`;

Deno.test("managed renderer emits one hashed, parser-valid view per entity", async () => {
  const world = await parseSemanticWorld([{
    sourceId: "test",
    turtle: source,
  }]);
  const compilation = await compileSemanticWorld(world);
  assertEquals(compilation.status, "green");
  const first = await renderManagedViewSet(compilation);
  const second = await renderManagedViewSet(compilation);
  assertEquals(first, second);
  assertEquals(first.files.length, 2);
  for (const file of first.files) {
    assert(/^\.sigil\/views\/[a-f0-9]{64}\.sigil$/.test(file.path));
    assert(file.content.includes("Managed semantic view"));
    assert(file.content.endsWith("\n"));
    const parsed = parseSigilDocument(file.path, file.content, {
      sigilVersion: SIGIL_VERSION,
    });
    assertEquals(parsed.diagnostics.filter((d) => d.severity === "error"), []);
  }
});

Deno.test("managed view publication detects edits and preserves receipt authority", async () => {
  const root = await Deno.makeTempDir();
  const world = await parseSemanticWorld([{
    sourceId: "test",
    turtle: source,
  }]);
  const compilation = await compileSemanticWorld(world);
  const set = await renderManagedViewSet(compilation);
  const revision = await digest("accepted revision");
  const published = await writeManagedViews(root, set, revision);
  assertEquals((await readManagedViewReceipt(root))?.worldRevision, revision);
  assertEquals(
    (await inspectManagedViews(root, set, revision)).state,
    "current",
  );
  const edited = set.files[0].path;
  await Deno.writeTextFile(`${root}/${edited}`, "edited\n");
  assertEquals(
    (await inspectManagedViews(root, set, revision)).state,
    "edited",
  );
  await assertRejects(
    () => writeManagedViews(root, set, revision),
    Error,
    "edited",
  );
  assertEquals(published.receipt.files.length, 2);
  const config = {
    sigilVersion: SIGIL_VERSION,
    workspace: { name: "test", members: [] },
    files: { include: ["**/*.sigil"], exclude: [] },
    tools: {},
  };
  assert(!matchesSigilFile(edited, config));
});
