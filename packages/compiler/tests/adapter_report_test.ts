import {
  AdapterFailure,
  compilationColor,
  type CompilationReport,
  createAdapterSubprocessHandle,
  deriveBudgetOutcome,
  FileCompilationHistoryStore,
  loadEvaluationSkill,
  loadEvaluationSkills,
  MockAdapter,
  openCompilationEventWriter,
  renderCompilationReportMarkdown,
  resolveAdapterRegistration,
  runAdapterSubprocess,
  validateAgentEvaluationResult,
  validateCompilationEventStream,
} from "../src/mod.ts";
import { deriveEvaluatorRetrievalBrief } from "../src/evaluator-retrieval.ts";
import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from "@std/assert";

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
      sigilVersion: "0.7.0",
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

function retrievalFixture(
  purpose: "semantic" | "architecture" | "implementation" = "semantic",
) {
  return {
    schema: "sigil-purpose-retrieval/v1",
    policyVersion: 1,
    workspaceSnapshotIdentity: "sha256:test-snapshot",
    target: {
      kind: "component",
      componentName: "Example",
      pathStatus: "accepted",
      path: "main.sigil",
    },
    purpose,
    graph: { nodes: [], edges: [] },
    evidence: [],
    inclusionReasons: [],
    exclusions: [],
    context: { sections: [] },
    diagnostics: [],
    fingerprint: "sha256:test-retrieval",
  } as const;
}

// @sigil tests packages/compiler/src/evaluator-retrieval.sigil::SigilEvaluatorRetrievalBrief::EvaluatorRetrievalBrief logic,constraints,cases
Deno.test("evaluator retrieval brief projects a readable graph without raw JSON", async () => {
  const retrieval = {
    ...retrievalFixture(),
    graph: {
      nodes: [
        {
          identity: "n:example",
          kind: "component-declaration" as const,
          path: "main.sigil",
          componentName: "Example",
        },
        {
          identity: "n:dependency",
          kind: "component-declaration" as const,
          path: "dependency.sigil",
          componentName: "Dependency",
        },
      ],
      edges: [{
        identity: "e:dependency",
        relation: "direct-dependency" as const,
        sourceIdentity: "n:example",
        targetIdentity: "n:dependency",
        originPath: "main.sigil",
      }],
    },
  };
  const brief = await deriveEvaluatorRetrievalBrief(retrieval, ".");
  assertMatch(
    brief.markdown,
    /Dependency graph\n- Example \(main\.sigil\) --direct-dependency--> Dependency \(dependency\.sigil\)/,
  );
  assertEquals(brief.markdown.includes('"identity"'), false);
  assertEquals(brief.markdown.includes('"evidence"'), false);
  assertEquals(brief.allowedDirectReadPaths, ["main.sigil"]);
});

Deno.test("terminal findings require nullable location fields", () => {
  const request = {
    budgets: {
      elapsedTimeMs: 1_000,
      maxCommands: 1,
      maxCommandOutputChars: 1_000,
      maxInputTokens: 1,
      maxOutputTokens: 1,
    },
    observability: {
      usage: "unavailable",
      cost: "unavailable",
      tokenBudgetEnforcement: "unavailable",
      costBudgetEnforcement: "unavailable",
    },
  } as never;
  const finding = {
    code: "SEMANTIC_AMBIGUITY",
    severity: "warning" as const,
    message: "Location-independent finding.",
    filePath: null,
    line: null,
    column: null,
    evidence: "No physical workspace evidence is available.",
    impact: "The contract remains ambiguous.",
    correction: "Supply the missing contract evidence.",
  };
  assertEquals(
    validateAgentEvaluationResult(request, {
      findings: [finding],
      commands: [],
    })
      .findings[0].filePath,
    null,
  );
  const { filePath: _filePath, ...missingLocation } = finding;
  assertThrows(() =>
    validateAgentEvaluationResult(request, {
      findings: [missingLocation],
      commands: [],
    } as never)
  );
});

