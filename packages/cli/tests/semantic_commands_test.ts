import { parseSigilDocument } from "@qoherent/sigil-core";
import {
  compile,
  intentBase,
  projectSigilIntent,
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
async function fixture(ambiguous = false) {
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

Deno.test("semantic verify exposes native evidence and source receipts without persisting a verdict", async () => {
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
    assert(!await readSemanticState(root));
    const turtle = await runCli([
      "semantic",
      "verify",
      root,
      "--format",
      "turtle",
    ]);
    assert(turtle.exitCode === 0 && turtle.stdout.includes("Evidence"));
    await Deno.writeTextFile(
      `${root}/app.ts`,
      'export const value: number = "wrong";',
    );
    const red = await runCli(["semantic", "verify", root]);
    assert(red.exitCode === 1 && JSON.parse(red.stdout).status === "red");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
