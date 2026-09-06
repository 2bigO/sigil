import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  artifactJson,
  readCompileArtifact,
} from "../src/semantic/artifacts.ts";
import type { ImplementationPolicy } from "../src/semantic/evidence.ts";
import { createImplementationHandoff } from "../src/semantic/handoff.ts";
import { writeReceiptSubmission } from "../src/semantic/receipts.ts";
import { digest, parseSemanticWorld } from "../src/semantic/turtle.ts";
import { verifyReturnedImplementation } from "../src/semantic/verify-return.ts";

async function fixture(
  options: {
    negative?: boolean;
    expectedCheck?: number;
    brokenCommand?: boolean;
  } = {},
) {
  const root = await Deno.makeTempDir({ prefix: "sigil-return-test-" });
  await Deno.mkdir(`${root}/.sigil`);
  await Deno.writeTextFile(
    `${root}/app.ts`,
    "export function actual() { return 0; } export function decoy() { return 0; }",
  );
  await Deno.writeTextFile(
    `${root}/bridge.ts`,
    "export function bridge() { return 1; }",
  );
  await Deno.writeTextFile(`${root}/hidden.ts`, "export const value = 0;");
  await Deno.writeTextFile(
    `${root}/main.sigil`,
    "component Application { goal {} interface {} }",
  );
  await Deno.writeTextFile(
    `${root}/tsconfig.json`,
    artifactJson({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "nodenext",
        allowImportingTsExtensions: true,
      },
      files: ["app.ts", "bridge.ts", "hidden.ts"],
    }),
  );
  await Deno.writeTextFile(
    `${root}/oracle.ts`,
    `import {actual} from "./app.ts"; if(actual() !== ${
      options.expectedCheck ?? 1
    }) Deno.exit(1);`,
  );
  const policy: ImplementationPolicy = {
    version: 1,
    project: "tsconfig.json",
    components: [{
      entity: "urn:A",
      files: ["app.ts", "hidden.ts"],
      exhaustive: true,
    }],
    targets: [{
      entity: "urn:B",
      declarations: [{ file: "bridge.ts", symbol: "bridge" }],
    }],
    ...(options.expectedCheck !== undefined || options.brokenCommand
      ? {
        checks: [{
          id: "host-case",
          command: options.brokenCommand
            ? "sigil-no-such-check-executable"
            : Deno.execPath(),
          args: ["run", "--quiet", "oracle.ts"],
          files: ["oracle.ts"],
        }],
      }
      : {}),
  };
  await Deno.writeTextFile(
    `${root}/.sigil/implementation.json`,
    artifactJson(policy),
  );
  const relation = options.negative ? "dependsOn" : "invokes";
  const world = await parseSemanticWorld([{
    sourceId: "intent",
    turtle: `@prefix s: <https://sigil.dev/ontology/1#> .
<urn:A> a s:Component . <urn:B> a s:Component .
<urn:C> a s:Contract; s:required true; s:from <urn:A>; s:relation "${relation}"; s:target <urn:B>; s:expected ${!options
      .negative} .
${options.negative ? "" : "<urn:A> s:invokes <urn:B> ."}`,
  }]);
  const handoff = await createImplementationHandoff({
    root,
    world,
    policy,
    subjects: ["urn:A"],
    sourceFingerprint: await digest("original-intent"),
  });
  const claim = async (symbol: string, file = "app.ts") => {
    const obligation = handoff.manifest.obligations[0];
    return (await writeReceiptSubmission(
      root,
      handoff,
      `@prefix s: <https://sigil.dev/ontology/1#> .
<urn:R> a s:Evidence; s:covers <${obligation.id}>; s:from <urn:A>; s:relation "${relation}"; s:target <urn:B>; s:expected ${!options
        .negative}; s:passes true .`,
      {
        version: 1,
        handoff: handoff.id,
        receipts: {
          "urn:R": {
            locations: [{
              file,
              symbol,
              fingerprint: await digest(
                await Deno.readTextFile(`${root}/${file}`),
              ),
            }],
          },
        },
      },
    )).id;
  };
  const verify = (receipts?: string) =>
    verifyReturnedImplementation({ root, handoff: handoff.id, receipts });
  return { root, handoff, claim, verify };
}
const implemented =
  'import {bridge} from "./bridge.ts"; export function actual() { return bridge(); } export function decoy() { return 0; }';

