import {
  CodexAdapter,
  type CompilationEvent,
  compile,
  FileCompilationHistoryStore,
  MockAdapter,
} from "../src/mod.ts";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";

async function workspace(
  source: string,
  extraFiles: Readonly<Record<string, string>> = {},
  compileConfiguration?: unknown,
): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/.sigil`);
  await Deno.writeTextFile(
    `${root}/.sigil/config.json`,
    JSON.stringify({
      sigilVersion: "0.6.0",
      workspace: { name: "test", members: [] },
      files: { include: ["**/*.sigil"], exclude: [] },
      tools: compileConfiguration === undefined
        ? {}
        : { compile: compileConfiguration },
    }),
  );
  await Deno.writeTextFile(`${root}/main.sigil`, source);
  for (const [path, contents] of Object.entries(extraFiles)) {
    await Deno.writeTextFile(`${root}/${path}`, contents);
  }
  return root;
}

/*
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationInvocation interface
 * @sigil tests packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceDiscovery logic,cases
 */
Deno.test("compile discovers workspace config from a Sigil file path", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`);
  try {
    const report = await compile(
      `${root}/main.sigil`,
      { kind: "workspace" },
      { adapter: new MockAdapter() },
    );
    assertEquals(report.workspaceRoot, root.replaceAll("\\", "/"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationStatus logic,cases
Deno.test("standard profile becomes green only with complete warning-free evaluation", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`);
  try {
    const events: CompilationEvent[] = [];
    const report = await compile(root, { kind: "workspace" }, {
      adapter: new MockAdapter(),
      onEvent: (event) => {
        events.push(event);
      },
    });
    assertEquals(report.status, "green");
    assertEquals(
      report.stages.every((item) => item.state === "completed"),
      true,
    );
    assertEquals(events.at(-1)?.type, "completed");
    assertEquals(
      events.map((event) => event.sequence),
      events.map((_, i) => i + 1),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationStatus logic,cases
Deno.test("warnings produce yellow and errors produce red", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`);
  try {
    const warning = {
      code: "SEMANTIC_AMBIGUITY",
      severity: "warning" as const,
      message: "Boundary is unclear.",
      evidence: "The interface omits its result.",
      impact: "Consumers cannot rely on the operation.",
      correction: "Define the result.",
    };
    const yellow = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([warning]),
    });
    assertEquals(yellow.status, "yellow");
    const red = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([{ ...warning, severity: "error" }]),
    });
    assertEquals(red.status, "red");
    assertMatch(red.diagnostics[0].fingerprint, /^[a-f0-9]{64}$/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::StageConfiguration constraints,cases
Deno.test("critical-system adds risk evaluation without implementation stages", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {},
    {
      evaluators: {
        first: { provider: "codex" },
        second: { provider: "codex" },
      },
      profiles: {
        "critical-system": { evaluatorIds: ["first", "second"] },
      },
    },
  );
  try {
    const report = await compile(root, { kind: "workspace" }, {
      profile: "critical-system",
      adapters: [
        new MockAdapter([], "first"),
        new MockAdapter([], "second"),
      ],
    });
    assertEquals(
      report.stages.find((item) => item.id === "standards-risk")?.state,
      "completed",
    );
    assertEquals(
      report.stages.some((item) =>
        item.id.includes("implementation") ||
        item.id.includes("code-generation")
      ),
      false,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/compiler.sigil::SigilCompiler::StageConfiguration constraints,cases
Deno.test("critical-system configuration is optional until the profile is selected", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {},
    {
      evaluators: {
        unused: { provider: "unsupported" },
      },
    },
  );
  try {
    const standard = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
    });
    assertEquals(standard.status, "green");

    const events: CompilationEvent[] = [];
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, {
          profile: "critical-system",
          adapter: new MockAdapter(),
          onEvent: (event) => {
            events.push(event);
          },
        }),
      Error,
      "requires at least two distinct",
    );
    assertEquals(events.at(-1)?.type, "failed");
    assertEquals(
      events.at(-1)?.payload.code,
      "COMPILER_PROFILE_EVALUATORS_REQUIRED",
    );
    assertEquals(
      events.filter((event) =>
        ["completed", "failed", "cancelled"].includes(event.type)
      ).length,
      1,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/compiler.sigil::SigilCompiler::CompilationStatus constraints,cases
Deno.test("critical-system evaluator failure ends the run with the profile error", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {},
    {
      evaluators: {
        first: { provider: "codex" },
        second: { provider: "codex" },
      },
      profiles: {
        "critical-system": { evaluatorIds: ["first", "second"] },
      },
    },
  );
  try {
    const events: CompilationEvent[] = [];
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, {
          profile: "critical-system",
          requestedStage: "semantic-readiness",
          adapters: [
            new MockAdapter(() => {
              throw new Error("evaluator executable is unavailable");
            }, "first"),
            new MockAdapter([], "second"),
          ],
          onEvent: (event) => {
            events.push(event);
          },
        }),
      Error,
      "required critical-system evaluator",
    );
    assertEquals(events.at(-1)?.type, "failed");
    assertEquals(
      events.at(-1)?.payload.code,
      "COMPILER_PROFILE_EVALUATORS_REQUIRED",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/compiler.sigil::SigilCompiler::CompilationTarget logic,cases
Deno.test("location targets select enclosing components through expand files", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {
      "details.sigil": `expand Example {
  logic {
    The selected expansion belongs to Example.
  }
}
`,
    },
  );
  try {
    const report = await compile(root, {
      kind: "location",
      value: "details.sigil",
      line: 3,
      column: 8,
    }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
    });
    assertEquals(report.componentNames, ["Example"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/compiler.sigil::SigilCompiler::CompilationStatus logic,cases
Deno.test("independent evaluator disagreement is explicit", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {},
    {
      evaluators: {
        first: { provider: "codex" },
        second: { provider: "codex" },
      },
      profiles: {
        critical: {
          extends: "critical-system",
          evaluatorIds: ["first", "second"],
        },
      },
    },
  );
  try {
    const finding = {
      code: "SEMANTIC_AMBIGUITY",
      severity: "warning" as const,
      message: "The goal is ambiguous.",
      filePath: "main.sigil",
      line: 3,
      column: 5,
      evidence: "The goal lacks a measurable result.",
      impact: "Implementations may diverge.",
      correction: "State the expected result.",
    };
    const report = await compile(root, { kind: "workspace" }, {
      profile: "critical",
      requestedStage: "semantic-readiness",
      adapters: [
        new MockAdapter([finding], "first"),
        new MockAdapter([], "second"),
      ],
    });
    assertEquals(
      report.diagnostics.some((item) =>
        item.code === "COMPILER_EVALUATOR_DISAGREEMENT"
      ),
      true,
    );
    assertEquals(report.status, "yellow");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/compiler.sigil::SigilCompiler::CompilationHistory logic,cases
Deno.test("history derives unchanged, resolved, and regressed lifecycle", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`);
  const reports = new Map<string, Awaited<ReturnType<typeof compile>>>();
  const history = {
    read: (key: string) => Promise.resolve(reports.get(key)),
    write: (key: string, report: Awaited<ReturnType<typeof compile>>) => {
      reports.set(key, report);
      return Promise.resolve();
    },
  };
  const finding = {
    code: "SEMANTIC_AMBIGUITY",
    severity: "warning" as const,
    message: "The goal is ambiguous.",
    evidence: "The goal lacks a result.",
    impact: "Implementations may diverge.",
    correction: "State the result.",
  };
  try {
    const first = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding]),
      history,
    });
    assertEquals(
      first.diagnostics.find((item) => item.code === finding.code)?.lifecycle,
      "new",
    );
    const unchanged = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding]),
      history,
    });
    assertEquals(
      unchanged.diagnostics.find((item) => item.code === finding.code)
        ?.lifecycle,
      "unchanged",
    );
    const resolved = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
      history,
    });
    assertEquals(
      resolved.diagnostics.find((item) => item.code === finding.code)
        ?.lifecycle,
      "resolved",
    );
    assertEquals(resolved.status, "green");
    const regressed = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding]),
      history,
    });
    assertEquals(
      regressed.diagnostics.find((item) => item.code === finding.code)
        ?.lifecycle,
      "regressed",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/compiler.sigil::SigilCompiler::CompilationHistory constraints,cases
Deno.test("corrupt compilation history is ignored", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`);
  const historyDirectory = await Deno.makeTempDir();
  try {
    const key = "corrupt";
    await Deno.writeTextFile(
      `${historyDirectory}/${key}.json`,
      JSON.stringify({
        reportVersion: 2,
        runId: "prior",
        workspaceRoot: root,
        target: { kind: "workspace" },
        componentNames: ["Example"],
        status: "yellow",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        sourceFingerprint: "source",
        profile: { fingerprint: "profile" },
        stages: [],
        diagnostics: [null],
      }),
    );
    assertEquals(
      await new FileCompilationHistoryStore(historyDirectory).read(key),
      undefined,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(historyDirectory, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationTarget logic,cases
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::AgentAdapter logic,cases
 */
Deno.test("workspace evaluation sends minimal direct-read targets in dependency order", async () => {
  const source = `@z-dependency.sigil import { Dependency }

component Consumer {
  goal {
    Consume the dependency.
  }

  interface {
    ConsumerOperation {
      run(input: Dependency)
    }
  }
}
`;
  const dependency = `component Dependency {
  goal {
    Provide a dependency.
  }

  interface {
    DependencyValue {
      value: string
    }
  }
}
`;
  const implementation = `// @sigil implements main.sigil::Consumer interface
export function consume(): void {}
${"// SECRET_SOURCE_MARKER_72D9\n".repeat(45_000)}`;
  const root = await workspace(source, {
    "z-dependency.sigil": dependency,
    "consumer.ts": implementation,
  });
  try {
    const observed: {
      stage: string;
      component: string;
      length: number;
      sigilFile: string;
      serialized: string;
      skill: string;
    }[] = [];
    const report = await compile(root, { kind: "workspace" }, {
      adapter: new MockAdapter((request) => {
        const serialized = JSON.stringify(request);
        observed.push({
          stage: request.stage,
          component: request.target.componentName,
          length: serialized.length,
          sigilFile: request.target.sigilFile,
          serialized,
          skill: request.skill,
        });
        return [];
      }),
    });

    assertEquals(report.status, "green");
    assertEquals(observed.length, 6);
    assertEquals(
      observed.map((item) => `${item.stage}:${item.component}`),
      [
        "semantic-readiness:Dependency",
        "semantic-readiness:Consumer",
        "architecture-design:Dependency",
        "architecture-design:Consumer",
        "current-code-compatibility:Dependency",
        "current-code-compatibility:Consumer",
      ],
    );
    assertEquals(
      observed.every((item) => item.length <= 900_000),
      true,
    );
    assertEquals(
      observed.every((item) => !item.serialized.includes("function consume")),
      true,
    );
    assertEquals(
      observed.every((item) =>
        !item.serialized.includes("SECRET_SOURCE_MARKER_72D9")
      ),
      true,
    );
    assertEquals(
      observed.find((item) => item.component === "Consumer")?.sigilFile,
      "main.sigil",
    );
    assertMatch(observed[0].skill, /Determine whether the selected component/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationProfile interface,logic
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::StageConfiguration constraints,cases
 */
Deno.test("stage selection runs the exact dependency closure", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }
}
`);
  try {
    const report = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
    });
    assertEquals(report.requestedStage, "semantic-readiness");
    assertEquals(
      report.stages.map((stage) => stage.id),
      ["deterministic-foundation", "semantic-readiness"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::DiagnosticSemanticSubject interface
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationDiagnostic logic,constraints
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationReport cases
 */
Deno.test("diagnostics resolve direct units with concept and section fallbacks", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    Read {
      read()
    }
  }
}
`,
    {
      "README.md": "Unowned documentation.\n",
    },
  );
  try {
    const report = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([
        finding("unit", "main.sigil", 8),
        finding("section", "main.sigil", 6),
        finding("empty", "README.md", 1),
      ]),
    });
    assertEquals(report.reportVersion, 2);
    const unit = report.diagnostics.find((item) => item.message === "unit")!;
    assertEquals(unit.semanticSubjects.length, 1);
    assertEquals(unit.semanticSubjects[0].relation, "direct");
    assertEquals(unit.semanticSubjects[0].componentName, "Example");
    assertEquals(unit.semanticSubjects[0].sectionName, "interface");
    assertEquals(unit.semanticSubjects[0].conceptIdentifier, "Read");
    assertEquals(unit.semanticSubjects[0].semanticUnit?.range.start.line, 8);
    assertMatch(
      unit.semanticSubjects[0].semanticUnit?.fingerprint ?? "",
      /^[a-f0-9]{64}$/,
    );

    const section = report.diagnostics.find((item) =>
      item.message === "section"
    )!;
    assertEquals(section.semanticSubjects[0].sectionName, "interface");
    assertEquals(section.semanticSubjects[0].conceptIdentifier, undefined);
    assertEquals(section.semanticSubjects[0].semanticUnit, undefined);

    const empty = report.diagnostics.find((item) => item.message === "empty")!;
    assertEquals(empty.semanticSubjects, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::DiagnosticSemanticSubject interface
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationDiagnostic logic
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationReport cases
 */
Deno.test("implementation findings resolve every governing ownership target", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    Read {
      read()
    }
  }

  logic {
    Reading {
      Read the value.
    }
  }
}
`,
    {
      "implementation.ts": `/*
 * @sigil implements main.sigil::Example::Read interface
 * @sigil implements main.sigil::Example logic
 */
export function read(): void {}
`,
    },
  );
  try {
    const report = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([
        finding("governing", "implementation.ts", 5),
      ]),
    });
    const subjects = report.diagnostics.find((item) =>
      item.message === "governing"
    )!.semanticSubjects;
    assertEquals(
      subjects.map((subject) => ({
        relation: subject.relation,
        section: subject.sectionName,
        concept: subject.conceptIdentifier,
      })),
      [
        { relation: "governing", section: "interface", concept: "Read" },
        { relation: "governing", section: "logic", concept: undefined },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationDiagnostic logic
 * @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationReport cases
 */
Deno.test("semantic-unit fingerprints survive formatting-only wrapping", async () => {
  const compact = await workspace(`component Example {
  goal {
    Explain the same normalized semantic unit.
  }

  interface {
    Read {
      read()
    }
  }
}
`);
  const wrapped = await workspace(`component Example {
  goal {
    Explain the same normalized
    semantic unit.
  }

  interface {
    Read {
      read()
    }
  }
}
`);
  try {
    const first = await compile(compact, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding("compact", "main.sigil", 3)]),
    });
    const second = await compile(wrapped, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding("wrapped", "main.sigil", 3)]),
    });
    assertEquals(
      first.diagnostics.find((item) => item.message === "compact")
        ?.semanticSubjects[0].semanticUnit?.fingerprint,
      second.diagnostics.find((item) => item.message === "wrapped")
        ?.semanticSubjects[0].semanticUnit?.fingerprint,
    );
  } finally {
    await Deno.remove(compact, { recursive: true });
    await Deno.remove(wrapped, { recursive: true });
  }
});

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationProfile interface,logic
Deno.test("workspace configuration overrides compiler execution budgets", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }
}
`,
    {},
    {
      budgets: { maxCommandOutputChars: 500_000 },
    },
  );
  try {
    let observedBudget = 0;
    const report = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter((request) => {
        observedBudget = request.budgets.maxCommandOutputChars;
        return [];
      }),
    });
    assertEquals(observedBudget, 500_000);
    assertEquals(
      report.profile.executionBudgets.maxCommandOutputChars,
      500_000,
    );
    assertEquals(report.profile.executionBudgets.maxCommands, 64);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::ProfileConfiguration constraints
Deno.test("invalid compiler execution budgets fail before evaluation", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }
}
`,
    {},
    {
      budgets: { maxCommandOutputChars: 10_000_001 },
    },
  );
  try {
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, {
          requestedStage: "semantic-readiness",
          adapter: new MockAdapter(),
        }),
      Error,
      "must be a positive integer no greater than 10000000",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::EvaluationSkillPackage constraints,cases
Deno.test("undeclared evaluator rules fail the stage without affecting color directly", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }
}
`);
  try {
    const report = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([{
        code: "INVENTED_RULE",
        severity: "error",
        message: "Unsupported.",
        evidence: "None.",
        impact: "None.",
        correction: "None.",
      }]),
    });
    assertEquals(report.status, "red");
    assertEquals(
      report.diagnostics.some((item) => item.code === "INVENTED_RULE"),
      false,
    );
    assertEquals(
      report.diagnostics.some((item) =>
        item.code === "COMPILER_EVALUATOR_INCOMPLETE"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::AgentAdapter interface,logic,cases
Deno.test("Codex adapter enforces direct-read invocation and records structured trace", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }
}
`);
  try {
    let observedArgs: readonly string[] = [];
    let observedPrompt = "";
    const adapter = new CodexAdapter(undefined, (_command, args, input) => {
      observedArgs = args;
      observedPrompt = input;
      return Promise.resolve([
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "command_execution",
            command:
              '/bin/zsh -lc "rg -n \\"SigilCompiler|sigil compile|compile\\\\(\\" packages/compiler packages/cli\nsed -n \\"1,240p\\" packages/compiler/src/compiler.sigil"',
            status: "completed",
            exit_code: 0,
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({ findings: [] }),
          },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 100, output_tokens: 5 },
        }),
      ].join("\n"));
    });
    const result = await adapter.evaluate({
      stage: "semantic-readiness",
      skill: "Inspect files.",
      allowedRules: ["SEMANTIC_AMBIGUITY"],
      workspaceRoot: root,
      target: {
        componentName: "Example",
        sigilFile: "main.sigil",
        initialPaths: ["main.sigil"],
      },
      capabilities: {
        workspaceAccess: "read-only",
        network: false,
        approvalEscalation: false,
        ephemeral: true,
        allowedCommands: ["sigil check"],
        forbiddenCommands: ["sigil compile"],
      },
      budgets: {
        elapsedTimeMs: 30_000,
        maxCommands: 10,
        maxCommandOutputChars: 10_000,
        maxInputTokens: 1_000,
        maxOutputTokens: 100,
      },
    });
    assertEquals(observedArgs.includes("--ephemeral"), true);
    assertEquals(observedArgs.includes("read-only"), true);
    assertEquals(observedArgs[observedArgs.indexOf("-C") + 1], root);
    assertEquals(observedArgs.includes("--json"), true);
    assertMatch(observedPrompt, /Inspect the workspace directly/);
    assertMatch(
      observedPrompt,
      /point into the\s+smallest exact source statement/,
    );
    assertMatch(
      observedPrompt,
      /For a conflict, anchor the primary statement/,
    );
    assertMatch(
      observedPrompt,
      /compiler owns semantic identity; do not invent\s+semantic subjects/,
    );
    assertMatch(result.commands[0].command, /rg -n/);
    assertEquals(result.usage?.inputTokens, 100);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::AgentAdapter interface,logic,cases
Deno.test("Codex adapter rejects an actually invoked nested compilation", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }
}
`);
  try {
    const adapter = new CodexAdapter(undefined, () =>
      Promise.resolve([
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "command_execution",
            command:
              '/bin/zsh -lc "rg -n \\"compile\\" packages/compiler\nsigil compile ."',
            status: "completed",
            exit_code: 0,
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({ findings: [] }),
          },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 100, output_tokens: 5 },
        }),
      ].join("\n")));
    await assertRejects(
      () =>
        adapter.evaluate({
          stage: "semantic-readiness",
          skill: "Inspect files.",
          allowedRules: ["SEMANTIC_AMBIGUITY"],
          workspaceRoot: root,
          target: {
            componentName: "Example",
            sigilFile: "main.sigil",
            initialPaths: ["main.sigil"],
          },
          capabilities: {
            workspaceAccess: "read-only",
            network: false,
            approvalEscalation: false,
            ephemeral: true,
            allowedCommands: ["rg", "sigil check"],
            forbiddenCommands: ["sigil compile"],
          },
          budgets: {
            elapsedTimeMs: 30_000,
            maxCommands: 10,
            maxCommandOutputChars: 10_000,
            maxInputTokens: 1_000,
            maxOutputTokens: 100,
          },
        }),
      Error,
      "violated the read-only inspection contract",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function finding(
  message: string,
  filePath: string,
  line: number,
) {
  return {
    code: "SEMANTIC_AMBIGUITY",
    severity: "warning" as const,
    message,
    filePath,
    line,
    evidence: `${filePath}:${line}`,
    impact: "The contract is ambiguous.",
    correction: "Clarify the contract.",
  };
}
