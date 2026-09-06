import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  artifactJson,
  readCompileArtifact,
  writeCompileArtifact,
} from "../src/semantic/artifacts.ts";
import { compileSemanticWorld } from "../src/semantic/compile.ts";
import {
  collectImplementationEvidence,
  type ImplementationPolicy,
  parseImplementationPolicy,
} from "../src/semantic/evidence.ts";
import { resolveReceiptLocations } from "../src/semantic/receipt-locations.ts";
import {
  createImplementationHandoff,
  readImplementationHandoff,
  validateHandoffSnapshot,
} from "../src/semantic/handoff.ts";
import {
  captureImplementationSnapshot,
  withImplementationSnapshot,
} from "../src/semantic/implementation-workspace.ts";
import {
  parseReceiptSubmission,
  readReceiptSubmission,
  writeReceiptSubmission,
} from "../src/semantic/receipts.ts";
import { digest, parseSemanticWorld } from "../src/semantic/turtle.ts";

async function fixture() {
  const root = await Deno.makeTempDir({ prefix: "sigil-handoff-test-" });
  await Deno.mkdir(`${root}/.sigil`);
  const files = {
    "app.ts": "export function execute() { return 0; }",
    "bridge.ts": "export function bridge() { return 1; }",
    "test.ts": "// Protected test oracle\nexport const expected = 1;",
    "main.sigil": "component App { goal {} interface {} }",
    "tsconfig.json":
      '{"compilerOptions":{"strict":true,"noEmit":true},"files":["app.ts","bridge.ts"]}',
  };
  for (const [path, text] of Object.entries(files)) {
    await Deno.writeTextFile(`${root}/${path}`, text);
  }
  const policy: ImplementationPolicy = {
    version: 1,
    project: "tsconfig.json",
    components: [{ entity: "urn:A", files: ["app.ts"], exhaustive: true }],
    targets: [{
      entity: "urn:B",
      declarations: [{ file: "bridge.ts", symbol: "bridge" }],
    }],
    checks: [{
      id: "bridge-test",
      command: "deno",
      args: ["test", "test.ts"],
      files: ["test.ts"],
    }],
  };
  await Deno.writeTextFile(
    `${root}/.sigil/implementation.json`,
    artifactJson(policy),
  );
  const world = await parseSemanticWorld([{
    sourceId: "design",
    turtle: `
@prefix s: <https://sigil.dev/ontology/1#> .
<urn:A> a s:Component; s:invokes <urn:B> .
<urn:B> a s:Component .
<urn:C> a s:Contract; s:from <urn:A>; s:relation "invokes"; s:target <urn:B>; s:required true; s:expected true .
<urn:Unrelated> a s:Component .`,
  }]);
  const handoff = await createImplementationHandoff({
    root,
    world,
    subjects: ["urn:A"],
    policy,
    sourceFingerprint: await digest("source"),
  });
  return { root, world, policy, handoff, files };
}

