import { parseSigilDocument } from "@qoherent/sigil-core";
import {
  compile,
  digest,
  intentBase,
  projectSigilIntent,
  readCompileArtifact,
  readSemanticState,
} from "@qoherent/sigil-compiler";
import { TurtleBuilder } from "../../compiler/src/semantic/builder.ts";
import { CoreAdapter } from "../src/core-adapter.ts";
import { runCli } from "../src/main.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const source = `component Application {
  goal {
    Avoid disk access.
  }
  interface {
    ReadOnly {
      Work without disk access.
    }
  }
}
`;
const intent = "Keep application behavior independent of disk.";
async function fixture(ambiguous = false, generatedComponent = false) {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/.sigil`);
  await Deno.writeTextFile(
    `${root}/.sigil/config.json`,
    JSON.stringify({
      sigilVersion: "0.7.0",
      workspace: { name: "semantic-test", members: [] },
      files: { include: ["**/*.sigil"], exclude: [] },
      tools: {},
    }),
  );
  await Deno.writeTextFile(`${root}/main.sigil`, source);
  const resolved = await new CoreAdapter().resolveWorkspace(root);
  const projected = await projectSigilIntent(
    resolved.components,
    root,
    resolved.imports,
  );
  const prepared = await intentBase(projected.world, intent);
  const component =
    Object.values(projected.bindings).find((b) => !b.unit)!.componentId;
  await Deno.writeTextFile(
    `${root}/app.ts`,
    "export function run() { return 1; }",
  );
  await Deno.writeTextFile(
    `${root}/tsconfig.json`,
    '{"compilerOptions":{"strict":true,"noEmit":true},"files":["app.ts"]}',
  );
  await Deno.writeTextFile(
    `${root}/.sigil/implementation.json`,
    JSON.stringify({
      version: 1,
      project: "tsconfig.json",
      components: [{ entity: component, files: ["app.ts"], exhaustive: true }],
      targets: [{ entity: "urn:Disk", globals: ["Deno.readTextFile"] }],
    }),
  );
  const builder = () => {
    const turtle = new TurtleBuilder().type("urn:Disk", "Capability");
    const contracts = [
      ...Object.entries(projected.bindings).filter(([, b]) => b.unit).map((
        [id],
      ) => id),
      prepared.contract,
    ];
    for (const id of contracts) {
      turtle.edge(id, "from", component).value(id, "relation", "uses").edge(
        id,
        "target",
        "urn:Disk",
      ).value(id, "expected", false).edge(component, "hasContract", id);
    }
    if (generatedComponent) {
      turtle.type("urn:Generated", "Component").value(
        "urn:Generated",
        "label",
        "Generated component",
      );
    }
    return turtle;
  };
  const candidates = ambiguous
    ? ["Left", "Right"].map((boundary) =>
      builder().type("urn:Left", "Boundary").type("urn:Right", "Boundary").edge(
        component,
        "routesThrough",
        `urn:${boundary}`,
      ).toString()
    )
    : [builder().toString()];
  const proposalFile = `${root}/proposals.json`;
  await Deno.writeTextFile(
    proposalFile,
    JSON.stringify({
      version: 1,
      candidates: candidates.map((additions, i) => ({
        id: `candidate-${i}`,
        additions,
        retractions: "",
      })),
    }),
  );
  return { root, proposalFile, component };
}

