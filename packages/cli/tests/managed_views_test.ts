import { assert, assertEquals } from "@std/assert";
import { parseSigilDocument } from "@qoherent/sigil-core";
import {
  compile,
  intentBase,
  projectSigilIntent,
  readManagedViewReceipt,
} from "@qoherent/sigil-compiler";
import { TurtleBuilder } from "../../compiler/src/semantic/builder.ts";
import { CoreAdapter } from "../src/core-adapter.ts";
import { runCli } from "../src/main.ts";

Deno.test("CLI installs canonical views and targets an unbound entity", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-managed-cli-" });
  try {
    await Deno.mkdir(`${root}/.sigil`);
    await Deno.writeTextFile(
      `${root}/.sigil/config.json`,
      JSON.stringify({
        sigilVersion: "0.7.0",
        workspace: { name: "managed-cli", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
    );
    await Deno.writeTextFile(
      `${root}/main.sigil`,
      `component Application {\n  goal {\n    Keep the application stable.\n  }\n  interface {\n    Serve requests.\n  }\n}\n`,
    );
    const resolved = await new CoreAdapter().resolveWorkspace(root);
    const intent = await projectSigilIntent(
      resolved.components,
      root,
      resolved.imports,
    );
    const prepared = await intentBase(
      intent.world,
      "Keep the application stable.",
    );
    const application = Object.values(intent.bindings).find((binding) =>
      !binding.unit
    )!.componentId;
    const contracts = [
      ...Object.entries(intent.bindings).filter(([, binding]) => binding.unit)
        .map(([id]) => id),
      prepared.contract,
    ];
    const builder = new TurtleBuilder().type("urn:Disk", "Capability")
      .type("urn:Extra", "Component")
      .value("urn:Extra", "label", "Extra");
    for (const contract of contracts) {
      builder.edge(application, "hasContract", contract)
        .edge(contract, "from", application)
        .value(contract, "relation", "uses")
        .edge(contract, "target", "urn:Disk")
        .value(contract, "expected", false);
    }
    const additions = builder.toString();
    const proposals = `${root}/proposals.json`;
    await Deno.writeTextFile(
      proposals,
      JSON.stringify({
        version: 1,
        candidates: [{ id: "accepted", additions, retractions: "" }],
      }),
    );
    const intentResult = await runCli([
      "semantic",
      "intent",
      root,
      "--text",
      "Keep the application stable.",
      "--proposals",
      proposals,
      "--beam",
      "accepted",
    ]);
    assertEquals(
      intentResult.exitCode,
      0,
      intentResult.stderr + intentResult.stdout,
    );
    const beams = await runCli([
      "semantic",
      "status",
      root,
      "--list",
      "beams",
    ]);
    assertEquals(beams.exitCode, 0, beams.stderr);
    assertEquals(JSON.parse(beams.stdout).items[0].id, "accepted");
    const accepted = await runCli([
      "semantic",
      "accept",
      root,
      "--beam",
      "accepted",
    ]);
    assertEquals(accepted.exitCode, 0, accepted.stderr);
    const revision = JSON.parse(accepted.stdout).revision as string;
    const written = await runCli([
      "semantic",
      "project",
      root,
      "--write",
      "--expected-revision",
      revision,
    ]);
    assertEquals(written.exitCode, 0, written.stderr);
    const receipt = await readManagedViewReceipt(root);
    assert(receipt);
    const extra = receipt.files.find((file) => file.entity === "urn:Extra");
    assert(extra);
    const parsed = parseSigilDocument(
      extra.path,
      await Deno.readTextFile(`${root}/${extra.path}`),
      {
        sigilVersion: "0.7.0",
      },
    );
    assertEquals(
      parsed.diagnostics.filter((item) => item.severity === "error"),
      [],
    );
    const checked = await runCli([
      "semantic",
      "project",
      root,
      "--check",
      "--format",
      "json",
    ]);
    assertEquals(checked.exitCode, 0, checked.stderr);
    const components = await runCli([
      "semantic",
      "status",
      root,
      "--list",
      "components",
    ]);
    assertEquals(components.exitCode, 0, components.stderr);
    const listed = JSON.parse(components.stdout) as {
      items: readonly { id: string; viewPath: string }[];
    };
    assert(listed.items.some((item) => item.id === "urn:Extra"));
    assert(
      listed.items.find((item) => item.id === "urn:Extra")!.viewPath ===
        extra.path,
    );
    const report = await compile(
      root,
      { kind: "component", componentName: "urn:Extra" },
      "standard",
      { focus: "design" },
    );
    assertEquals(report.target.kind, "component");
    assert(
      report.target.kind === "component" &&
        report.target.declarationPath === extra.path,
      JSON.stringify({ target: report.target, extra }),
    );
    assertEquals(report.semanticScope, { entities: ["urn:Extra"] });
    assertEquals(report.componentNames, [extra.componentName]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