Deno.test("retained handoffs replay all boundary obligations and freeze specification, configuration and test inputs", async () => {
  const { root, world, policy, handoff, files } = await fixture();
  try {
    assertEquals(handoff.manifest.boundary, ["urn:A", "urn:B"]);
    assertEquals(handoff.manifest.obligations.length, 1);
    assert(handoff.manifest.obligations[0].facts.length >= 4);
    assertEquals(handoff.manifest.requiredChecks, [
      "bridge-test",
      "urn:sigil:check:typescript7:tsconfig.json",
    ]);
    const replayed = await readImplementationHandoff(root, handoff.id);
    assertEquals(replayed.manifest, handoff.manifest);
    assertEquals(replayed.compilation.status, "green");
    assertEquals(
      (await createImplementationHandoff({
        root,
        world,
        subjects: ["urn:A"],
        policy,
        sourceFingerprint: await digest("source"),
      })).id,
      handoff.id,
    );
    await Deno.writeTextFile(
      `${root}/app.ts`,
      "export function execute() { return 1; }",
    );
    const returned = await validateHandoffSnapshot(root, handoff);
    assert(returned.fingerprint !== handoff.manifest.baselineFingerprint);
    for (
      const path of [
        "test.ts",
        "tsconfig.json",
        "main.sigil",
        ".sigil/implementation.json",
      ]
    ) {
      const previous = await Deno.readTextFile(`${root}/${path}`);
      await Deno.writeTextFile(`${root}/${path}`, previous + "\n// changed");
      await assertRejects(
        () => validateHandoffSnapshot(root, handoff),
        Error,
        path,
      );
      await Deno.writeTextFile(`${root}/${path}`, previous);
    }
    await Deno.writeTextFile(`${root}/tsconfig.hidden.json`, "{}");
    await assertRejects(
      () => validateHandoffSnapshot(root, handoff),
      Error,
      "tsconfig.hidden.json",
    );
    await Deno.remove(`${root}/tsconfig.hidden.json`);
    await Deno.mkdir(`${root}/.sigil/receipts/submitted`);
    await Deno.writeTextFile(
      `${root}/.sigil/receipts/submitted/locations.json`,
      "{}",
    );
    assertEquals(
      (await validateHandoffSnapshot(root, handoff)).fingerprint,
      returned.fingerprint,
    );
    assertEquals(await Deno.readTextFile(`${root}/test.ts`), files["test.ts"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("handoff replay rejects fabricated obligations and changed kernel identities even in intact bundles", async () => {
  const { root, handoff } = await fixture();
  try {
    const original = (await readCompileArtifact(root, "handoffs", handoff.id))!;
    for (
      const manifest of [
        { ...handoff.manifest, obligations: [] },
        {
          ...handoff.manifest,
          kernelFingerprint: await digest("other-kernel"),
        },
        { ...handoff.manifest, baselineFiles: [] },
        { ...handoff.manifest, protectedFiles: {} },
      ]
    ) {
      const forged = await writeCompileArtifact(root, {
        kind: "handoffs",
        dependencies: original.manifest.dependencies,
        metadata: original.manifest.metadata,
        files: { ...original.files, "handoff.json": artifactJson(manifest) },
      });
      await assertRejects(() => readImplementationHandoff(root, forged.id));
    }
    await Deno.writeTextFile(
      `${root}/.sigil/handoffs/${handoff.id}/assertions.egg`,
      "(run 100)",
    );
    await assertRejects(
      () => readImplementationHandoff(root, handoff.id),
      Error,
      "hash",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("receipt claims bind exact obligation or fact identities without becoming coverage evidence", async () => {
  const { root, handoff, files } = await fixture();
  try {
    const obligation = handoff.manifest.obligations[0];
    const turtle = (reference = obligation.id) =>
      `@prefix s: <https://sigil.dev/ontology/1#> .
<urn:receipt:R> a s:Evidence; s:covers <${reference}>; s:from <urn:A>; s:relation "invokes"; s:target <urn:B>; s:passes true .`;
    const sidecar = {
      version: 1,
      handoff: handoff.id,
      receipts: {
        "urn:receipt:R": {
          locations: [{
            file: "app.ts",
            fingerprint: await digest(files["app.ts"]),
            symbol: "execute",
          }],
        },
      },
    };
    const submitted = await writeReceiptSubmission(
      root,
      handoff,
      turtle(),
      sidecar,
    );
    const replayed = await readReceiptSubmission(root, handoff, submitted.id);
    assertEquals(replayed.fingerprint, submitted.submission.fingerprint);
    assertEquals(replayed.claims[0].obligations, [obligation.id]);
    assertEquals(
      (await parseReceiptSubmission(
        handoff,
        turtle(obligation.facts[0]),
        sidecar,
      )).claims[0].obligations,
      [obligation.id],
    );
    // A perfectly shaped claim, including passes true, establishes no current code fact.
    assertEquals(
      (await compileSemanticWorld(handoff.slice, { focus: "implementation" }))
        .status,
      "yellow",
    );
    assertEquals(
      (await parseReceiptSubmission(handoff, "", {
        version: 1,
        handoff: handoff.id,
        receipts: {},
      })).claims,
      [],
    );
    assertEquals(handoff.manifest.obligations.length, 1);
    await assertRejects(() =>
      parseReceiptSubmission(handoff, turtle("urn:invented"), sidecar)
    );
    await assertRejects(() =>
      parseReceiptSubmission(
        handoff,
        turtle().replace('"invokes"', '"uses"'),
        sidecar,
      )
    );
    await assertRejects(() =>
      parseReceiptSubmission(
        handoff,
        turtle() + "<urn:receipt:R> s:from <urn:Wrong> .",
        sidecar,
      )
    );
    await assertRejects(() =>
      parseReceiptSubmission(handoff, turtle(), {
        ...sidecar,
        handoff: "wrong",
      })
    );
    await assertRejects(
      () =>
        parseReceiptSubmission(
          handoff,
          turtle(),
          JSON.stringify(sidecar).replace(
            '"version":1',
            '"version":1,"version":1',
          ),
        ),
      Error,
      "Duplicate",
    );
    await assertRejects(() =>
      parseReceiptSubmission(handoff, turtle(), {
        ...sidecar,
        receipts: {
          "urn:receipt:R": {
            locations: [{
              file: "../escape.ts",
              fingerprint: "a".repeat(64),
              symbol: "run",
            }],
          },
        },
      })
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("native receipt resolution distinguishes exact callers, nested callbacks, stale pointers and host ownership", async () => {
  const { root, handoff, policy } = await fixture();
  try {
    const app = `import { bridge } from "./bridge";
export function decoy() { return 0; }
export function actual() { return bridge(); }
export function outer() { function inner() { return bridge(); } return () => bridge(); }
export const arrow = () => bridge();
export class Example { constructor() { bridge(); } run() { return bridge(); } }
export default function() { bridge(); }
`;
    await Deno.writeTextFile(`${root}/app.ts`, app);
    const evidence = await collectImplementationEvidence({ root, policy });
    assertEquals(evidence.analysis.extractorVersion, 2);
    const symbols = evidence.analysis.symbols;
    const actual = symbols.find((s) => s.selector === "actual")!;
    const decoy = symbols.find((s) => s.selector === "decoy")!;
    const outer = symbols.find((s) => s.selector === "outer")!;
    const inner = symbols.find((s) => s.selector === "outer.inner")!;
    const arrow = symbols.find((s) => s.selector === "arrow")!;
    const method = symbols.find((s) => s.selector === "Example.run")!;
    const module = symbols.find((s) =>
      s.file === "app.ts" && s.selector === "$module"
    )!;
    assert(actual && decoy && outer && inner && arrow && method && module);
    for (const sym of [actual, inner, arrow, method]) {
      assertEquals(
        evidence.analysis.calls.filter((c) => c.caller === sym.id).length,
        1,
      );
    }
    for (const sym of [decoy, outer, module]) {
      assertEquals(
        evidence.analysis.calls.filter((c) => c.caller === sym.id).length,
        0,
      );
    }
    const obligation = handoff.manifest.obligations[0];
    const loc = {
      file: "app.ts",
      fingerprint: await digest(app),
      symbol: "actual",
    };
    const submission = await parseReceiptSubmission(
      handoff,
      `@prefix s: <https://sigil.dev/ontology/1#> .
<urn:receipt:R> a s:Evidence; s:covers <${obligation.id}>; s:from <urn:A>; s:relation "invokes"; s:target <urn:B> .`,
      {
        version: 1,
        handoff: handoff.id,
        receipts: {
          "urn:receipt:R": {
            locations: [
              loc,
              { ...loc, symbol: "decoy" },
              { ...loc, fingerprint: "0".repeat(64) },
              { ...loc, symbol: "missing" },
              { ...loc, start: actual.start + 1, end: actual.end },
              { ...loc, file: "missing.ts" },
              {
                ...loc,
                file: "bridge.ts",
                fingerprint: evidence.analysis.files.find((f) =>
                  f.file === "bridge.ts"
                )!.fingerprint,
                symbol: "bridge",
              },
            ],
          },
        },
      },
    );
    const resolved = resolveReceiptLocations(handoff, submission, evidence);
    assertEquals(resolved.map((r) => r.status), [
      "located",
      "located",
      "stale-file",
      "unresolved-symbol",
      "stale-range",
      "missing-file",
      "unbound-owner",
    ]);
    assertEquals(resolved[0].symbol?.id, actual.id);
    // A valid pointer to the wrong function still lacks a witness for that claim.
    assertEquals(resolved[1].symbol?.id, decoy.id);
    assert(
      !evidence.analysis.calls.some((call) =>
        call.caller === resolved[1].symbol?.id
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("verification snapshots preserve dirty bytes and internal links while isolating tool writes", async () => {
  const { root } = await fixture();
  try {
    await Deno.symlink("app.ts", `${root}/alias.ts`);
    const snapshot = await captureImplementationSnapshot(root);
    let temporary = "";
    await withImplementationSnapshot(snapshot, async (copy) => {
      temporary = copy;
      assertEquals(
        await Deno.readTextFile(`${copy}/alias.ts`),
        await Deno.readTextFile(`${root}/app.ts`),
      );
      await Deno.writeTextFile(`${copy}/app.ts`, "changed only in copy");
    });
    assertEquals(
      (await captureImplementationSnapshot(root)).fingerprint,
      snapshot.fingerprint,
    );
    await assertRejects(() => Deno.stat(temporary), Deno.errors.NotFound);
    await Deno.remove(`${root}/alias.ts`);
    await Deno.symlink("../outside", `${root}/escape.ts`);
    await assertRejects(() => captureImplementationSnapshot(root));
    assertThrows(() =>
      parseImplementationPolicy({
        version: 1,
        project: "tsconfig.json",
        components: [],
        targets: [],
        checks: [{ id: "test", command: "deno", args: [], files: [] }],
      })
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