Deno.test("returned code verifies exact receipt witnesses while independent coverage remains separate", async () => {
  const { root, handoff, claim, verify } = await fixture();
  try {
    await Deno.writeTextFile(`${root}/app.ts`, implemented);
    const supported = await verify(await claim("actual"));
    assertEquals(supported.report.status, "green");
    assertEquals(supported.report.receiptResults[0].status, "supported");
    assert(supported.report.receiptResults[0].evidence.length > 0);
    assertEquals(supported.report.obligations[0].status, "covered");
    assert(
      await readCompileArtifact(root, "runs", supported.report.artifacts.run),
    );
    const wrong = await verify(await claim("decoy"));
    assertEquals(wrong.report.status, "green");
    assertEquals(wrong.report.receiptResults[0].status, "unresolved");
    assertEquals((await verify()).report.status, "green");
    assertEquals((await verify()).report.receiptResults, []);
    const staleReceipt = await claim("actual");
    await Deno.writeTextFile(
      `${root}/app.ts`,
      "export function actual() { return 0; }",
    );
    const missing = await verify(staleReceipt);
    assertEquals(missing.report.status, "yellow");
    assertEquals(
      missing.report.receiptResults[0].locations[0].status,
      "stale-file",
    );
    assertEquals(
      missing.report.obligations.length,
      handoff.manifest.obligations.length,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("complete negatives remain open for opaque code and violations in unmentioned files turn red", async () => {
  const { root, claim, verify } = await fixture({ negative: true });
  try {
    const green = await verify(await claim("$module"));
    assertEquals(green.report.status, "green");
    assertEquals(green.report.receiptResults[0].status, "supported");
    await Deno.writeTextFile(
      `${root}/app.ts`,
      'const path = "./bridge.ts"; export const value = import(path);',
    );
    const opaque = await verify(await claim("$module"));
    assertEquals(opaque.report.status, "yellow");
    assertEquals(opaque.report.receiptResults[0].status, "unresolved");
    await Deno.writeTextFile(`${root}/app.ts`, "export const value = 0;");
    const receipts = await claim("$module");
    await Deno.writeTextFile(
      `${root}/hidden.ts`,
      'import {bridge} from "./bridge.ts"; export const hidden = bridge();',
    );
    const red = await verify(receipts);
    assertEquals(red.report.status, "red");
    assertEquals(red.report.receiptResults[0].status, "contradicted");
    assertEquals(red.report.obligations[0].status, "violated");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("required host checks run in isolated copies and failures dominate supported receipts", async () => {
  for (const expectedCheck of [1, 2]) {
    const { root, claim, verify } = await fixture({ expectedCheck });
    try {
      await Deno.writeTextFile(`${root}/app.ts`, implemented);
      const original = await Deno.readTextFile(`${root}/oracle.ts`);
      const result = await verify(await claim("actual"));
      assertEquals(result.report.receiptResults[0].status, "supported");
      assertEquals(result.report.status, expectedCheck === 1 ? "green" : "red");
      assertEquals(
        result.report.checks.find((c) => c.id === "host-case")?.passed,
        expectedCheck === 1,
      );
      assert(result.report.artifacts.checks["host-case"]);
      assertEquals(await Deno.readTextFile(`${root}/oracle.ts`), original);
      await Deno.writeTextFile(`${root}/oracle.ts`, "// replaced oracle");
      await assertRejects(
        () => verify(),
        Error,
        "Protected handoff inputs changed",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
  const broken = await fixture({ brokenCommand: true });
  try {
    await Deno.writeTextFile(`${broken.root}/app.ts`, implemented);
    await assertRejects(() => broken.verify());
  } finally {
    await Deno.remove(broken.root, { recursive: true });
  }
});
