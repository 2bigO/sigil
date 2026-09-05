import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  parseSigilDocument,
  type ResolvedComponent,
  SIGIL_VERSION,
} from "@qoherent/sigil-core";
import { compileSemanticWorld } from "../src/semantic/compile.ts";
import {
  implementationSlice,
  projectGreenSemanticWorld,
  renderImplementationSlice,
} from "../src/semantic/projections.ts";
import { projectSigilIntent } from "../src/semantic/source.ts";
import {
  parseSemanticWorld,
  SemanticInputError,
} from "../src/semantic/turtle.ts";

const prefix =
  `@prefix s: <https://sigil.dev/ontology/1#> . @prefix : <urn:test:> .\n`;
const world = (turtle: string) =>
  parseSemanticWorld([{ sourceId: "test", turtle: prefix + turtle }]);

Deno.test("green semantics project valid Sigil and focused implementation slices", async () => {
  const compilation = await compileSemanticWorld(
    await world(`
    :Bridge a s:Component; s:label "SemanticBridge"; s:provides :Compile; s:delegates :Installed; s:excludes :History; s:routesThrough :Installed .
    :Installed a s:Component; s:provides :Compile . :Compile a s:Capability .
    :Unrelated a s:Component; s:provides :UnrelatedFeature .
    :C a s:Constraint; s:required true; s:from :Bridge; s:relation "uses"; s:target :History; s:expected false; s:description "Do not persist session history" .
  `),
  );
  const projection = projectGreenSemanticWorld(compilation);
  const parsed = parseSigilDocument("projection.sigil", projection.sigil, {
    sigilVersion: SIGIL_VERSION,
  });
  assertEquals(parsed.diagnostics.filter((d) => d.severity === "error"), []);
  assertEquals(
    (await parseSemanticWorld([{
      sourceId: "saved",
      turtle: projection.turtle,
    }])).fingerprint,
    compilation.world.fingerprint,
  );
  const slice = implementationSlice(compilation, "urn:test:Bridge");
  assertEquals(slice.workUnit, "SemanticBridge");
  assertEquals(slice.mustProvide, ["Compile"]);
  assertEquals(slice.mustDelegate, ["Installed"]);
  assertEquals(slice.mustNot, ["History"]);
  assert(slice.relatedContracts.includes("urn:test:C"));
  const rendered = renderImplementationSlice(slice);
  assert(!rendered.includes("Unrelated"));
  assert(!rendered.includes("@prefix"));
  assert(rendered.includes("OBLIGATIONS"));
  assertEquals(projectGreenSemanticWorld(compilation).sigil, projection.sigil);
});

Deno.test("projection preserves literal text without Sigil syntax injection", async () => {
  const text = "Close } component Injected { interface { }\n```\n" +
    "x".repeat(100);
  const compilation = await compileSemanticWorld(
    await world(`:A a s:Component; s:description ${JSON.stringify(text)} .`),
  );
  const projection = projectGreenSemanticWorld(compilation);
  const parsed = parseSigilDocument("projection.sigil", projection.sigil, {
    sigilVersion: SIGIL_VERSION,
  });
  assertEquals(parsed.document.components.length, 1);
  assertEquals(parsed.diagnostics.filter((d) => d.severity === "error"), []);
  assert(
    parsed.document.components[0].sections[0].units.some((u) =>
      u.literalBlocks.some((b) => b.body === text)
    ),
  );
});

Deno.test("yellow specifications cannot produce implementation projections", async () => {
  const compilation = await compileSemanticWorld(
    await world(`:A a s:Component; s:requires :Missing .`),
  );
  assertThrows(
    () => projectGreenSemanticWorld(compilation),
    SemanticInputError,
    "green",
  );
  assertThrows(
    () => implementationSlice(compilation, "urn:test:A"),
    SemanticInputError,
    "green",
  );
});

Deno.test("existing Sigil extraction preserves source bindings and leaves prose unresolved", async () => {
  const source = await Deno.readTextFile(
    new URL("../../core/src/parser.sigil", import.meta.url),
  );
  const parsed = parseSigilDocument("packages/core/src/parser.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  const component: ResolvedComponent = {
    name: "SigilParser",
    filePath: "packages/core/src/parser.sigil",
    declaration: parsed.document.components[0],
    expansions: {
      componentName: "SigilParser",
      expands: parsed.document.expands.map((declaration) => ({
        filePath: "packages/core/src/parser.sigil",
        declaration,
      })),
    },
    conceptNamespace: {
      componentName: "SigilParser",
      concepts: [],
      accessibleConcepts: [],
      publicConcepts: [],
      references: [],
    },
  };
  const intent = await projectSigilIntent([component], ".");
  const compilation = await compileSemanticWorld(intent.world);
  assertEquals(compilation.status, "yellow");
  const units = [...parsed.document.components, ...parsed.document.expands]
    .flatMap((form) => form.sections.flatMap((section) => section.units));
  assertEquals(compilation.closure.tables.unresolved.length, units.length);
  assertEquals(
    Object.values(intent.bindings).filter((b) => b.unit).length,
    units.length,
  );
  assert(
    Object.values(intent.bindings).some((b) =>
      b.concept === "SourceDocumentParsing" && b.range.start.line > 1
    ),
  );
});
