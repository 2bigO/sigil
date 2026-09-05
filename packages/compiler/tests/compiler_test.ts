import {
  type CompilationEvent,
  type CompilationHistoryStore,
  type CompilationReport,
  compile,
  CompilerFailure,
  MockAdapter,
  parseSemanticWorld,
  projectSigilIntent,
  readSemanticState,
  serializeSemanticWorld,
  validateCompilationEventStream,
  writeSemanticState,
} from "../src/mod.ts";
import { TurtleBuilder } from "../src/semantic/builder.ts";
import {
  loadSigilWorkspace,
  resolveSigilWorkspace,
  type SigilFileSystem,
} from "@qoherent/sigil-core";
import { assert, assertEquals, assertRejects } from "@std/assert";

const SOURCE = `component Example {
  goal {
    Avoid disk access.
  }
  interface {
    ReadOnly {
      Perform no disk access.
    }
  }
}
`;

async function workspace(
  source = SOURCE,
  files: Record<string, string> = {},
  compileConfiguration: unknown = {},
): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/.sigil`);
  await Deno.writeTextFile(
    `${root}/.sigil/config.json`,
    JSON.stringify({
      sigilVersion: "0.7.0",
      workspace: { name: "test", members: [] },
      files: { include: ["**/*.sigil"], exclude: [] },
      tools: { compile: compileConfiguration },
    }),
  );
  await Deno.writeTextFile(`${root}/main.sigil`, source);
  for (const [path, contents] of Object.entries(files)) {
    await Deno.writeTextFile(`${root}/${path}`, contents);
  }
  return root;
}

const fs: SigilFileSystem = {
  readTextFile: (path) => Deno.readTextFile(path),
  async exists(path) {
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  },
  async listFiles(root) {
    const paths: string[] = [];
    async function visit(path: string) {
      for await (const entry of Deno.readDir(path)) {
        if (entry.isDirectory) await visit(`${path}/${entry.name}`);
        else paths.push(`${path}/${entry.name}`);
      }
    }
    await visit(root);
    return paths.sort();
  },
};

async function interpretation(root: string) {
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: root }),
  );
  const intent = await projectSigilIntent(
    resolved.components,
    root,
    resolved.imports,
  );
  const builder = new TurtleBuilder();
  for (const [id, binding] of Object.entries(intent.bindings)) {
    if (!binding.unit) continue;
    builder.edge(id, "from", binding.componentId).value(id, "relation", "uses")
      .edge(id, "target", "urn:test:Disk").value(id, "expected", false);
  }
  const additions = builder.toString();
  const world = await parseSemanticWorld([{
    sourceId: "source",
    turtle: serializeSemanticWorld(intent.world),
  }, { sourceId: "interpretation", turtle: additions }]);
  const componentIds = Object.entries(intent.bindings).filter(([, b]) =>
    !b.unit
  ).map(([id]) => id);
  return {
    intent,
    world,
    componentIds,
    documents: [{ sourceId: "interpretation", turtle: additions }],
  };
}

Deno.test("ordinary compilation uses egglog and never invokes an LLM judge", async () => {
  const root = await workspace();
  try {
    let calls = 0;
    const events: CompilationEvent[] = [];
    const report = await compile(root, { kind: "workspace" }, "standard", {
      adapter: new MockAdapter(() => {
        calls++;
        throw new Error("Judge must not run");
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });
    assertEquals(calls, 0);
    assertEquals(report.status, "yellow");
    assertEquals(report.profile.evaluators, []);
    assert(report.profile.stages.every((s) => !s.agentic));
    assertEquals(report.stages.map((s) => s.id), [
      "deterministic-foundation",
      "semantic-closure",
      "implementation-coverage",
    ]);
    assert(
      report.diagnostics.some((d) =>
        d.message.includes("Avoid disk access") &&
        d.semanticSubjects.length > 0 &&
        d.evidence.includes("required-contract-interpretation")
      ),
    );
    const validated = await validateCompilationEventStream(
      (async function* () {
        for (const event of events) {
          yield new TextEncoder().encode(JSON.stringify(event) + "\n");
        }
      })(),
      {
        operation: "one-shot-compilation",
        stageIdentities: report.stages.map((s) => s.id),
      },
      new AbortController().signal,
    );
    assertEquals(validated.kind, "terminal");
    assertEquals(events.at(-1)?.type, "completed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Turtle interpretations produce deterministic green, yellow and red", async () => {
  const root = await workspace();
  try {
    const input = await interpretation(root);
    const green = await compile(root, { kind: "workspace" }, "standard", {
      focus: "design",
      semanticDocuments: input.documents,
    });
    assertEquals(green.status, "green");
    assertEquals(green.requestedStage, "semantic-closure");
    const red = await compile(root, { kind: "workspace" }, "standard", {
      focus: "design",
      semanticDocuments: [...input.documents, {
        sourceId: "conflict",
        turtle: new TurtleBuilder().edge(
          input.componentIds[0],
          "uses",
          "urn:test:Disk",
        ).toString(),
      }],
    });
    assertEquals(red.status, "red");
    assert(
      red.diagnostics.some((d) =>
        d.code === "negative-contract" &&
        d.evidence.includes("contract-proposition")
      ),
    );
    assertEquals(
      (await compile(root, { kind: "workspace" }, "standard", {
        focus: "design",
      })).status,
      "yellow",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("implementation focus requires evidence even when its specification is green", async () => {
  const root = await workspace();
  try {
    const input = await interpretation(root);
    const options = {
      focus: "implementation" as const,
      semanticDocuments: input.documents,
    };
    assertEquals(
      (await compile(root, { kind: "workspace" }, "standard", options)).status,
      "yellow",
    );
    const semanticEngine = {
      completeScopes: input.componentIds.map((subject) => ({
        subject,
        predicate: "uses",
        evidence: "test:complete-static-observation",
      })),
    };
    const green = await compile(root, { kind: "workspace" }, "standard", {
      ...options,
      semanticEngine,
    });
    assertEquals(green.status, "green");
    const red = await compile(root, { kind: "workspace" }, "standard", {
      ...options,
      semanticEngine: {
        ...semanticEngine,
        observations: [{
          subject: input.componentIds[0],
          predicate: "uses",
          object: "urn:test:Disk",
          evidence: "test:observed-disk-call",
        }],
      },
    });
    assertEquals(red.status, "red");
    assert(
      red.diagnostics.some((d) => d.code === "implementation-prohibition"),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("structural errors skip dependent semantic stages without launching the engine", async () => {
  const root = await workspace(
    "component Broken {\n  goal {\n    Missing interface.\n  }\n}\n",
  );
  try {
    const report = await compile(root, { kind: "workspace" }, "standard", {
      semanticEngine: { binaryPath: "/missing-engine" },
    });
    assertEquals(report.status, "red");
    assert(
      report.stages.slice(1).every((s) => s.state === "skipped-by-dependency"),
    );
    assert(
      report.diagnostics.some((d) => d.stage === "deterministic-foundation"),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("invalid ontology is a semantic error and operational engine failure rejects", async () => {
  const root = await workspace();
  try {
    const red = await compile(root, { kind: "workspace" }, "standard", {
      semanticDocuments: [{
        sourceId: "invalid",
        turtle: "<urn:A> <urn:qualityScore> 1 .",
      }],
    });
    assertEquals(red.status, "red");
    assert(red.diagnostics.some((d) => d.code === "UNKNOWN_PREDICATE"));
    const events: CompilationEvent[] = [];
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "standard", {
          semanticEngine: { binaryPath: "/missing-engine" },
          onEvent: (event) => {
            events.push(event);
          },
        }),
      Error,
      "Cannot start",
    );
    assertEquals(events.at(-1)?.type, "failed");
    assert(!events.some((e) => e.type === "completed"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("invalid targets, profiles and disabled invariants reject before event binding", async () => {
  const root = await workspace();
  try {
    let events = 0;
    const onEvent = () => {
      events++;
    };
    await assertRejects(
      () =>
        compile(
          root,
          { kind: "component", componentName: "Absent" },
          "standard",
          { onEvent },
        ),
      CompilerFailure,
      "Absent",
    );
    await assertRejects(
      () => compile(root, { kind: "workspace" }, "absent", { onEvent }),
      CompilerFailure,
      "Unknown compilation profile",
    );
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "standard", {
          onEvent,
          requestedStage: "absent",
        }),
      CompilerFailure,
      "Unknown compilation stage",
    );
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "standard", {
          onEvent,
          requestedStage: "semantic-closure",
          focus: "design",
        }),
      CompilerFailure,
      "mutually exclusive",
    );
    assertEquals(events, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
  const disabled = await workspace(SOURCE, {}, {
    profiles: { standard: { disabledStages: ["architecture-design"] } },
  });
  try {
    await assertRejects(
      () => compile(disabled, { kind: "workspace" }, "standard"),
      CompilerFailure,
      "cannot be disabled",
    );
  } finally {
    await Deno.remove(disabled, { recursive: true });
  }
});

Deno.test("source paths, exact components and expansion locations retain target selection", async () => {
  const root = await workspace(SOURCE + SOURCE.replaceAll("Example", "Other"), {
    "extra.sigil":
      "@main.sigil import { Example }\n\nexpand Example {\n  logic {\n    ReadOnly {\n      Never access the disk.\n    }\n  }\n}\n",
  });
  try {
    const bySource = await compile(
      `${root}/main.sigil`,
      { kind: "component", componentName: "Example" },
      "standard",
      { exactTarget: true, focus: "design" },
    );
    assertEquals(bySource.componentNames, ["Example"]);
    assertEquals(
      bySource.workspaceRoot.replaceAll("\\", "/"),
      root.replaceAll("\\", "/"),
    );
    const byLocation = await compile(
      root,
      { kind: "location", filePath: "extra.sigil", line: 6, column: 7 },
      "standard",
      { exactTarget: true, focus: "design" },
    );
    assertEquals(byLocation.componentNames, ["Example"]);
    assert(!byLocation.diagnostics.some((d) => d.message.startsWith("Other ")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("stage aliases preserve dependency closure without evaluator configuration", async () => {
  const root = await workspace(SOURCE, {}, {
    evaluators: { unavailable: { provider: "absent" } },
    profiles: {
      critical: { extends: "critical-system", evaluatorIds: ["unavailable"] },
    },
  });
  try {
    const report = await compile(root, { kind: "workspace" }, "critical", {
      requestedStage: "architecture-design",
    });
    assertEquals(report.stages.map((s) => s.id), [
      "deterministic-foundation",
      "semantic-closure",
    ]);
    assertEquals(report.status, "yellow");
    const foundation = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "deterministic-foundation",
    });
    assertEquals(foundation.stages.length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("semantic diagnostic history resolves and regresses by stable proposition identity", async () => {
  const root = await workspace();
  try {
    let previous: CompilationReport | undefined;
    const history: CompilationHistoryStore = {
      read: () => Promise.resolve(previous),
      write: (_key, report) => {
        previous = report;
        return Promise.resolve();
      },
    };
    const options = { focus: "design" as const, history };
    const first = await compile(
      root,
      { kind: "workspace" },
      "standard",
      options,
    );
    assert(first.diagnostics.some((d) => d.lifecycle === "new"));
    const unchanged = await compile(
      root,
      { kind: "workspace" },
      "standard",
      options,
    );
    assert(
      unchanged.diagnostics.filter((d) => d.code === "unresolved-obligation")
        .every((d) => d.lifecycle === "unchanged"),
    );
    const resolved = await compile(root, { kind: "workspace" }, "standard", {
      ...options,
      semanticDocuments: (await interpretation(root)).documents,
    });
    assertEquals(resolved.status, "green");
    assert(resolved.diagnostics.some((d) => d.lifecycle === "resolved"));
    const regressed = await compile(
      root,
      { kind: "workspace" },
      "standard",
      options,
    );
    assert(regressed.diagnostics.some((d) => d.lifecycle === "regressed"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("history failure remains non-authoritative after completed settlement", async () => {
  const root = await workspace();
  try {
    const order: string[] = [];
    const report = await compile(root, { kind: "workspace" }, "standard", {
      focus: "design",
      semanticDocuments: (await interpretation(root)).documents,
      history: {
        read: () => Promise.resolve(undefined),
        write: () => {
          order.push("history");
          throw new Error("history unavailable");
        },
      },
      onEvent: (e) => {
        if (e.type === "completed") order.push("completed");
      },
      hostWarningSink: () => {
        order.push("warning");
      },
    });
    assertEquals(report.status, "green");
    assertEquals(order, ["completed", "history", "warning"]);
    const noHistory = await compile(root, { kind: "workspace" }, "standard", {
      noHistory: true,
      history: {
        read: () => {
          throw new Error("must not read");
        },
        write: () => {
          throw new Error("must not write");
        },
      },
    });
    assertEquals(noHistory.status, "yellow");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("report export preserves atomic outside-workspace output and cancellation", async () => {
  const root = await workspace();
  const output = await Deno.makeTempFile({ suffix: ".md" });
  try {
    const report = await compile(root, { kind: "workspace" }, "standard", {
      focus: "design",
      semanticDocuments: (await interpretation(root)).documents,
      reportExport: output,
      reportExportRepresentation: "markdown",
    });
    assertEquals(report.status, "green");
    assert((await Deno.readTextFile(output)).includes("GREEN"));
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "standard", {
          output: `${root}/report.json`,
        }),
      CompilerFailure,
    );
    await Deno.writeTextFile(output, "untouched");
    await assertRejects(() =>
      compile(root, { kind: "workspace" }, "standard", {
        output,
        signal: AbortSignal.abort(),
      })
    );
    assertEquals(await Deno.readTextFile(output), "untouched");
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(output);
  }
});

Deno.test("semantic source identity survives formatting-only wrapping", async () => {
  const a = await workspace(
    SOURCE.replace(
      "Avoid disk access.",
      "Avoid disk access while keeping every operation deterministic.",
    ),
  );
  const b = await workspace(
    SOURCE.replace(
      "Avoid disk access.",
      "Avoid disk access while keeping\n    every operation deterministic.",
    ),
  );
  try {
    const left = await compile(a, { kind: "workspace" }, "standard", {
      focus: "design",
    });
    const right = await compile(b, { kind: "workspace" }, "standard", {
      focus: "design",
    });
    assertEquals(
      left.diagnostics.map((d) => d.fingerprint).sort(),
      right.diagnostics.map((d) => d.fingerprint).sort(),
    );
  } finally {
    await Deno.remove(a, { recursive: true });
    await Deno.remove(b, { recursive: true });
  }
});

Deno.test("canonical state is recomputed and invalidated by changed source", async () => {
  const root = await workspace();
  try {
    const input = await interpretation(root);
    const receipt = {
      version: 1 as const,
      worldFingerprint: input.world.fingerprint,
      sourceFingerprint: input.intent.world.fingerprint,
      componentBindings: Object.fromEntries(
        input.componentIds.map((id) => [id, id]),
      ),
    };
    await writeSemanticState(root, { world: input.world, receipt });
    assertEquals(
      (await readSemanticState(root))?.world.fingerprint,
      input.world.fingerprint,
    );
    assertEquals(
      (await compile(root, { kind: "workspace" }, "standard", {
        focus: "design",
      })).status,
      "green",
    );
    await assertRejects(
      () => writeSemanticState(root, { world: input.world, receipt }),
      Error,
      "changed",
    );
    await Deno.writeTextFile(
      `${root}/main.sigil`,
      SOURCE.replace("Avoid disk access.", "Allow disk access."),
    );
    const stale = await compile(root, { kind: "workspace" }, "standard", {
      focus: "design",
    });
    assertEquals(stale.status, "yellow");
    assert(stale.diagnostics.some((d) => d.code === "SEMANTIC_SOURCE_CHANGED"));
    await Deno.writeTextFile(`${root}/.sigil/world/current.json`, "{bad");
    const corrupt = await compile(root, { kind: "workspace" }, "standard");
    assertEquals(corrupt.status, "red");
    assert(
      corrupt.diagnostics.some((d) => d.code === "INVALID_SEMANTIC_STATE"),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("compiler budgets validate before stages and remain in the profile", async () => {
  const root = await workspace(SOURCE, {}, {
    budgets: { elapsedTimeMs: 2000 },
    limits: { maxAgentInputChars: 5000 },
  });
  try {
    const report = await compile(root, { kind: "workspace" }, "standard", {
      focus: "design",
    });
    assertEquals(report.profile.executionBudgets.elapsedTimeMs, 2000);
    assertEquals(report.profile.agentInputBudgetChars, 5000);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
  const invalid = await workspace(SOURCE, {}, {
    budgets: { elapsedTimeMs: -1 },
  });
  try {
    await assertRejects(
      () => compile(invalid, { kind: "workspace" }, "standard"),
      Error,
      "positive safe integer",
    );
  } finally {
    await Deno.remove(invalid, { recursive: true });
  }
});

Deno.test("repeated source requirements retain every physical origin", async () => {
  const root = await workspace(
    SOURCE.replace(
      "    Avoid disk access.",
      "    Avoid disk access.\n\n    Avoid disk access.",
    ),
  );
  try {
    const input = await interpretation(root);
    const binding = Object.values(input.intent.bindings).find((b) =>
      b.unit?.prose === "Avoid disk access."
    );
    assert(binding);
    assert(binding.additionalLocations);
    assertEquals(binding.additionalLocations.length, 1);
    assert(
      binding.additionalLocations[0].range.start.line >
        binding.range.start.line,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("custom cancellation reasons preserve the compiler cancellation contract", async () => {
  const root = await workspace();
  const cancellation = new AbortController();
  const events: CompilationEvent[] = [];
  try {
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "standard", {
          signal: cancellation.signal,
          onEvent: (event) => {
            events.push(event);
            if (event.type === "stage-started") cancellation.abort("stop now");
          },
        }),
      CompilerFailure,
      "cancelled",
    );
    assertEquals(events.at(-1)?.type, "cancelled");
    assert(!events.some((event) => event.type === "completed"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test({
  name: "configured elapsed budget bounds native execution and emits failed",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await workspace(SOURCE, {}, {
      budgets: { elapsedTimeMs: 100 },
    });
    const events: CompilationEvent[] = [];
    try {
      const executable = `${root}/engine`;
      await Deno.writeTextFile(executable, "#!/bin/sh\nwhile :; do :; done\n", {
        mode: 0o700,
      });
      await assertRejects(
        () =>
          compile(root, { kind: "workspace" }, "standard", {
            semanticEngine: { binaryPath: executable, timeoutMs: 30_000 },
            onEvent: (event) => {
              events.push(event);
            },
          }),
        DOMException,
      );
      assertEquals(events.at(-1)?.type, "failed");
      assert(!events.some((event) => event.type === "completed"));
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test("ordinary implementation compilation collects native evidence from host policy", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Call the bridge.
  }
  interface {
    Bridge {
      Call the bridge.
    }
  }
}
`,
    {
      "app.ts":
        '// @sigil implements main.sigil::Example logic\nimport { bridge } from "./bridge.ts"; export const value = bridge(5);',
      "bridge.ts":
        "export function bridge(value: number): number { return value; }",
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "nodenext",
          target: "es2022",
          allowImportingTsExtensions: true,
        },
        files: ["app.ts", "bridge.ts"],
      }),
    },
  );
  try {
    const resolved = resolveSigilWorkspace(
      await loadSigilWorkspace(fs, { startPath: root }),
    );
    const projected = await projectSigilIntent(
      resolved.components,
      root,
      resolved.imports,
    );
    const component = Object.values(projected.bindings).find((binding) =>
      !binding.unit
    )!.componentId;
    const builder = new TurtleBuilder().edge(
      component,
      "invokes",
      "urn:test:Bridge",
    );
    for (const [id, binding] of Object.entries(projected.bindings)) {
      if (binding.unit) {
        builder.edge(id, "from", component).value(id, "relation", "invokes")
          .edge(id, "target", "urn:test:Bridge").value(id, "expected", true);
      }
    }
    await Deno.writeTextFile(
      `${root}/.sigil/implementation.json`,
      JSON.stringify({
        version: 1,
        project: "tsconfig.json",
        components: [{ entity: component, files: ["app.ts"] }],
        targets: [{
          entity: "urn:test:Bridge",
          declarations: [{ file: "bridge.ts", symbol: "bridge" }],
        }],
      }),
    );
    const options = {
      focus: "implementation" as const,
      disableHistory: true,
      semanticDocuments: [{
        sourceId: "interpretation",
        turtle: builder.toString(),
      }],
    };
    const events: CompilationEvent[] = [];
    const green = await compile(root, { kind: "workspace" }, "standard", {
      ...options,
      onEvent: (event) => {
        events.push(event);
      },
    });
    assertEquals(green.status, "green");
    assertEquals(events.at(-1)?.type, "completed");
    await Deno.writeTextFile(
      `${root}/app.ts`,
      'import { bridge } from "./bridge.ts"; export const value = bridge("wrong");',
    );
    const failed = await compile(
      root,
      { kind: "workspace" },
      "standard",
      options,
    );
    assertEquals(failed.status, "red");
    assert(
      failed.diagnostics.some((diagnostic) =>
        diagnostic.code === "failed-mechanical-check" &&
        diagnostic.evidence.includes("2345")
      ),
    );
    await Deno.writeTextFile(`${root}/app.ts`, "export const value = 5;");
    assertEquals(
      (await compile(root, { kind: "workspace" }, "standard", options)).status,
      "yellow",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
