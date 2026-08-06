import {
  AdapterFailure,
  type AdapterSubprocessInvocation,
  type AgentEvaluationRequest,
  coordinateAdapterExecution,
  resolveAdapterRegistration,
  runAdapterSubprocess,
} from "@qoherent/sigil-compiler";
import { OpenCodeAdapter, parseOpenCodeEvents } from "../src/mod.ts";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";

function request(
  adapter: OpenCodeAdapter,
  persistence: "ephemeral" | "persistent" = "persistent",
): AgentEvaluationRequest {
  return {
    stage: "semantic-readiness",
    purpose: "semantic",
    skill: "Inspect the selected Sigil.",
    allowedRules: ["SEMANTIC_AMBIGUITY"],
    implementationEvidence: "context-only",
    workspaceRoot: Deno.cwd(),
    workspaceSnapshotIdentity: "sha256:test-snapshot",
    target: {
      componentName: "Example",
      sigilFile: "example.sigil",
      initialPaths: ["example.sigil"],
      retrieval: {
        schema: "sigil-purpose-retrieval/v1",
        policyVersion: 1,
        workspaceSnapshotIdentity: "sha256:test-snapshot",
        target: {
          kind: "component",
          componentName: "Example",
          pathStatus: "accepted",
          path: "example.sigil",
        },
        purpose: "semantic",
        graph: { nodes: [], edges: [] },
        evidence: [],
        inclusionReasons: [],
        exclusions: [],
        context: { sections: [] },
        diagnostics: [],
        fingerprint: "sha256:test-retrieval",
      },
    },
    capabilities: {
      schemaVersion: 1,
      workspaceAccess: "read-only",
      agentToolNetwork: false,
      approvalEscalation: false,
      statePersistence: persistence,
    },
    commandPolicy: {
      allowedCommands: ["sigil check", "rg", "sed"],
      forbiddenCommands: ["file mutation", "network clients"],
    },
    observability: adapter.observability,
    budgets: {
      elapsedTimeMs: 30_000,
      maxCommands: 10,
      maxCommandOutputChars: 10_000,
      maxInputTokens: 1_000,
      maxOutputTokens: 1_000,
    },
    limits: {
      maxInitialRequestChars: 1_000_000,
      maxProviderFrameChars: 1_000_000,
      maxFinalResultChars: 1_000_000,
      maxRetainedCommandOutputChars: 10_000,
      providerCleanupMs: 100,
    },
  };
}

// @sigil tests packages/compiler-adapter-opencode/src/opencode-adapter.sigil::SigilOpenCodeCompilerAdapter::OpenCodeAdapter interface,logic,constraints,cases
Deno.test("OpenCode adapter invokes JSON run with restrictive persistent configuration", async () => {
  let observed: AdapterSubprocessInvocation | undefined;
  const adapter = new OpenCodeAdapter("openai/gpt-5", (invocation) => {
    observed = invocation;
    return Promise.resolve({
      code: 0,
      stderr: "",
      stdout: [
        JSON.stringify({ type: "text", part: { text: '{"findings":' } }),
        JSON.stringify({ type: "text", part: { text: "[]}" } }),
        JSON.stringify({
          type: "step_finish",
          part: {
            tokens: { input: 12, output: 3, cache: { read: 2 } },
            cost: 0.01,
          },
        }),
      ].join("\n"),
    });
  });
  const result = await adapter.evaluate(request(adapter));
  if (!observed) throw new Error("OpenCode was not invoked.");
  assertEquals(observed.command, "opencode");
  assertEquals(observed.args.slice(0, 3), ["run", "--format", "json"]);
  assertEquals(observed.args.includes("--ephemeral"), false);
  assertEquals(
    observed.args.slice(observed.args.indexOf("--model") + 1)[0],
    "openai/gpt-5",
  );
  assertMatch(observed.input, /Return ONLY this JSON object/);
  const config = JSON.parse(observed.env?.OPENCODE_CONFIG_CONTENT ?? "{}");
  assertEquals(config.permission.read, "allow");
  for (
    const permission of [
      "edit",
      "webfetch",
      "task",
      "external_directory",
      "question",
    ]
  ) assertEquals(config.permission[permission], "deny");
  assertEquals(adapter.capabilities.statePersistence, "persistent");
  assertEquals(result.findings, []);
  assertEquals(result.usage?.inputTokens, 12);
  assertEquals(result.cost?.amount, 0.01);
});

// @sigil tests packages/compiler-adapter-opencode/src/opencode-adapter.sigil::SigilOpenCodeCompilerAdapter::OpenCodeAdapter cases
Deno.test("OpenCode adapter rejects ephemeral requests before invocation", async () => {
  let invoked = false;
  const adapter = new OpenCodeAdapter(undefined, () => {
    invoked = true;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  });
  const error = await assertRejects(
    () => adapter.evaluate(request(adapter, "ephemeral")),
    AdapterFailure,
  );
  assertEquals(error.kind, "capability-mismatch");
  assertEquals(invoked, false);
});

Deno.test("OpenCode registrations match the optional model exactly", () => {
  const defaultModel = new OpenCodeAdapter();
  const selectedModel = new OpenCodeAdapter("openai/gpt-5");
  assertEquals(
    resolveAdapterRegistration([defaultModel, selectedModel], {
      provider: "opencode",
      implementationId: "builtin.opencode-cli",
      implementationVersion: "0.7.1",
      model: "openai/gpt-5",
    }),
    selectedModel,
  );
});

