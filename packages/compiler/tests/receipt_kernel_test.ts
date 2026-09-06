import { assert, assertEquals } from "@std/assert";
import { compileSemanticWorld } from "../src/semantic/compile.ts";
import type {
  MechanicalReceiptClaim,
  SemanticEngineOptions,
} from "../src/semantic/engine.ts";
import { parseSemanticWorld } from "../src/semantic/turtle.ts";

async function setup(expected: boolean) {
  const world = await parseSemanticWorld([{
    sourceId: "test",
    turtle: `
@prefix s: <https://sigil.dev/ontology/1#> .
<urn:C> a s:Contract; s:required true; s:from <urn:A>; s:relation "dependsOn"; s:target <urn:B>; s:expected ${expected} .
${expected ? "<urn:A> s:dependsOn <urn:B> ." : ""}`,
  }]);
  const claim: MechanicalReceiptClaim = {
    receipt: "urn:R",
    obligation: "contract|urn:C",
    subject: "urn:A",
    predicate: "dependsOn",
    object: "urn:B",
    expected,
  };
  const options: SemanticEngineOptions = {
    focus: "implementation",
    receiptClaims: [claim],
    receiptLocations: [["urn:R", "caller"]],
    symbolOwners: [["caller", "urn:A"]],
  };
  return { world, options, claim };
}

Deno.test("egglog joins exact receipt location and independent evidence without changing unrelated coverage", async () => {
  const { world, options } = await setup(true);
  const observed = {
    subject: "urn:A",
    predicate: "dependsOn",
    object: "urn:B",
    evidence: "native-edge",
  };
  const compile = (extra: SemanticEngineOptions) =>
    compileSemanticWorld(world, { ...options, ...extra });
  const unsupported = await compile({});
  assertEquals(unsupported.status, "yellow");
  assertEquals(unsupported.closure.tables["receipt-result"], [[
    "urn:R",
    "contract|urn:C",
    "unresolved",
    "",
  ]]);
  const wrong = await compile({
    observations: [observed],
    scopedObservations: [[
      "another-function",
      "dependsOn",
      "urn:B",
      "native-edge",
    ]],
  });
  assertEquals(wrong.status, "green");
  assertEquals(wrong.closure.tables["receipt-result"][0][2], "unresolved");
  const supported = await compile({
    observations: [observed],
    scopedObservations: [["caller", "dependsOn", "urn:B", "native-edge"]],
  });
  assertEquals(supported.status, "green");
  assertEquals(supported.closure.tables["receipt-result"], [[
    "urn:R",
    "contract|urn:C",
    "supported",
    "native-edge",
  ]]);
  assert(
    supported.closure.tables.because.some((row) =>
      row[1] === "native-scoped-receipt" && row[3] === "native-edge"
    ),
  );
  const forged = await compile({
    scopedObservations: [["caller", "dependsOn", "urn:B", "claim-only"]],
  });
  assertEquals(forged.status, "yellow");
  assertEquals(forged.closure.tables["receipt-result"][0][2], "unresolved");
});

Deno.test("egglog evaluates receipt absence after closure and reports contradictions separately", async () => {
  const negative = await setup(false);
  const scope = {
    subject: "urn:A",
    predicate: "dependsOn",
    object: "urn:B",
    evidence: "complete",
  };
  const closed = await compileSemanticWorld(negative.world, {
    ...negative.options,
    completeScopes: [scope],
  });
  assertEquals(closed.status, "green");
  assertEquals(closed.closure.tables["receipt-result"][0][2], "supported");
  const wrongScope = await compileSemanticWorld(negative.world, {
    ...negative.options,
    completeScopes: [{ ...scope, object: "urn:Other" }],
  });
  assertEquals(wrongScope.status, "yellow");
  assertEquals(wrongScope.closure.tables["receipt-result"][0][2], "unresolved");
  const observed = { ...scope, evidence: "prohibited-edge" };
  const contradicted = await compileSemanticWorld(negative.world, {
    ...negative.options,
    observations: [observed],
    completeScopes: [scope],
  });
  assertEquals(contradicted.status, "red");
  assertEquals(contradicted.closure.tables["receipt-result"], [[
    "urn:R",
    "contract|urn:C",
    "contradicted",
    "prohibited-edge",
  ]]);
  const positive = await setup(true);
  const absent = await compileSemanticWorld(positive.world, {
    ...positive.options,
    completeScopes: [scope],
  });
  assertEquals(absent.status, "red");
  assertEquals(absent.closure.tables["receipt-result"][0][2], "contradicted");
});
