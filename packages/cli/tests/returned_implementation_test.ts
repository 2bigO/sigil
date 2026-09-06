import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  compile,
  parseSemanticWorld,
  projectSigilIntent,
  readCompileArtifact,
  validateCompilationReportWire,
  worldFromFacts,
  writeSemanticState,
} from "@qoherent/sigil-compiler";
import { digest } from "../../compiler/src/semantic/turtle.ts";
import { TurtleBuilder } from "../../compiler/src/semantic/builder.ts";
import { CoreAdapter } from "../src/core-adapter.ts";
import { runCli } from "../src/main.ts";

async function copyTree(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    if (entry.isDirectory) {
      await copyTree(`${source}/${entry.name}`, `${destination}/${entry.name}`);
    } else {await Deno.copyFile(
        `${source}/${entry.name}`,
        `${destination}/${entry.name}`,
      );}
  }
}

async function fixture() {
  const root = await Deno.makeTempDir();
  const transport = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/.sigil`);
  await Deno.writeTextFile(
    `${root}/.sigil/config.json`,
    JSON.stringify({
      sigilVersion: "0.7.0",
      workspace: { name: "returned-test", members: [] },
      files: { include: ["**/*.sigil"], exclude: [] },
      tools: {},
    }),
  );
  await Deno.writeTextFile(
    `${root}/main.sigil`,
    `component Application {
  goal {
    Call the bridge.
  }
  interface {
    Run {
      Return the bridge result.
    }
  }
}
`,
  );
  await Deno.writeTextFile(
    `${root}/app.ts`,
    "export function actual() { return 0; } export function decoy() { return 0; }",
  );
  await Deno.writeTextFile(
    `${root}/bridge.ts`,
    "export function bridge() { return 1; }",
  );
  await Deno.writeTextFile(
    `${root}/tsconfig.json`,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "nodenext",
        allowImportingTsExtensions: true,
      },
      files: ["app.ts", "bridge.ts"],
    }),
  );
  await Deno.writeTextFile(
    `${root}/oracle.ts`,
    'import {actual} from "./app.ts"; if(actual() !== 1) Deno.exit(1);',
  );
  const resolved = await new CoreAdapter().resolveWorkspace(root);
  assertEquals(resolved.diagnostics.filter((d) => d.severity === "error"), []);
  const source = await projectSigilIntent(
    resolved.components,
    root,
    resolved.imports,
  );
  const component =
    Object.values(source.bindings).find((b) => !b.unit)!.componentId;
  const builder = new TurtleBuilder().type("urn:Bridge", "Capability").edge(
    component,
    "invokes",
    "urn:Bridge",
  );
  for (const [id, binding] of Object.entries(source.bindings)) {
    if (binding.unit) {
      builder.edge(id, "from", component).value(id, "relation", "invokes").edge(
        id,
        "target",
        "urn:Bridge",
      ).value(id, "expected", true);
    }
  }
  const additions = await parseSemanticWorld([{
    sourceId: "interpretation",
    turtle: builder.toString(),
  }]);
  const world = await worldFromFacts([
    ...source.world.facts,
    ...additions.facts,
  ], { ...source.world.provenance, ...additions.provenance });
  await writeSemanticState(root, {
    world,
    receipt: {
      version: 1,
      worldFingerprint: world.fingerprint,
      sourceFingerprint: source.world.fingerprint,
      componentBindings: Object.fromEntries(
        Object.values(source.bindings).filter((b) => !b.unit).map(
          (b) => [b.componentId, b.componentName],
        ),
      ),
    },
  });
  await Deno.writeTextFile(
    `${root}/.sigil/implementation.json`,
    JSON.stringify({
      version: 1,
      project: "tsconfig.json",
      components: [{ entity: component, files: ["app.ts"], exhaustive: true }],
      targets: [{
        entity: "urn:Bridge",
        declarations: [{ file: "bridge.ts", symbol: "bridge" }],
      }],
      checks: [{
        id: "host-case",
        command: Deno.execPath(),
        args: ["run", "--quiet", "oracle.ts"],
        files: ["oracle.ts"],
      }],
    }),
  );
  const slice = await runCli([
    "semantic",
    "slice",
    root,
    "--component",
    "Application",
  ]);
  assertEquals(slice.exitCode, 0, slice.stderr);
  const assignment = JSON.parse(slice.stdout);
  const handoff = assignment.artifacts.handoff as string;
  const implemented =
    'import {bridge} from "./bridge.ts"; export function actual() { return bridge(); } export function decoy() { return 0; }';
  const claim = async (symbol: string) => {
    await Deno.writeTextFile(
      `${transport}/claims.ttl`,
      `@prefix s: <https://sigil.dev/ontology/1#> . <urn:R> a s:Evidence; s:covers ${
        assignment.handoff.obligations.map((o: { id: string }) => `<${o.id}>`)
          .join(", ")
      }; s:from <${component}>; s:relation "invokes"; s:target <urn:Bridge>; s:passes true .`,
    );
    await Deno.writeTextFile(
      `${transport}/locations.json`,
      JSON.stringify({
        version: 1,
        handoff,
        receipts: {
          "urn:R": {
            locations: [{
              file: "app.ts",
              symbol,
              fingerprint: await digest(
                await Deno.readTextFile(`${root}/app.ts`),
              ),
            }],
          },
        },
      }),
    );
    const imported = await runCli([
      "semantic",
      "receipts",
      root,
      "--handoff",
      handoff,
      "--claims",
      `${transport}/claims.ttl`,
      "--locations",
      `${transport}/locations.json`,
    ]);
    assertEquals(imported.exitCode, 0, imported.stderr);
    assertEquals(JSON.parse(imported.stdout).untrusted, true);
    return JSON.parse(imported.stdout).artifacts.receipts as string;
  };
  return { root, transport, component, handoff, implemented, claim };
}

Deno.test("CLI handoff and receipt verification share scoped outcomes with ordinary compile", async () => {
  const f = await fixture();
  try {
    await Deno.writeTextFile(`${f.root}/app.ts`, f.implemented);
    const current = await runCli(["semantic", "verify", f.root]);
    assertEquals(current.exitCode, 0, current.stderr);
    assert(
      JSON.parse(current.stdout).checks.some((
        c: { id: string; passed: boolean },
      ) => c.id === "host-case" && c.passed),
    );
    const currentCompile = await compile(
      f.root,
      { kind: "component", componentName: "Application" },
      "standard",
      { exactTarget: true, focus: "implementation" },
    );
    assertEquals(currentCompile.status, "green");
    const receipts = await f.claim("decoy");
    const verified = await runCli([
      "semantic",
      "verify",
      f.root,
      "--handoff",
      f.handoff,
      "--receipts",
      receipts,
    ]);
    assertEquals(verified.exitCode, 0, verified.stderr);
    const data = JSON.parse(verified.stdout);
    assertEquals(
      data.receiptResults.map((r: { status: string }) => r.status),
      data.obligations.map(() => "unresolved"),
    );
    assert(
      data.obligations.every((o: { status: string }) => o.status === "covered"),
    );
    assert(
      data.checks.some((c: { id: string; passed: boolean }) =>
        c.id === "host-case" && c.passed
      ),
    );
    const report = await compile(
      f.root,
      { kind: "component", componentName: "Application" },
      "standard",
      {
        exactTarget: true,
        focus: "implementation",
        returnedImplementation: { handoff: f.handoff, receipts },
      },
    );
    assertEquals(report.status, "green");
    assert(report.returnedImplementation);
    assertEquals(
      report.returnedImplementation.receipts[0].status,
      "unresolved",
    );
    assert(validateCompilationReportWire(JSON.parse(JSON.stringify(report))));
    assert(
      !validateCompilationReportWire({
        ...report,
        returnedImplementation: {
          ...report.returnedImplementation,
          scope: 123,
        },
      }),
    );
    assert(await readCompileArtifact(f.root, "runs", report.artifacts!.run!));
    const cli = await runCli([
      "compile",
      f.root,
      "--component",
      "Application",
      "--exact-target",
      "--focus",
      "implementation",
      "--handoff",
      f.handoff,
      "--receipts",
      receipts,
      "--no-cache",
      "--format",
      "markdown",
    ]);
    assertEquals(cli.exitCode, 0, cli.stderr);
    assert(cli.stdout.includes("Coverage: **GREEN**"));
    assert(cli.stdout.includes("unresolved"));
    assert(cli.stdout.includes("app.ts:1:"));
    const noClaims = await runCli([
      "semantic",
      "verify",
      f.root,
      "--handoff",
      f.handoff,
      "--format",
      "markdown",
    ]);
    assertEquals(noClaims.exitCode, 0, noClaims.stderr);
    assert(noClaims.stdout.includes("No receipt claims submitted"));
    const returnedRoot = `${f.transport}/returned`;
    await copyTree(f.root, returnedRoot);
    await Deno.remove(`${returnedRoot}/.sigil/handoffs`, { recursive: true });
    const transferred = await runCli([
      "semantic",
      "verify",
      returnedRoot,
      "--handoff",
      f.handoff,
      "--handoff-root",
      f.root,
      "--receipts",
      receipts,
    ]);
    assertEquals(transferred.exitCode, 0, transferred.stderr);
    assertEquals(
      JSON.parse(transferred.stdout).codeFingerprint,
      data.codeFingerprint,
    );
    await Deno.writeTextFile(
      `${f.root}/app.ts`,
      "export function actual() { return 1; }",
    );
    const yellow = await runCli([
      "semantic",
      "verify",
      f.root,
      "--handoff",
      f.handoff,
    ]);
    assertEquals(yellow.exitCode, 1, yellow.stderr);
    assertEquals(JSON.parse(yellow.stdout).status, "yellow");
    const yellowCompile = await compile(
      f.root,
      { kind: "component", componentName: "Application" },
      "standard",
      {
        exactTarget: true,
        focus: "implementation",
        returnedImplementation: { handoff: f.handoff },
      },
    );
    assertEquals(yellowCompile.status, "yellow");
    await Deno.writeTextFile(
      `${f.root}/app.ts`,
      "export function actual() { return 0; }",
    );
    const failed = await runCli([
      "semantic",
      "verify",
      f.root,
      "--handoff",
      f.handoff,
      "--receipts",
      receipts,
    ]);
    assertEquals(failed.exitCode, 1, failed.stderr);
    const red = JSON.parse(failed.stdout);
    assertEquals(red.status, "red");
    assert(red.checks.some((c: { passed: boolean }) => !c.passed));
    assertEquals(red.receiptResults[0].locations[0].status, "stale-file");
    const currentFailure = await runCli(["semantic", "verify", f.root]);
    assertEquals(currentFailure.exitCode, 1, currentFailure.stderr);
    assertEquals(JSON.parse(currentFailure.stdout).status, "red");
    const currentFailedCompile = await compile(
      f.root,
      { kind: "component", componentName: "Application" },
      "standard",
      { exactTarget: true, focus: "implementation" },
    );
    assertEquals(currentFailedCompile.status, "red");
    const redCompile = await compile(
      f.root,
      { kind: "component", componentName: "Application" },
      "standard",
      {
        exactTarget: true,
        focus: "implementation",
        returnedImplementation: { handoff: f.handoff, receipts },
      },
    );
    assertEquals(redCompile.status, "red");
  } finally {
    await Deno.remove(f.root, { recursive: true });
    await Deno.remove(f.transport, { recursive: true });
  }
});

Deno.test("retained compilation rejects replacement authority and mismatched scope before events", async () => {
  const f = await fixture();
  try {
    for (
      const options of [
        { focus: "design" as const },
        { semanticDocuments: [] },
        { semanticEngine: { observations: [] } },
      ]
    ) {
      let events = 0;
      await assertRejects(
        () =>
          compile(
            f.root,
            { kind: "component", componentName: "Application" },
            "standard",
            {
              exactTarget: true,
              returnedImplementation: { handoff: f.handoff },
              onEvent: () => {
                events++;
              },
              ...options,
            },
          ),
        Error,
        "cannot override",
      );
      assertEquals(events, 0);
    }
    // A second component makes workspace scope broader than the original assignment.
    await Deno.writeTextFile(
      `${f.root}/other.sigil`,
      "component Other {\n  goal {}\n  interface {}\n}\n",
    );
    await assertRejects(
      () =>
        compile(f.root, { kind: "workspace" }, "standard", {
          returnedImplementation: { handoff: f.handoff },
        }),
      Error,
      "scope must match",
    );
    await Deno.remove(`${f.root}/other.sigil`);
    await Deno.writeTextFile(`${f.root}/oracle.ts`, "// forged oracle");
    const refused = await runCli([
      "semantic",
      "verify",
      f.root,
      "--handoff",
      f.handoff,
    ]);
    assertEquals(refused.exitCode, 1);
    assertEquals(refused.stdout, "");
    assert(refused.stderr.includes("Protected handoff inputs changed"));
    for (
      const args of [
        ["semantic", "verify", f.root, "--receipts", "bad"],
        ["compile", f.root, "--receipts", "bad"],
        ["compile", f.root, "--handoff", f.handoff, "--focus", "design"],
      ]
    ) assertEquals((await runCli(args)).exitCode, 2);
  } finally {
    await Deno.remove(f.root, { recursive: true });
    await Deno.remove(f.transport, { recursive: true });
  }
});
