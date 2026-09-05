import { assert, assertEquals, assertRejects } from "@std/assert";
import { compileSemanticWorld } from "../src/semantic/compile.ts";
import {
  parseSemanticWorld,
  SemanticInputError,
  serializeSemanticWorld,
} from "../src/semantic/turtle.ts";

const prefix =
  `@prefix s: <https://sigil.dev/ontology/1#> . @prefix : <urn:test:> .\n`;
const world = (turtle: string) =>
  parseSemanticWorld([{ sourceId: "test", turtle: prefix + turtle }]);

Deno.test("real egglog: parser fixture produces green, yellow, red with witnesses", async () => {
  for (const status of ["green", "yellow", "red"] as const) {
    const turtle = await Deno.readTextFile(
      new URL(`./fixtures/semantic/parser-${status}.ttl`, import.meta.url),
    );
    const compilation = await compileSemanticWorld(
      await parseSemanticWorld([{
        sourceId: status,
        turtle,
        producer: "model",
      }]),
    );
    assertEquals(compilation.status, status);
    if (status !== "green") {
      assert(compilation.diagnostics.every((d) => d.derivation.length > 0));
    }
    if (status === "green") {
      assert(
        compilation.closure.tables.known.some((row) =>
          row[0] === "urn:sigil:example:SigilParser" && row[1] === "provides" &&
          row[2] === "urn:sigil:example:DiagnosticConstruction"
        ),
      );
      assert(
        !compilation.world.facts.some((f) =>
          f.subject.value.endsWith("SigilParser") &&
          f.predicate.endsWith("provides") &&
          f.object.value.endsWith("DiagnosticConstruction")
        ),
      );
    }
  }
});

Deno.test("real egglog: transitive dependencies and missing ownership use closure", async () => {
  const result = await compileSemanticWorld(
    await world(
      `:A s:dependsOn :B . :B s:dependsOn :C . :S a s:State; s:required true .`,
    ),
  );
  assertEquals(result.status, "yellow");
  assert(
    result.closure.tables.reachable.some((row) =>
      row[0] === "urn:test:A" && row[1] === "urn:test:C"
    ),
  );
  const owned = await compileSemanticWorld(
    await world(`:S a s:State; s:required true . :A s:owns :S .`),
  );
  assertEquals(owned.status, "green");
});

Deno.test("real egglog: exclusivity, contradictions and hard budgets are red", async () => {
  for (
    const turtle of [
      `:S a s:State; s:exclusive true . :A s:owns :S . :B s:owns :S .`,
      `:A s:required true, false .`,
      `:A s:latencyMs 51; s:latencyBudgetMs 50 .`,
    ]
  ) {
    assertEquals(
      (await compileSemanticWorld(await world(turtle))).status,
      "red",
    );
  }
});

Deno.test("real egglog computes minimum path costs and maximum reachable risk", async () => {
  const result = await compileSemanticWorld(
    await world(`
    :AB a s:Dependency; s:from :A; s:to :B; s:cost 2 .
    :BC a s:Dependency; s:from :B; s:to :C; s:cost 3 .
    :AC a s:Dependency; s:from :A; s:to :C; s:cost 10 .
    :CA a s:Dependency; s:from :C; s:to :A; s:cost 1 .
    :A s:dependsOn :B; s:risk 0.1 . :B s:dependsOn :C . :C s:risk 0.7 .
  `),
  );
  assert(
    result.closure.tables["path-cost"].some((row) =>
      row[0] === "urn:test:A" && row[1] === "urn:test:C" && row[2] === 5
    ),
  );
  assert(
    result.closure.tables["risk-score"].some((row) =>
      row[0] === "urn:test:A" && row[1] === 0.7
    ),
  );
});

Deno.test("Turtle parser rejects invented ontology, graphs, triple terms and invalid literals", async () => {
  for (
    const turtle of [
      `:A s:qualityScore 0.99 .`,
      `:A a s:Invented .`,
      `:Graph { :A a s:Component . }`,
      `<<:A s:owns :B>> s:required true .`,
      `:A s:risk "NaN"^^<http://www.w3.org/2001/XMLSchema#double> .`,
      `:A s:required "yes"^^<http://www.w3.org/2001/XMLSchema#boolean> .`,
      `:A s:cost -1 .`,
      `:A s:cost 9007199254740993 .`,
    ]
  ) await assertRejects(() => world(turtle), SemanticInputError);
});

Deno.test("normalized Turtle is deterministic and preserves language and blank-node scope", async () => {
  const a = await world(
    `:A a s:Component; s:required true; s:label "chat"@fr .`,
  );
  const b = await world(
    `:A s:label "chat"@fr; s:required "1"^^<http://www.w3.org/2001/XMLSchema#boolean>; a s:Component .`,
  );
  assertEquals(a.fingerprint, b.fingerprint);
  const roundTrip = await parseSemanticWorld([{
    sourceId: "roundtrip",
    turtle: serializeSemanticWorld(a),
  }]);
  assertEquals(roundTrip.fingerprint, a.fingerprint);
  const scoped = await parseSemanticWorld([
    { sourceId: "one", turtle: prefix + `_:x a s:Component .` },
    { sourceId: "two", turtle: prefix + `_:x a s:Component .` },
  ]);
  assertEquals(scoped.facts.length, 2);
  assert(scoped.facts[0].subject.value !== scoped.facts[1].subject.value);
});

Deno.test("egglog receives escaped data and cannot execute a Turtle literal", async () => {
  const result = await compileSemanticWorld(
    await world(`:A s:description "\\\" ) (panic \\\"injected\\\")" .`),
  );
  assertEquals(result.status, "green");
});

Deno.test("operational failures cannot produce a green semantic report", async () => {
  const input = await world(`:A a s:Component .`);
  await assertRejects(() =>
    compileSemanticWorld(input, { signal: AbortSignal.abort() })
  );
  await assertRejects(
    async () =>
      compileSemanticWorld(await world(`:A a s:Component .`), {
        binaryPath: "/no-such-sigil-engine",
      }),
    Error,
    "Cannot start",
  );
});

Deno.test("anonymous RDF entities keep document identity after repeated parses and persistence", async () => {
  const turtle =
    `:A s:owns [ a s:State; s:required true ] . _:named a s:Capability .`;
  const first = await world(turtle);
  assertEquals((await world(turtle)).fingerprint, first.fingerprint);
  const restored = await parseSemanticWorld([{
    sourceId: "saved-world",
    turtle: serializeSemanticWorld(first),
  }]);
  assertEquals(restored.fingerprint, first.fingerprint);
  assertEquals((await compileSemanticWorld(restored)).status, "green");
  await assertRejects(() => world(`:A s:cost 1.0e308 .`), SemanticInputError);
});
