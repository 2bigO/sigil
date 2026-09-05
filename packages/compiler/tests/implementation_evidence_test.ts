import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { compileSemanticWorld } from "../src/semantic/compile.ts";
import {
  collectImplementationEvidence,
  type ImplementationPolicy,
  parseImplementationPolicy,
} from "../src/semantic/evidence.ts";
import {
  parseSemanticWorld,
  serializeSemanticWorld,
} from "../src/semantic/turtle.ts";

async function fixture(app: string, files: Record<string, string> = {}) {
  const root = await Deno.makeTempDir({ prefix: "sigil-evidence-test-" });
  await Deno.writeTextFile(
    `${root}/tsconfig.json`,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "nodenext",
        target: "es2022",
        allowImportingTsExtensions: true,
      },
      files: ["app.ts", ...Object.keys(files)],
    }),
  );
  await Deno.writeTextFile(`${root}/app.ts`, app);
  for (const [path, text] of Object.entries(files)) {
    await Deno.writeTextFile(`${root}/${path}`, text);
  }
  return root;
}
const policy: ImplementationPolicy = {
  version: 1,
  project: "tsconfig.json",
  components: [{ entity: "urn:test:A", files: ["app.ts"], exhaustive: true }],
  targets: [{
    entity: "urn:test:B",
    declarations: [{ file: "bridge.ts", symbol: "bridge" }],
  }],
};
function design(relation = "invokes", expected = true) {
  return parseSemanticWorld([{
    sourceId: "test-design",
    turtle: `
@prefix s: <https://sigil.dev/ontology/1#> .
<urn:test:C> a s:Contract; s:required true; s:from <urn:test:A>;
 s:relation "${relation}"; s:target <urn:test:B>; s:expected ${expected} .
${expected ? `<urn:test:A> s:${relation} <urn:test:B> .` : ""}`,
  }]);
}

Deno.test("real native evidence closes call obligations with source receipts and preserves RDF trust", async () => {
  const root = await fixture(
    'import {bridge as delegate} from "./bridge.ts"; export const value = delegate(5);',
    {
      "bridge.ts":
        "export function bridge(value: number): number { return value; }",
    },
  );
  try {
    const evidence = await collectImplementationEvidence({ root, policy });
    const call = evidence.observations.find((item) =>
      item.predicate === "invokes"
    );
    assert(call);
    assertEquals(call.object, "urn:test:B");
    assertEquals(evidence.analysis.calls[0].targetSymbol, "bridge");
    assertEquals(
      evidence.receipts[call.evidence].locations.map((location) =>
        location.file
      ),
      ["app.ts", "bridge.ts"],
    );
    assert(
      evidence.receipts[call.evidence].files.every((file) =>
        /^[a-f0-9]{64}$/.test(file.fingerprint)
      ),
    );
    const world = await design();
    assertEquals(
      (await compileSemanticWorld(world, {
        focus: "implementation",
        ...evidence,
      })).status,
      "green",
    );
    const roundtrip = await parseSemanticWorld([{
      sourceId: "receipt-file",
      turtle: serializeSemanticWorld(evidence.world),
    }]);
    assertEquals(roundtrip.fingerprint, evidence.world.fingerprint);
    assertEquals(
      (await compileSemanticWorld(world, { focus: "implementation" })).status,
      "yellow",
    );
    // Documentary Evidence passing remains untrusted if fed back as assertions.
    const proposed = await parseSemanticWorld([{
      sourceId: "proposed",
      turtle: serializeSemanticWorld(world) +
        serializeSemanticWorld(evidence.world),
    }]);
    assertEquals(
      (await compileSemanticWorld(proposed, { focus: "implementation" }))
        .status,
      "yellow",
    );
    await Deno.writeTextFile(`${root}/app.ts`, "export const value = 5;");
    const removed = await collectImplementationEvidence({ root, policy });
    assert(removed.inputFingerprint !== evidence.inputFingerprint);
    assertEquals(
      (await compileSemanticWorld(world, {
        focus: "implementation",
        ...removed,
      })).status,
      "yellow",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("negative dependency coverage needs a complete closed inventory and observed violations are red", async () => {
  const root = await fixture("export const value = 5;", {
    "bridge.ts": "export function bridge() {}",
  });
  try {
    const world = await design("dependsOn", false);
    const absent = await collectImplementationEvidence({ root, policy });
    assertEquals(absent.completeScopes.length, 1);
    assertEquals(
      (await compileSemanticWorld(world, {
        focus: "implementation",
        ...absent,
      })).status,
      "green",
    );
    const partial = await collectImplementationEvidence({
      root,
      policy: {
        ...policy,
        components: [{ ...policy.components[0], exhaustive: false }],
      },
    });
    assertEquals(
      (await compileSemanticWorld(world, {
        focus: "implementation",
        ...partial,
      })).status,
      "yellow",
    );
    const missing = await collectImplementationEvidence({
      root,
      policy: {
        ...policy,
        components: [{ ...policy.components[0], files: ["missing.ts"] }],
      },
    });
    assertEquals(missing.completeScopes.length, 0);
    await Deno.writeTextFile(
      `${root}/app.ts`,
      "export function run(callback: () => void) { callback(); }",
    );
    const opaque = await collectImplementationEvidence({ root, policy });
    assert(
      opaque.analysis.issues.some((issue) => issue.reason === "indirect-call"),
    );
    assertEquals(opaque.completeScopes.length, 0);
    await Deno.writeTextFile(
      `${root}/app.ts`,
      'import {bridge} from "./bridge.ts"; bridge();',
    );
    const present = await collectImplementationEvidence({ root, policy });
    assertEquals(
      (await compileSemanticWorld(world, {
        focus: "implementation",
        ...present,
      })).status,
      "red",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("native type failures are mandatory failed checks and API mapping respects lexical scope", async () => {
  const root = await fixture(
    `
export function local(Deno: {readTextFile(x:string):string}) { return Deno.readTextFile("local"); }
export const actual: number = Deno.readTextFile("global");`,
    {
      "global.d.ts":
        "declare namespace Deno { function readTextFile(path: string): string; }",
    },
  );
  try {
    const evidence = await collectImplementationEvidence({
      root,
      policy: {
        ...policy,
        targets: [{
          entity: "urn:test:B",
          globals: ["Deno.readTextFile"],
          access: "reads",
        }],
      },
    });
    assertEquals(evidence.checks[0].passed, false);
    assertEquals(
      evidence.observations.filter((item) => item.predicate === "reads").length,
      1,
    );
    assertEquals(evidence.completeScopes.length, 0);
    assertEquals(
      (await compileSemanticWorld(await design("reads"), {
        focus: "implementation",
        ...evidence,
      })).status,
      "red",
    );
    const wrong = evidence.analysis.calls.find((call) => call.line === 2);
    assertEquals(wrong?.global, undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("policy validation rejects self-certified verdicts, invalid selectors and escaping paths", async () => {
  assertThrows(() => parseImplementationPolicy({ ...policy, passes: true }));
  assertThrows(() =>
    parseImplementationPolicy({ ...policy, project: "../tsconfig.json" })
  );
  assertThrows(() =>
    parseImplementationPolicy({
      ...policy,
      components: [{ ...policy.components[0], files: [] }],
    })
  );
  assertThrows(() =>
    parseImplementationPolicy({
      ...policy,
      targets: [{ entity: "urn:test:B" }],
    })
  );
  const root = await fixture("export const value = 5;");
  try {
    await assertRejects(() =>
      collectImplementationEvidence({
        root,
        policy: { ...policy, project: "missing.json" },
      })
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