Deno.test("subprocess execution declares owned inputs before an attempted launch", async () => {
  const observations: string[] = [];
  const error = await assertRejects(
    () =>
      runAdapterSubprocess({
        implementationIdentity: "test.adapter@1",
        command: "/definitely-not-a-provider-command",
        args: [],
        cwd: Deno.cwd(),
        input: "{}",
        signal: new AbortController().signal,
        maxInitialRequestChars: 10,
        maxProviderFrameChars: 10,
        handle: createAdapterSubprocessHandle("test.adapter@1"),
        resources: {
          declareResource: (identity) =>
            observations.push(`resource:${identity}`),
          declareResultInput: (identity) =>
            observations.push(`input:${identity}`),
          observeResource() {},
          observeResultInput() {},
          reportResourceObservation() {},
          reportResultInputObservation() {},
          cleanupAttempt() {},
        },
        terminationControl: { requestPreventiveBudgetTermination() {} },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "process");
  assertEquals(observations, [
    "resource:process:test.adapter@1",
    "input:result-input:stdout",
    "input:result-input:stderr",
  ]);
});

// @sigil tests packages/compiler/src/adapter-subprocess.sigil::SigilAgentAdapterSubprocess::AdapterSubprocess logic,cases

Deno.test("subprocess process failures retain stderr verbatim", async () => {
  const stderr = "  provider detail\n";
  const error = await assertRejects(
    () =>
      runAdapterSubprocess({
        implementationIdentity: "test.adapter@1",
        command: Deno.execPath(),
        args: [
          "eval",
          `await Deno.stderr.write(new TextEncoder().encode(${
            JSON.stringify(stderr)
          })); Deno.exit(7);`,
        ],
        cwd: Deno.cwd(),
        input: "{}",
        signal: new AbortController().signal,
        maxInitialRequestChars: 10,
        maxProviderFrameChars: 100,
        handle: createAdapterSubprocessHandle("test.adapter@1"),
        resources: {
          declareResource() {},
          declareResultInput() {},
          observeResource() {},
          observeResultInput() {},
          reportResourceObservation() {},
          reportResultInputObservation() {},
          cleanupAttempt() {},
        },
        terminationControl: { requestPreventiveBudgetTermination() {} },
      }),
    AdapterFailure,
  );
  assertEquals(error.message.endsWith(stderr), true);
});

// @sigil tests packages/compiler/src/evaluation-registry.sigil::SigilEvaluationSkillRegistry::EvaluationSkillPackage interface,logic,constraints,cases

Deno.test("evaluation skills declare implementation evidence authority and modularity rules", async () => {
  const skills = await loadEvaluationSkills();
  assertEquals(
    skills.get("semantic-readiness")?.manifest.implementationEvidence,
    "context-only",
  );
  assertEquals(
    skills.get("architecture-design")?.manifest.implementationEvidence,
    "context-only",
  );
  assertEquals(
    skills.get("current-code-compatibility")?.manifest.implementationEvidence,
    "compare",
  );
  assertEquals(
    skills.get("standards-risk")?.manifest.implementationEvidence,
    "context-only",
  );
  const architectureRules = skills.get("architecture-design")?.manifest.rules ??
    [];
  for (
    const rule of [
      "COMPONENT_DECOMPOSITION",
      "OWNERSHIP_BOUNDARY",
      "INTERFACE_BOUNDARY",
      "COUPLING",
      "DEPENDENCY_CYCLE",
      "MODULE_INDEX_SCOPE",
      "IMPORTED_NAMESPACE_REUSE",
      "PRESENTATION_BOUNDARY",
      "UI_STATE_OWNERSHIP",
    ]
  ) {
    assertEquals(architectureRules.includes(rule), true);
  }
  for (const skill of skills.values()) {
    const guidance = skill.guidance.replaceAll(/\s+/g, " ");
    assertMatch(guidance, /Use selected downstream evidence by default/);
    assertMatch(
      guidance,
      /Only when that evidence is insufficient/,
    );
    assertMatch(guidance, /explicit evidence gap blocks evaluation/);
    assertMatch(guidance, /perform targeted graph or context inspection/);
    assertMatch(
      guidance,
      /Do not broadly rediscover the repository/,
    );
    assertMatch(guidance, /downstream dependency closure/);
  }
});

// @sigil tests packages/compiler/src/evaluation-registry.sigil::SigilEvaluationSkillRegistry::EvaluationSkillPackage interface,constraints,cases

Deno.test("evaluation skill loading returns closed tagged outcomes", async () => {
  assertEquals((await loadEvaluationSkill("unknown", "1")).kind, "unavailable");
  assertEquals(
    (await loadEvaluationSkill("semantic-readiness", "missing")).kind,
    "unavailable",
  );
  assertEquals(
    (await loadEvaluationSkill("semantic-readiness", "1.2.0")).kind,
    "ready",
  );
});

// @sigil tests packages/compiler/src/adapters.sigil::SigilAgentAdapter::AgentAdapter logic,cases

Deno.test("provider identities and exact adapter registrations are closed", () => {
  const adapter = new MockAdapter([], "first");
  assertEquals(
    resolveAdapterRegistration([adapter], {
      provider: "mock",
      implementationId: "test.mock.first",
      implementationVersion: "1.0.0",
    }),
    adapter,
  );
  assertRejects(
    () =>
      Promise.resolve().then(() =>
        resolveAdapterRegistration([], {
          provider: "mock",
          implementationId: "test.mock.first",
          implementationVersion: "1.0.0",
        })
      ),
    Error,
    "found 0",
  );
});

// @sigil tests packages/compiler/src/evaluation-execution.sigil::SigilAgentExecutionPolicy::AgentBudgetOutcome interface,cases

Deno.test("budget outcomes preserve unavailable telemetry", () => {
  assertEquals(
    deriveBudgetOutcome(
      {
        elapsedTimeMs: 1,
        maxCommands: 1,
        maxCommandOutputChars: 1,
        maxInputTokens: 10,
      },
      new MockAdapter().observability,
      undefined,
      "unavailable",
      undefined,
      "unavailable",
    ),
    { token: "indeterminate", cost: "not-configured" },
  );
});

Deno.test("event writer suppresses progress and preserves one terminal", async () => {
  const frames: Uint8Array[] = [];
  let calls = 0;
  const opened = await openCompilationEventWriter((bytes) => {
    calls++;
    if (calls === 2) return Promise.resolve("rejected-zero-compatible");
    frames.push(bytes);
    return Promise.resolve("delivered-all");
  }, {
    operation: "one-shot-compilation",
    stageIdentities: ["semantic-readiness"],
  });
  if (opened.kind !== "ready") throw new Error("writer did not open");
  assertEquals(
    await opened.writer.stageStarted("semantic-readiness"),
    "suppressed",
  );
  assertEquals(
    await opened.writer.failed("COMPILER_FAILED", "failed"),
    "delivered",
  );
  const result = await validateCompilationEventStream(
    (async function* () {
      for (const frame of frames) yield frame;
    })(),
    {
      operation: "one-shot-compilation",
      stageIdentities: ["semantic-readiness"],
    },
    new AbortController().signal,
  );
  assertEquals(result.kind, "terminal");
  if (result.kind === "terminal") assertEquals(result.event.type, "failed");
});

// @sigil tests packages/compiler/src/status.sigil::SigilCompilationStatus::CompilationStatus logic,cases

Deno.test("failed optional stages remain visible without preventing green", () => {
  assertEquals(
    compilationColor([], [{
      id: "optional-stage",
      required: false,
      state: "failed",
      evaluator: "test",
      diagnosticCount: 1,
    }]),
    "green",
  );
});

// @sigil tests packages/compiler/src/history-store.sigil::SigilCompilationHistoryStore::CompilationHistoryLookupResult interface

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
        reportVersion: 3,
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

// @sigil tests packages/compiler/src/report-markdown.sigil::SigilCompilationReportMarkdown::CompilationReportMarkdown interface

Deno.test("compilation report Markdown is compact, grouped, and deterministic", () => {
  const report: CompilationReport = {
    reportVersion: 3,
    runId: "run-markdown",
    workspaceRoot: "/workspace",
    target: { kind: "component", name: "Example" },
    requestedScope: { kind: "component", componentName: "Example" },
    selection: {
      strategy: "exact-target",
      affectedSemanticUnits: [],
      coveredSemanticUnits: [],
      uncoveredSemanticUnits: [],
    },
    componentNames: ["Example"],
    status: "yellow",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    sourceFingerprint: "source",
    profile: {
      name: "standard",
      criticalSystem: false,
      contextBudgetChars: 1,
      agentInputBudgetChars: 1,
      limits: {
        maxCompilationRequestChars: 1,
        maxAgentInputChars: 1,
        sessionTtlMs: 1,
        providerCleanupMs: 1,
      },
      executionBudgets: {
        elapsedTimeMs: 1,
        maxCommands: 1,
        maxCommandOutputChars: 1,
        maxInputTokens: 1,
        maxOutputTokens: 1,
      },
      stages: [],
      evaluators: [],
      fingerprint: "profile",
    },
    stages: [{
      id: "semantic-readiness",
      required: true,
      state: "completed",
      evaluator: "mock",
      diagnosticCount: 1,
    }],
    diagnostics: [{
      code: "SEMANTIC_AMBIGUITY",
      fingerprint: "finding",
      severity: "warning",
      stage: "semantic-readiness",
      skill: "semantic-readiness@1",
      message: "Clarify | behavior.",
      filePath: "main.sigil",
      range: {
        start: { line: 4, column: 3 },
        end: { line: 4, column: 12 },
      },
      semanticSubjects: [{
        relation: "direct",
        sigilPath: "main.sigil",
        componentName: "Example",
        ownerKind: "component",
        ownerName: "Example",
        sectionName: "interface",
        conceptIdentifier: "Run",
      }],
      evidence: "The contract has two meanings.",
      impact: "Callers cannot choose safely.",
      correction: "Choose one meaning.",
      evaluator: "mock",
      lifecycle: "new",
    }],
  };
  const markdown = renderCompilationReportMarkdown(report);
  assertEquals(
    markdown,
    renderCompilationReportMarkdown(structuredClone(report)),
  );
  assertMatch(
    markdown,
    /^# Sigil Compilation Report\n\nStatus: \*\*YELLOW\*\*/,
  );
  assertMatch(markdown, /## Stage execution/);
  assertMatch(markdown, /### semantic-readiness/);
  assertMatch(markdown, /SEMANTIC_AMBIGUITY/);
  assertMatch(markdown, /Clarify \| behavior\./);
  assertEquals((markdown.match(/Evidence:/g) ?? []).length, 1);
  assertEquals((markdown.match(/Impact:/g) ?? []).length, 1);
  assertEquals((markdown.match(/Suggested correction:/g) ?? []).length, 1);
});