Deno.test("OpenCode framing requires one bounded terminal result", () => {
  const error = assertRejects(
    () =>
      Promise.resolve().then(() =>
        parseOpenCodeEvents(
          `${JSON.stringify({ type: "text", part: { text: "{}" } })}\n${
            JSON.stringify({ type: "text", part: { text: "{}" } })
          }`,
          1_000,
          1_000,
          1_000,
        )
      ),
    AdapterFailure,
  );
  return error.then((value) =>
    assertEquals(value.kind, "final-result-protocol")
  );
});

Deno.test("OpenCode adapter ignores narration before the terminal stop turn", async () => {
  const stdout = [
    JSON.stringify({
      type: "step_start",
      part: { messageID: "m1", type: "step-start" },
    }),
    JSON.stringify({
      type: "text",
      part: {
        messageID: "m1",
        type: "text",
        text: "Let me inspect the contract.",
      },
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "read",
        callID: "c1",
        state: {
          status: "completed",
          input: { command: "read example.sigil" },
        },
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { messageID: "m1", type: "step-finish", reason: "tool-calls" },
    }),
    JSON.stringify({
      type: "step_start",
      part: { messageID: "m2", type: "step-start" },
    }),
    JSON.stringify({
      type: "text",
      part: { messageID: "m2", type: "text", text: '{"findings":[]}' },
    }),
    JSON.stringify({
      type: "step_finish",
      part: {
        messageID: "m2",
        type: "step-finish",
        reason: "stop",
        tokens: { input: 50, output: 5, cache: { read: 3 } },
        cost: 0.02,
      },
    }),
  ].join("\n");
  let observed: AdapterSubprocessInvocation | undefined;
  const adapter = new OpenCodeAdapter(undefined, (invocation) => {
    observed = invocation;
    return Promise.resolve({ code: 0, stderr: "", stdout });
  });
  const result = await adapter.evaluate(request(adapter));
  if (!observed) throw new Error("OpenCode was not invoked.");
  assertEquals(result.findings, []);
  assertEquals(result.commands.length, 1);
  assertEquals(result.commands[0].command, "read example.sigil");
  assertEquals(result.usage?.inputTokens, 50);
  assertEquals(result.cost?.amount, 0.02);
});

Deno.test("parseOpenCodeEvents strips a markdown code fence around the result", () => {
  const stdout = [
    JSON.stringify({
      type: "text",
      part: {
        messageID: "m1",
        type: "text",
        text: '```json\n{"findings":[]}\n```',
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { messageID: "m1", reason: "stop" },
    }),
  ].join("\n");
  const result = parseOpenCodeEvents(stdout, 10_000, 10_000, 10_000);
  assertEquals(result.findings, []);
});

Deno.test("parseOpenCodeEvents reports the last finish reason without a stop turn", () => {
  const stdout = [
    JSON.stringify({
      type: "step_start",
      part: { messageID: "m1", type: "step-start" },
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "read",
        callID: "c1",
        state: {
          status: "completed",
          input: { command: "read example.sigil" },
        },
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { messageID: "m1", type: "step-finish", reason: "tool-calls" },
    }),
    JSON.stringify({
      type: "step_start",
      part: { messageID: "m2", type: "step-start" },
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "read",
        callID: "c2",
        state: { status: "completed", input: { command: "read other.sigil" } },
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { messageID: "m2", type: "step-finish", reason: "tool-calls" },
    }),
  ].join("\n");
  let caught: AdapterFailure | undefined;
  try {
    parseOpenCodeEvents(stdout, 10_000, 10_000, 10_000);
  } catch (error) {
    caught = error as AdapterFailure;
  }
  if (!caught) throw new Error("parseOpenCodeEvents was expected to throw.");
  assertEquals(caught.kind, "final-result-protocol");
  assertMatch(caught.message, /last finish reason: tool-calls/);
});

Deno.test("coordinator rejects elapsed preflight without invoking provider", async () => {
  let invoked = false;
  const error = await assertRejects(
    () =>
      coordinateAdapterExecution({
        elapsedOrigin: performance.now() - 10,
        elapsedTimeMs: 1,
        implementationIdentity: "test.opencode@1",
        invoke: () => {
          invoked = true;
          return Promise.resolve("unexpected");
        },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "elapsed-time");
  assertEquals(invoked, false);
});

Deno.test("subprocess cancellation performs bounded verified cleanup", async () => {
  const controller = new AbortController();
  setTimeout(
    () =>
      controller.abort(
        new AdapterFailure("elapsed-time", "test deadline expired"),
      ),
    30,
  );
  const error = await assertRejects(
    () =>
      runAdapterSubprocess({
        implementationIdentity: "test.opencode@1",
        command: Deno.execPath(),
        args: ["eval", "setInterval(() => {}, 1000)"],
        cwd: Deno.cwd(),
        input: "",
        signal: controller.signal,
        providerCleanupMs: 500,
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "elapsed-time");
  assertEquals(error.recovery?.cleanupDeadlineOutcome, "completed");
  assertEquals(error.recovery?.resources[0].latestState, "terminal");
});
