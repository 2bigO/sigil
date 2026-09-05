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

Deno.test("required prose needs an executable contract rather than a model verification flag", async () => {
  const prose =
    `:C a s:Constraint; s:required true; s:description "Calls cross the bridge" .`;
  assertEquals(
    (await compileSemanticWorld(await world(prose))).status,
    "yellow",
  );
  const explicit = await world(
    prose +
      `:C s:from :A; s:relation "invokes"; s:target :Bridge; s:expected true . :A s:invokes :Bridge .`,
  );
  const result = await compileSemanticWorld(explicit);
  assertEquals(result.status, "green");
  assert(
    result.closure.tables.coverage.some((row) =>
      row[0] === "contract|urn:test:C"
    ),
  );
  await assertRejects(
    () => world(prose + `:C s:interpreted true .`),
    SemanticInputError,
  );
  await assertRejects(
    () => world(prose + `:C s:relation "inventedPredicate" .`),
    SemanticInputError,
  );
});

Deno.test("opposed required contracts contradict without waiting for code observations", async () => {
  const result = await compileSemanticWorld(
    await world(`
    :Positive a s:Case; s:required true; s:from :A; s:relation "uses"; s:target :Disk; s:expected true .
    :Negative a s:Constraint; s:required true; s:from :A; s:relation "uses"; s:target :Disk; s:expected false .
  `),
  );
  assertEquals(result.status, "red");
  assert(
    result.diagnostics.some((d) =>
      d.code === "contradictory-contracts" && d.derivation.length > 2
    ),
  );
});

Deno.test("same egglog engine requires mechanical positive implementation evidence", async () => {
  const input = await world(`
    :C a s:Contract; s:required true; s:from :A; s:relation "invokes"; s:target :Bridge; s:expected true .
    :A s:invokes :Bridge . :Proposed a s:Evidence; s:evidenceFor :C; s:passes true .
  `);
  assertEquals((await compileSemanticWorld(input)).status, "green");
  assertEquals(
    (await compileSemanticWorld(input, { focus: "implementation" })).status,
    "yellow",
  );
  const observed = await compileSemanticWorld(input, {
    focus: "implementation",
    observations: [{
      subject: "urn:test:A",
      predicate: "invokes",
      object: "urn:test:Bridge",
      evidence: "tool:ast-call:bridge.ts:12",
    }],
  });
  assertEquals(observed.status, "green");
  assertEquals(observed.closure.tables["implementation-satisfied"], [[
    "contract|urn:test:C",
    "tool:ast-call:bridge.ts:12",
  ]]);
});

Deno.test("negative implementation obligations require complete scope and fail on observed violations", async () => {
  const input = await world(
    `:C a s:Constraint; s:required true; s:from :A; s:relation "writes"; s:target :Disk; s:expected false .`,
  );
  const focus = "implementation" as const;
  assertEquals((await compileSemanticWorld(input)).status, "green");
  assertEquals((await compileSemanticWorld(input, { focus })).status, "yellow");
  assertEquals(
    (await compileSemanticWorld(input, {
      focus,
      completeScopes: [{
        subject: "urn:test:Other",
        predicate: "writes",
        evidence: "tool:unrelated",
      }],
    })).status,
    "yellow",
  );
  const completeScopes = [{
    subject: "urn:test:A",
    predicate: "writes",
    evidence: "tool:complete-static-scope",
  }];
  assertEquals(
    (await compileSemanticWorld(input, { focus, completeScopes })).status,
    "green",
  );
  const violated = await compileSemanticWorld(input, {
    focus,
    completeScopes,
    observations: [{
      subject: "urn:test:A",
      predicate: "writes",
      object: "urn:test:Disk",
      evidence: "tool:write-call",
    }],
  });
  assertEquals(violated.status, "red");
  assert(
    violated.diagnostics.some((d) => d.code === "implementation-prohibition"),
  );
});

Deno.test("a matching alternative cannot hide an invalid multi-valued contract", async () => {
  const base =
    `:C a s:Contract; s:required true; s:from :A; s:relation "invokes"; s:target :B; s:expected true .
:A s:invokes :B .`;
  for (
    const extra of [
      ":C s:from :Other .",
      ":C s:target :Missing .",
      ':C s:relation "reads" .',
    ]
  ) {
    const result = await compileSemanticWorld(await world(`${base}\n${extra}`));
    assertEquals(result.status, "red");
    const diagnostic = result.diagnostics.find((d) =>
      d.code === "conflicting-contract-shape"
    );
    assert(
      diagnostic?.derivation.some((row) =>
        String(row[1]).startsWith("single-contract-")
      ),
    );
  }
  const cost = await compileSemanticWorld(
    await world(":A s:latencyMs 5, 10 ."),
  );
  assertEquals(cost.status, "red");
  assert(cost.diagnostics.some((d) => d.code === "conflicting-number"));
  const dependency = await compileSemanticWorld(
    await world(":D a s:Dependency; s:from :A, :B; s:to :C; s:cost 2 ."),
  );
  assertEquals(dependency.status, "red");
  assert(
    dependency.diagnostics.some((d) =>
      d.code === "conflicting-dependency-shape"
    ),
  );
});