Deno.test("semantic CLI interprets, accepts and projects canonical meaning through normal compile", async () => {
  const { root, proposalFile } = await fixture();
  try {
    const generated = await runCli([
      "semantic",
      "intent",
      root,
      "--text",
      intent,
      "--proposals",
      proposalFile,
      "--beam",
      "request",
    ]);
    assert(generated.exitCode === 0, generated.stderr || generated.stdout);
    assert(JSON.parse(generated.stdout).status === "green");
    assert(await readSemanticState(root) === undefined);
    const selected = await runCli([
      "semantic",
      "status",
      root,
      "--beam",
      "request",
    ]);
    assert(selected.exitCode === 0, selected.stderr);
    const accepted = await runCli([
      "semantic",
      "accept",
      root,
      "--beam",
      "request",
    ]);
    assert(accepted.exitCode === 0, accepted.stderr);
    assert(
      JSON.parse(accepted.stdout).revision ===
        (await readSemanticState(root))?.revision,
    );
    const migration = await runCli([
      "semantic",
      "migrate",
      root,
      "--format",
      "json",
    ]);
    assert(migration.exitCode === 0, migration.stderr);
    assert(JSON.parse(migration.stdout).fromVersion === 2);
    assert(JSON.parse(migration.stdout).changed === false);
    assert(await Deno.readTextFile(`${root}/main.sigil`) === source);
    const report = await compile(root, { kind: "workspace" }, "standard", {
      focus: "design",
    });
    assert(report.status === "green", JSON.stringify(report.diagnostics));
    const implementation = await compile(
      root,
      { kind: "workspace" },
      "standard",
      { focus: "implementation" },
    );
    assert(implementation.status === "yellow");
    const status = await runCli(["semantic", "status", root]);
    assert(status.exitCode === 0, status.stderr);
    const view = await runCli(["semantic", "project", root]);
    assert(view.exitCode === 0, view.stderr);
    const projection = JSON.parse(view.stdout);
    assert(
      projection.turtle && projection.sigil && projection.worldFingerprint,
    );
    assert(
      !parseSigilDocument("view.sigil", projection.sigil, {
        sigilVersion: "0.7.0",
      })
        .diagnostics.some((
          d,
        ) => d.severity === "error"),
    );
    const textView = await runCli([
      "semantic",
      "project",
      root,
      "--format",
      "sigil",
    ]);
    assert(textView.stdout === projection.sigil);
    const slice = await runCli([
      "semantic",
      "slice",
      root,
      "--component",
      "Application",
      "--format",
      "text",
    ]);
    assert(slice.exitCode === 0, slice.stderr);
    assert(
      slice.stdout.includes("OBLIGATIONS") && !slice.stdout.includes("@prefix"),
    );
    const exported = await runCli([
      "semantic",
      "slice",
      root,
      "--component",
      "Application",
    ]);
    assert(exported.exitCode === 0, exported.stderr);
    const bundleId = JSON.parse(exported.stdout).artifacts.handoff;
    assert(slice.stdout.includes(bundleId));
    const retained = await readCompileArtifact(root, "handoffs", bundleId);
    assert(retained);
    assert(retained?.files["assertions.egg"].includes("assert-iri"));
    const manifest = JSON.parse(retained.files["handoff.json"]);
    assert(manifest.obligations.length > 0);
    assert(
      manifest.canonicalRevision ===
        JSON.parse(accepted.stdout).revision,
    );

    const claimed = manifest.obligations[0];
    const submissionRoot = await Deno.makeTempDir();
    try {
      const claimFile = `${submissionRoot}/receipts.ttl`;
      const locationsFile = `${submissionRoot}/locations.json`;
      await Deno.writeTextFile(
        claimFile,
        `@prefix s: <https://sigil.dev/ontology/1#> .
<urn:receipt:one> a s:Evidence; s:covers <${claimed.id}>; s:from <${claimed.subject}>; s:relation "${claimed.relation}"; s:target <${claimed.target}>; s:expected ${claimed.expected} .`,
      );
      await Deno.writeTextFile(
        locationsFile,
        JSON.stringify({
          version: 1,
          handoff: bundleId,
          receipts: { "urn:receipt:one": { locations: [] } },
        }),
      );
      const imported = await runCli([
        "semantic",
        "receipts",
        root,
        "--handoff",
        bundleId,
        "--claims",
        claimFile,
        "--locations",
        locationsFile,
      ]);
      assert(imported.exitCode === 0, imported.stderr);
      const data = JSON.parse(imported.stdout);
      assert(data.untrusted === true && data.status === undefined);
      assert(data.claims.length === 1);
      assert(
        await readCompileArtifact(root, "receipts", data.artifacts.receipts),
      );
    } finally {
      await Deno.remove(submissionRoot, { recursive: true });
    }

    await Deno.writeTextFile(
      `${root}/.sigil/handoffs/${bundleId}/generated.sigil`,
      "invalid syntax",
    );
    const stable = await runCli(["semantic", "status", root]);
    assert(stable.exitCode === 0, stable.stderr);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("semantic CLI preserves ambiguity and accepts only a current exact answer", async () => {
  const { root, proposalFile } = await fixture(true);
  try {
    const generated = await runCli([
      "semantic",
      "intent",
      root,
      "--text",
      intent,
      "--proposals",
      proposalFile,
      "--beam",
      "choice",
    ]);
    assert(generated.exitCode === 1, generated.stderr || generated.stdout);
    const question = JSON.parse(generated.stdout).question;
    assert(question.factId && question.exact);
    const premature = await runCli([
      "semantic",
      "accept",
      root,
      "--beam",
      "choice",
    ]);
    assert(
      premature.exitCode === 1 && premature.stderr.includes("selected green"),
    );
    const wrong = await runCli([
      "semantic",
      "answer",
      root,
      "--beam",
      "choice",
      "--fact",
      "outdated",
      "--value",
      "no",
    ]);
    assert(
      wrong.exitCode === 1 && wrong.stderr.includes("current discriminating"),
    );
    const answered = await runCli([
      "semantic",
      "answer",
      root,
      "--beam",
      "choice",
      "--fact",
      question.factId,
      "--value",
      "no",
    ]);
    assert(answered.exitCode === 0, answered.stderr);
    const status = await runCli([
      "semantic",
      "status",
      root,
      "--beam",
      "choice",
    ]);
    assert(JSON.parse(status.stdout).result === "selected");
    await Deno.writeTextFile(
      `${root}/main.sigil`,
      source.replace("Avoid disk access.", "Allow disk access."),
    );
    const stale = await runCli([
      "semantic",
      "accept",
      root,
      "--beam",
      "choice",
    ]);
    assert(stale.exitCode === 1 && stale.stderr.includes("changed since"));
    assert(await readSemanticState(root) === undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("semantic CLI rejects invalid usage before executing or mutating a workspace", async () => {
  for (
    const args of [
      [],
      ["unknown"],
      ["intent", "--text", "x"],
      ["answer", "--beam", "x", "--fact", "x", "--value", "maybe"],
      ["accept"],
      ["slice"],
      ["project", "--text", "x"],
      ["status", "--format", "turtle"],
    ]
  ) {
    const result = await runCli(["semantic", ...args]);
    assert(
      result.exitCode === 2 && result.stderr.includes("Usage:"),
      JSON.stringify(result),
    );
  }
  assert((await runCli(["semantic", "--help"])).stdout.includes("accept"));
  assert((await runCli(["--help"])).stdout.includes("semantic"));
});

Deno.test("semantic artifacts initializes storage before any green interpretation is available", async () => {
  const { root } = await fixture();
  try {
    const initialized = await runCli(["semantic", "artifacts", root]);
    assert(initialized.exitCode === 0, initialized.stderr);
    const result = JSON.parse(initialized.stdout);
    for (const kind of ["world", "receipts", "handoffs", "runs", "cache"]) {
      assert((await Deno.stat(result.directories[kind])).isDirectory);
    }
    assert(!await readSemanticState(root));
    assert(
      (await Deno.readTextFile(`${root}/.sigil/.gitignore`)).includes(
        "/receipts/",
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("semantic verify records evidence artifacts and recomputes coverage for changed source", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/.sigil`);
    await Deno.writeTextFile(
      `${root}/.sigil/config.json`,
      JSON.stringify({
        sigilVersion: "0.7.0",
        workspace: { name: "verify", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
    );
    await Deno.writeTextFile(
      `${root}/main.sigil`,
      "component Application {\n  goal {\n  }\n  interface {\n  }\n}\n",
    );
    await Deno.writeTextFile(
      `${root}/app.ts`,
      "// @sigil implements main.sigil::Application interface\nexport function run() { return 5; }",
    );
    await Deno.writeTextFile(
      `${root}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true },
        files: ["app.ts"],
      }),
    );
    const resolved = await new CoreAdapter().resolveWorkspace(root);
    const projected = await projectSigilIntent(
      resolved.components,
      root,
      resolved.imports,
    );
    const component = Object.keys(projected.bindings)[0];
    await Deno.writeTextFile(
      `${root}/.sigil/implementation.json`,
      JSON.stringify({
        version: 1,
        project: "tsconfig.json",
        components: [{
          entity: component,
          files: ["app.ts"],
          exhaustive: true,
        }],
        targets: [],
      }),
    );
    const result = await runCli(["semantic", "verify", root]);
    assert(result.exitCode === 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert(report.status === "green");
    assert(report.evidence.analysis.analyzer === "typescript@7.0.2");
    assert(Object.values(report.evidence.receipts).length === 1);
    assert(report.evidence.anchors.length === 1);
    assert(report.evidence.anchors[0].component === component);
    assert(report.evidence.observations.length === 0);
    assert(report.evidence.turtle.includes("Evidence"));
    const stageId = report.artifacts.stages["implementation-coverage"];
    const recorded = await readCompileArtifact(root, "cache", stageId);
    assert(recorded);
    assert(recorded?.files["observations.egg"].includes("assert-iri"));
    assert(
      recorded.manifest.dependencies.analysis ===
        report.evidence.inputFingerprint,
    );
    const run = await readCompileArtifact(root, "runs", report.artifacts.run);
    assert(run && JSON.parse(run.files["report.json"]).status === "green");
    assert(!await readSemanticState(root));
    const turtle = await runCli([
      "semantic",
      "verify",
      root,
      "--format",
      "turtle",
    ]);
    assert(turtle.exitCode === 0 && turtle.stdout.includes("Evidence"));
    const repeated = await runCli(["semantic", "verify", root]);
    assert(
      JSON.parse(repeated.stdout).artifacts
        .stages["implementation-coverage"] === stageId,
    );
    await Deno.writeTextFile(
      `${root}/app.ts`,
      'export const value: number = "wrong";',
    );
    const red = await runCli(["semantic", "verify", root]);
    assert(red.exitCode === 1 && JSON.parse(red.stdout).status === "red");
    assert(
      JSON.parse(red.stdout).artifacts.stages["implementation-coverage"] !==
        stageId,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function copyTree(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = `${source}/${entry.name}`;
    const to = `${destination}/${entry.name}`;
    if (entry.isDirectory) await copyTree(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}

Deno.test("public semantic flow retains views, handoff identity and independent receipt outcomes", async () => {
  const { root, proposalFile, component } = await fixture(false, true);
  let returnedRoot: string | undefined;
  let submissionRoot: string | undefined;
  const checkMarker = `${root}/.check-fail`;
  try {
    await Deno.writeTextFile(
      `${root}/bridge.ts`,
      "export function bridge() { return 1; }",
    );
    await Deno.writeTextFile(`${root}/hidden.ts`, "export const value = 0;");
    await Deno.writeTextFile(
      `${root}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true },
        files: ["app.ts", "bridge.ts", "hidden.ts"],
      }),
    );
    await Deno.writeTextFile(
      `${root}/.sigil/implementation.json`,
      JSON.stringify({
        version: 1,
        project: "tsconfig.json",
        components: [{
          entity: component,
          files: ["app.ts", "hidden.ts"],
          exhaustive: true,
        }],
        targets: [{
          entity: "urn:Disk",
          declarations: [{ file: "bridge.ts", symbol: "bridge" }],
        }],
        checks: [{
          id: "marker-check",
          command: Deno.execPath(),
          args: [
            "eval",
            "--allow-read",
            `try { await Deno.stat(${
              JSON.stringify(checkMarker)
            }); Deno.exit(1); } catch {}`,
          ],
          files: ["bridge.ts"],
        }],
      }),
    );
    const proposal = JSON.parse(await Deno.readTextFile(proposalFile)) as {
      candidates: { additions: string; [key: string]: unknown }[];
      [key: string]: unknown;
    };
    proposal.candidates = proposal.candidates.map((candidate) => ({
      ...candidate,
      additions: candidate.additions.replaceAll('"uses"', '"dependsOn"'),
    }));
    await Deno.writeTextFile(proposalFile, JSON.stringify(proposal));
    const generated = await runCli([
      "semantic",
      "intent",
      root,
      "--text",
      intent,
      "--proposals",
      proposalFile,
      "--beam",
      "public-flow",
    ]);
    assert(generated.exitCode === 0, generated.stderr || generated.stdout);
    const accepted = await runCli([
      "semantic",
      "accept",
      root,
      "--beam",
      "public-flow",
    ]);
    assert(accepted.exitCode === 0, accepted.stderr);
    const acceptedData = JSON.parse(accepted.stdout);
    const before = await readSemanticState(root);
    assert(before?.revision === acceptedData.revision);

    const ambiguousProposalFile = `${root}/ambiguous-proposals.json`;
    const routeIntent = "Route application operations through one boundary.";
    const routeContract = `urn:sigil:intent:${await digest(routeIntent)}`;
    const ambiguousCandidates = ["Left", "Right"].map((boundary) =>
      new TurtleBuilder()
        .type(`urn:${boundary}`, "Boundary")
        .type(routeContract, "Contract")
        .value(routeContract, "required", true)
        .value(routeContract, "description", routeIntent)
        .value(routeContract, "section", "goal")
        .edge(routeContract, "from", component)
        .value(routeContract, "relation", "dependsOn")
        .edge(routeContract, "target", "urn:Disk")
        .value(routeContract, "expected", false)
        .edge(component, "hasContract", routeContract)
        .edge(component, "routesThrough", `urn:${boundary}`)
        .toString()
    );
    await Deno.writeTextFile(
      ambiguousProposalFile,
      JSON.stringify({
        version: 1,
        candidates: ambiguousCandidates.map((additions, index) => ({
          id: `route-${index}`,
          additions,
          retractions: "",
        })),
      }),
    );
    const ambiguous = await runCli([
      "semantic",
      "intent",
      root,
      "--text",
      routeIntent,
      "--proposals",
      ambiguousProposalFile,
      "--beam",
      "route-choice",
    ]);
    assert(ambiguous.exitCode === 1, ambiguous.stderr || ambiguous.stdout);
    const ambiguousData = JSON.parse(ambiguous.stdout);
    assert(ambiguousData.question?.factId && ambiguousData.question.exact);
    const answered = await runCli([
      "semantic",
      "answer",
      root,
      "--beam",
      "route-choice",
      "--fact",
      ambiguousData.question.factId,
      "--value",
      "yes",
    ]);
    assert(answered.exitCode === 0, answered.stderr || answered.stdout);
    const routeStatus = await runCli([
      "semantic",
      "status",
      root,
      "--beam",
      "route-choice",
    ]);
    assert(
      JSON.parse(
        routeStatus.stdout,
      ).result === "selected",
    );
    const routeAccepted = await runCli([
      "semantic",
      "accept",
      root,
      "--beam",
      "route-choice",
    ]);
    assert(routeAccepted.exitCode === 0, routeAccepted.stderr);
    const routeRevision = JSON.parse(routeAccepted.stdout).revision as string;
    assert((await readSemanticState(root))?.revision === routeRevision);
    const configPath = `${root}/.sigil/config.json`;
    const legacyConfig = JSON.parse(await Deno.readTextFile(configPath));
    legacyConfig.tools = {
      compile: {
        evaluators: { codex: { provider: "codex", model: "test-model" } },
        profiles: { standard: { main: ["codex"] } },
        defaultProfile: "standard",
      },
    };
    await Deno.writeTextFile(configPath, JSON.stringify(legacyConfig));
    const configPreview = await runCli([
      "config",
      "migrate",
      root,
      "--format",
      "json",
    ]);
    assert(configPreview.exitCode === 0, configPreview.stderr);
    const configPreviewData = JSON.parse(configPreview.stdout);
    assert(configPreviewData.changes.length > 0);
    assert(JSON.parse(await Deno.readTextFile(configPath)).tools.compile);
    const configWritten = await runCli([
      "config",
      "migrate",
      root,
      "--write",
      "--expected-hash",
      configPreviewData.originalHash,
      "--format",
      "json",
    ]);
    assert(configWritten.exitCode === 0, configWritten.stderr);
    assert(
      JSON.parse(await Deno.readTextFile(configPath)).tools.semantic
        .defaultProvider === "codex",
    );
    const viewCheck = await runCli(["semantic", "project", root, "--check"]);
    assert(viewCheck.exitCode === 1, viewCheck.stdout);
    const published = await runCli([
      "semantic",
      "project",
      root,
      "--write",
      "--expected-revision",
      routeRevision,
    ]);
    assert(published.exitCode === 0, published.stderr);
    const after = await readSemanticState(root);
    assert(after?.revision === routeRevision);
    const currentViews = await runCli(["semantic", "project", root, "--check"]);
    assert(currentViews.exitCode === 0, currentViews.stderr);
    const components = JSON.parse(
      (await runCli([
        "semantic",
        "status",
        root,
        "--list",
        "components",
      ])).stdout,
    ).items as { id: string; authoredPath: string | null; viewPath: string }[];
    const generatedComponent = components.find((item) =>
      item.authoredPath === null
    );
    assert(
      generatedComponent && generatedComponent.viewPath.endsWith(".sigil"),
    );
    const publishedData = JSON.parse(published.stdout) as {
      transaction: string;
    };
    await Deno.remove(
      `${root}/.sigil/cache/view-transactions/${publishedData.transaction}/complete`,
    );
    await Deno.remove(`${root}/${generatedComponent.viewPath}`);
    const recoveredViews = await runCli([
      "semantic",
      "project",
      root,
      "--recover",
      "--transaction",
      publishedData.transaction,
    ]);
    assert(recoveredViews.exitCode === 0, recoveredViews.stderr);
    assert(
      (await runCli(["semantic", "project", root, "--check"])).exitCode ===
        0,
    );
    const beamFile = `${root}/.sigil/beams/route-choice.json`;
    await Deno.writeTextFile(`${beamFile}.orphan.tmp`, "partial\n");
    const beamStatus = await runCli([
      "semantic",
      "status",
      root,
      "--beam",
      "route-choice",
    ]);
    assert(beamStatus.exitCode === 1, beamStatus.stderr || beamStatus.stdout);
    assert(JSON.parse(beamStatus.stdout).stale === true);
    await Deno.remove(`${beamFile}.orphan.tmp`);
    for (const selector of [component, generatedComponent.id]) {
      const slice = await runCli([
        "semantic",
        "slice",
        root,
        "--component",
        selector,
        "--format",
        "text",
      ]);
      assert(slice.exitCode === 0, slice.stderr || slice.stdout);
    }
    const exported = await runCli([
      "semantic",
      "slice",
      root,
      "--component",
      component,
    ]);
    assert(exported.exitCode === 0, exported.stderr);
    const handoff = JSON.parse(exported.stdout).artifacts.handoff as string;
    const retained = await readCompileArtifact(root, "handoffs", handoff);
    assert(retained);
    const manifest = JSON.parse(retained!.files["handoff.json"]);
    const obligation = manifest.obligations.find((item: { subject: string }) =>
      item.subject === component
    );
    assert(obligation);
    returnedRoot = await Deno.makeTempDir();
    await copyTree(root, returnedRoot);
    submissionRoot = await Deno.makeTempDir();
    const appFingerprint = await digest(
      await Deno.readTextFile(`${returnedRoot}/app.ts`),
    );
    const claims = `${submissionRoot}/claims.ttl`;
    const locations = `${submissionRoot}/locations.json`;
    await Deno.writeTextFile(
      claims,
      `@prefix s: <https://sigil.dev/ontology/1#> .\n<urn:receipt:valid> a s:Evidence; s:covers <${obligation.id}>; s:from <${obligation.subject}>; s:relation "${obligation.relation}"; s:target <${obligation.target}>; s:expected ${obligation.expected} .`,
    );
    await Deno.writeTextFile(
      locations,
      JSON.stringify({
        version: 1,
        handoff,
        receipts: {
          "urn:receipt:valid": {
            locations: [{
              file: "app.ts",
              fingerprint: appFingerprint,
              symbol: "run",
            }],
          },
        },
      }),
    );
    const imported = await runCli([
      "semantic",
      "receipts",
      returnedRoot,
      "--handoff",
      handoff,
      "--handoff-root",
      root,
      "--claims",
      claims,
      "--locations",
      locations,
    ]);
    assert(imported.exitCode === 0, imported.stderr);
    const receiptId = JSON.parse(imported.stdout).artifacts.receipts as string;
    const verified = await runCli([
      "semantic",
      "verify",
      returnedRoot,
      "--handoff",
      handoff,
      "--handoff-root",
      root,
      "--receipts",
      receiptId,
    ]);
    assert(verified.exitCode === 0, verified.stderr || verified.stdout);
    const report = JSON.parse(verified.stdout);
    assert(report.status === "green");
    assert(
      report.receiptResults.some((item: { status: string }) =>
        item.status === "supported"
      ),
    );

    await Deno.writeTextFile(
      `${returnedRoot}/hidden.ts`,
      'import { bridge } from "./bridge.ts"; export const hidden = bridge();',
    );
    const prohibited = await runCli([
      "semantic",
      "verify",
      returnedRoot,
      "--handoff",
      handoff,
      "--handoff-root",
      root,
      "--receipts",
      receiptId,
    ]);
    assert(prohibited.exitCode === 1, prohibited.stderr || prohibited.stdout);
    const prohibitedReport = JSON.parse(prohibited.stdout);
    assert(prohibitedReport.status === "red");
    assert(
      prohibitedReport.receiptResults.some((item: { status: string }) =>
        item.status === "contradicted"
      ),
    );

    await Deno.writeTextFile(
      `${returnedRoot}/hidden.ts`,
      'const path = "./bridge.ts"; export const hidden = import(path);',
    );
    const opaque = await runCli([
      "semantic",
      "verify",
      returnedRoot,
      "--handoff",
      handoff,
      "--handoff-root",
      root,
      "--receipts",
      receiptId,
    ]);
    assert(opaque.exitCode === 1, opaque.stderr || opaque.stdout);
    const opaqueReport = JSON.parse(opaque.stdout);
    assert(opaqueReport.status === "yellow");
    assert(
      opaqueReport.receiptResults.some((item: { status: string }) =>
        item.status === "unresolved"
      ),
    );

    await Deno.writeTextFile(checkMarker, "fail\n");
    await Deno.writeTextFile(
      `${returnedRoot}/hidden.ts`,
      "export const value = 0;",
    );
    const failedCheck = await runCli([
      "semantic",
      "verify",
      returnedRoot,
      "--handoff",
      handoff,
      "--handoff-root",
      root,
      "--receipts",
      receiptId,
    ]);
    assert(
      failedCheck.exitCode === 1,
      failedCheck.stderr || failedCheck.stdout,
    );
    const failedCheckReport = JSON.parse(failedCheck.stdout);
    assert(failedCheckReport.status === "red");
    assert(
      failedCheckReport.checks.some((check: { id: string; passed: boolean }) =>
        check.id === "marker-check" && !check.passed
      ),
    );
    await Deno.remove(checkMarker);

    await Deno.writeTextFile(
      `${submissionRoot}/locations-decoy.json`,
      JSON.stringify({
        version: 1,
        handoff,
        receipts: {
          "urn:receipt:decoy": {
            locations: [{
              file: "app.ts",
              fingerprint: appFingerprint,
              symbol: "missing",
            }],
          },
        },
      }),
    );
    await Deno.writeTextFile(
      `${submissionRoot}/claims-decoy.ttl`,
      `@prefix s: <https://sigil.dev/ontology/1#> .\n<urn:receipt:decoy> a s:Evidence; s:covers <${obligation.id}>; s:from <${obligation.subject}>; s:relation "${obligation.relation}"; s:target <${obligation.target}>; s:expected ${obligation.expected} .`,
    );
    const importedDecoy = await runCli([
      "semantic",
      "receipts",
      returnedRoot,
      "--handoff",
      handoff,
      "--handoff-root",
      root,
      "--claims",
      `${submissionRoot}/claims-decoy.ttl`,
      "--locations",
      `${submissionRoot}/locations-decoy.json`,
    ]);
    assert(importedDecoy.exitCode === 0, importedDecoy.stderr);
    const decoyId = JSON.parse(importedDecoy.stdout).artifacts
      .receipts as string;
    const decoyReport = await runCli([
      "semantic",
      "verify",
      returnedRoot,
      "--handoff",
      handoff,
      "--handoff-root",
      root,
      "--receipts",
      decoyId,
    ]);
    assert(
      decoyReport.exitCode === 0,
      decoyReport.stderr || decoyReport.stdout,
    );
    const decoy = JSON.parse(decoyReport.stdout);
    assert(decoy.status === "green");
    assert(
      decoy.receiptResults.some((item: { status: string }) =>
        item.status === "unresolved"
      ),
    );
    const editedView = `${await Deno.readTextFile(
      `${root}/${generatedComponent.viewPath}`,
    )}\nEdited\n`;
    await Deno.writeTextFile(
      `${root}/${generatedComponent.viewPath}`,
      editedView,
    );
    const forgedReceiptPath = `${root}/.sigil/views/current.json`;
    const forgedReceipt = JSON.parse(
      await Deno.readTextFile(forgedReceiptPath),
    ) as { files: { path: string; contentHash: string }[] };
    const forgedFile = forgedReceipt.files.find((file) =>
      file.path === generatedComponent.viewPath
    );
    assert(forgedFile);
    forgedFile.contentHash = await digest(editedView);
    await Deno.writeTextFile(forgedReceiptPath, JSON.stringify(forgedReceipt));
    const drift = await runCli(["semantic", "project", root, "--check"]);
    assert(drift.exitCode === 1);
    const driftReport = JSON.parse(drift.stdout).views;
    assert(
      ["edited", "incomplete", "stale"].includes(driftReport.state) &&
        driftReport.differences.length > 0,
    );
    assert((await readSemanticState(root))?.revision === routeRevision);
  } finally {
    if (returnedRoot) await Deno.remove(returnedRoot, { recursive: true });
    if (submissionRoot) await Deno.remove(submissionRoot, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});
