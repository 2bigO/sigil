import {
  AdapterFailure,
  type AdapterSubprocessInvocation,
  type AdapterSubprocessResult,
  type AgentAdapter,
  type AgentCommandTrace,
  type AgentEvaluationRequest,
  type AgentEvaluationResult,
  type AgentUsage,
  assertCapabilityContract,
  capabilitiesMatch,
  coordinateAdapterExecution,
  createAdapterSubprocessHandle,
  evaluationPrompt,
  normalizeObservability,
  parseFindingsObject,
  runAdapterSubprocess,
  validateAdapterSubprocessInput,
  validateAgentEvaluationRequest,
  validateAgentEvaluationResult,
} from "@qoherent/sigil-compiler";
import metadata from "../deno.json" with { type: "json" };
import { BundledSemanticProvider } from "@qoherent/sigil-compiler";
export class OpenCodeSemanticProvider extends BundledSemanticProvider {
  constructor(
    model?: string,
    options: { readonly command?: string; readonly timeoutMs?: number } = {},
  ) {
    super({ kind: "opencode", model, ...options });
  }
}

export type OpenCodeCommandRunner = (
  invocation: AdapterSubprocessInvocation,
) => Promise<AdapterSubprocessResult>;

const defaultRunner: OpenCodeCommandRunner = runAdapterSubprocess;

const RESTRICTIVE_CONFIG = {
  $schema: "https://opencode.ai/config.json",
  autoupdate: false,
  share: "disabled",
  plugin: [],
  instructions: [],
  permission: {
    read: "allow",
    edit: "deny",
    bash: "allow",
    webfetch: "deny",
    task: "deny",
    external_directory: "deny",
    question: "deny",
  },
} as const;

export class OpenCodeAdapter implements AgentAdapter {
  readonly provider = "opencode" as const;
  readonly implementationId = "builtin.opencode-cli";
  readonly implementationVersion = metadata.version;
  readonly capabilities = {
    schemaVersion: 1,
    workspaceAccess: "read-only",
    agentToolNetwork: false,
    approvalEscalation: false,
    statePersistence: "persistent",
  } as const;
  readonly observability = {
    progress: "none",
    usage: "partial",
    cost: "partial",
    tokenBudgetEnforcement: "post-settlement-only",
    costBudgetEnforcement: "post-settlement-only",
  } as const;

  constructor(
    readonly model?: string,
    private readonly runner: OpenCodeCommandRunner = defaultRunner,
    readonly id = "opencode",
  ) {}

  // @sigil implements packages/compiler-adapter-opencode/src/opencode-adapter.sigil::SigilOpenCodeCompilerAdapter::OpenCodeAdapter interface,logic,cases
  async evaluate(
    request: AgentEvaluationRequest,
  ): Promise<AgentEvaluationResult> {
    const elapsedOrigin = performance.now();
    if (request.signal?.aborted) {
      throw new AdapterFailure(
        "cancelled",
        "Evaluation was cancelled before invocation.",
      );
    }
    if (
      JSON.stringify(normalizeObservability(request.observability)) !==
        JSON.stringify(normalizeObservability(this.observability))
    ) {
      throw new AdapterFailure(
        "binding-mismatch",
        "OpenCode request observability does not match the selected adapter.",
      );
    }
    try {
      assertCapabilityContract(this, request);
    } catch (error) {
      throw new AdapterFailure(
        "capability-mismatch",
        "OpenCode capabilities do not match the requested contract.",
        undefined,
        { cause: error },
      );
    }
    if (!capabilitiesMatch(request.capabilities, this.capabilities)) {
      throw new AdapterFailure(
        "capability-mismatch",
        "OpenCode capabilities do not match the requested contract.",
      );
    }

    let prompt: string;
    try {
      validateAgentEvaluationRequest(request);
      prompt = evaluationPrompt(request);
      JSON.stringify(RESTRICTIVE_CONFIG);
    } catch (error) {
      throw new AdapterFailure(
        "incomplete-evidence",
        "OpenCode evaluation request evidence is incomplete or invalid.",
        undefined,
        { cause: error },
      );
    }
    validateAdapterSubprocessInput(
      prompt,
      request.limits.maxInitialRequestChars,
    );

    const args = [
      "run",
      "--format",
      "json",
      "--dir",
      request.workspaceRoot,
      ...(this.model ? ["--model", this.model] : []),
    ];
    const handle = createAdapterSubprocessHandle(
      `${this.implementationId}@${this.implementationVersion}`,
    );
    return await coordinateAdapterExecution({
      elapsedOrigin,
      elapsedTimeMs: request.budgets.elapsedTimeMs,
      providerCleanupMs: request.limits.providerCleanupMs,
      implementationIdentity:
        `${this.implementationId}@${this.implementationVersion}`,
      handle,
      signal: request.signal,
      invoke: async (signal, resources, terminationControl) => {
        const result = await this.runner({
          implementationIdentity:
            `${this.implementationId}@${this.implementationVersion}`,
          command: "opencode",
          args,
          cwd: request.workspaceRoot,
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify(RESTRICTIVE_CONFIG),
            OPENCODE_DISABLE_AUTOUPDATE: "true",
            OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
          },
          input: prompt,
          signal,
          maxInitialRequestChars: request.limits.maxInitialRequestChars,
          maxProviderFrameChars: request.limits.maxProviderFrameChars,
          handle,
          resources,
          terminationControl,
        });
        const parsed = parseOpenCodeEvents(
          result.stdout,
          request.limits.maxProviderFrameChars,
          request.limits.maxFinalResultChars,
          request.limits.maxRetainedCommandOutputChars,
        );
        if (parsed.commands.length > request.budgets.maxCommands) {
          throw new AdapterFailure(
            "preventive-budget",
            `OpenCode emitted ${parsed.commands.length} command observations, exceeding the configured limit.`,
          );
        }
        try {
          return validateAgentEvaluationResult(request, parsed);
        } catch (error) {
          throw new AdapterFailure(
            "final-result-protocol",
            "OpenCode returned an invalid terminal result.",
            undefined,
            { cause: error },
          );
        }
      },
    });
  }
}

export function parseOpenCodeEvents(
  raw: string,
  maxFrameChars: number,
  maxFinalResultChars: number,
  maxRetainedCommandOutputChars: number,
): AgentEvaluationResult {
  const textByKey = new Map<string, string[]>();
  const turnOrder: string[] = [];
  const finishReasonByKey = new Map<string, string>();
  const usageByKey = new Map<string, AgentUsage>();
  const costByKey = new Map<string, number>();
  let syntheticTurn = 0;
  const commands: AgentCommandTrace[] = [];
  let lastFinishReason: string | undefined;

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    if (line.length > maxFrameChars) {
      throw new AdapterFailure(
        "operational-limit",
        `OpenCode event line ${index + 1} exceeds maxProviderFrameChars.`,
      );
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new AdapterFailure(
        "final-result-protocol",
        `OpenCode event line ${index + 1} is not valid JSON.`,
        undefined,
        { cause: error },
      );
    }
    const part = objectValue(event.part) ?? event;
    const type = String(event.type ?? part.type ?? "");
    const messageID = typeof part.messageID === "string"
      ? part.messageID
      : undefined;
    const key = messageID ?? `turn:${syntheticTurn}`;
    if (type === "text" && typeof part.text === "string") {
      let bucket = textByKey.get(key);
      if (!bucket) {
        bucket = [];
        textByKey.set(key, bucket);
        turnOrder.push(key);
      }
      bucket.push(part.text);
    } else if (type === "tool" || type === "tool_use") {
      const state = objectValue(part.state);
      const input = objectValue(state?.input);
      const command = typeof input?.command === "string"
        ? input.command
        : typeof part.tool === "string"
        ? part.tool
        : "unknown";
      commands.push({
        command: command.slice(0, maxRetainedCommandOutputChars),
        status: typeof state?.status === "string" ? state.status : undefined,
      });
    } else if (type === "step_start" && !messageID) {
      syntheticTurn++;
    } else if (type === "step_finish") {
      const reason = typeof part.reason === "string" ? part.reason : undefined;
      finishReasonByKey.set(key, reason ?? "");
      lastFinishReason = reason;
      const tokens = objectValue(part.tokens);
      if (tokens) {
        usageByKey.set(key, {
          inputTokens: numberValue(tokens.input),
          cachedInputTokens: numberValue(objectValue(tokens.cache)?.read),
          outputTokens: numberValue(tokens.output),
        });
      }
      const cost = numberValue(part.cost);
      if (cost !== undefined) costByKey.set(key, cost);
    } else if (type === "error") {
      throw new AdapterFailure(
        "execution",
        `OpenCode reported an execution error: ${
          JSON.stringify(part.error ?? event.error ?? part)
        }`,
      );
    }
  }

  const stopKeys = [...finishReasonByKey.keys()]
    .filter((name) => finishReasonByKey.get(name) === "stop");
  let terminalKey: string | undefined;
  if (stopKeys.length === 1) {
    terminalKey = stopKeys[0];
  } else if (stopKeys.length > 1) {
    throw new AdapterFailure(
      "final-result-protocol",
      "OpenCode emitted multiple terminal assistant turns.",
    );
  } else {
    const allKeys = new Set<string>([
      ...textByKey.keys(),
      ...finishReasonByKey.keys(),
    ]);
    if (allKeys.size === 1) {
      terminalKey = [...allKeys][0];
    } else {
      throw new AdapterFailure(
        "final-result-protocol",
        `OpenCode ended before producing a terminal assistant turn (last finish reason: ${
          lastFinishReason ?? "unknown"
        }).`,
      );
    }
  }

  const finalText = (textByKey.get(terminalKey) ?? []).join("");
  if (!finalText) {
    throw new AdapterFailure(
      "final-result-protocol",
      `OpenCode event stream did not contain assistant terminal text (terminal turn reason: ${
        finishReasonByKey.get(terminalKey) || "none"
      }; ${commands.length} command trace${
        commands.length === 1 ? "" : "s"
      } observed).`,
    );
  }
  if (finalText.length > maxFinalResultChars) {
    throw new AdapterFailure(
      "final-result-protocol",
      "OpenCode terminal result exceeds maxFinalResultChars.",
    );
  }
  const extracted = extractResultObject(finalText);
  let findings;
  try {
    findings = parseFindingsObject(extracted);
  } catch (error) {
    throw new AdapterFailure(
      "final-result-protocol",
      "OpenCode assistant terminal text is not one valid result object.",
      undefined,
      { cause: error },
    );
  }
  return {
    findings,
    commands,
    usage: usageByKey.get(terminalKey),
    usageAvailability: usageByKey.has(terminalKey) ? "final" : "unavailable",
    cost: costByKey.has(terminalKey)
      ? { amount: costByKey.get(terminalKey)! }
      : undefined,
    costAvailability: costByKey.has(terminalKey) ? "final" : "unavailable",
  };
}

function extractResultObject(text: string): string {
  const trimmed = text.trim();
  const whole = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
  if (whole) return whole[1].trim();
  const embedded = trimmed.match(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```/);
  if (embedded) return embedded[1].trim();
  return trimmed;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
