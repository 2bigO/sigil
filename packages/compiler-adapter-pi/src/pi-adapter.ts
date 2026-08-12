import {
  AdapterFailure,
  type AdapterSubprocessInvocation,
  type AdapterSubprocessResult,
  type AgentAdapter,
  type AgentCommandTrace,
  type AgentEvaluationRequest,
  type AgentEvaluationResult,
  AgentRequestTransportLimitError,
  type AgentUsage,
  assertCapabilityContract,
  capabilitiesMatch,
  coordinateAdapterExecution,
  createAdapterSubprocessHandle,
  evaluationPrompt,
  normalizeObservability,
  parseFindingsObject,
  runAdapterSubprocess,
  validateAgentEvaluationRequest,
  validateAgentEvaluationResult,
} from "@qoherent/sigil-compiler";
import metadata from "../deno.json" with { type: "json" };

export type PiCommandRunner = (
  invocation: AdapterSubprocessInvocation,
) => Promise<AdapterSubprocessResult>;

const defaultRunner: PiCommandRunner = runAdapterSubprocess;

const PI_TOOLS = "read,grep,find,ls,bash";

export class PiAdapter implements AgentAdapter {
  readonly provider = "pi" as const;
  readonly implementationId = "builtin.pi-cli";
  readonly implementationVersion = metadata.version;
  readonly capabilities = {
    schemaVersion: 1,
    workspaceAccess: "read-only",
    agentToolNetwork: false,
    approvalEscalation: false,
    statePersistence: "ephemeral",
  } as const;
  readonly observability = {
    progress: "none",
    usage: "final",
    cost: "final",
    tokenBudgetEnforcement: "post-settlement-only",
    costBudgetEnforcement: "post-settlement-only",
  } as const;

  constructor(
    readonly model?: string,
    private readonly runner: PiCommandRunner = defaultRunner,
    readonly id = "pi",
  ) {}

  // @sigil implements packages/compiler-adapter-pi/src/pi-adapter.sigil::SigilPiCompilerAdapter::PiAdapter interface,logic,cases
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
        "Pi request observability does not match the selected adapter.",
      );
    }
    try {
      assertCapabilityContract(this, request);
    } catch (error) {
      throw new AdapterFailure(
        "capability-mismatch",
        "Pi capabilities do not match the requested contract.",
        undefined,
        { cause: error },
      );
    }
    if (!capabilitiesMatch(request.capabilities, this.capabilities)) {
      throw new AdapterFailure(
        "capability-mismatch",
        "Pi capabilities do not match the requested contract.",
      );
    }

    let prompt: string;
    try {
      validateAgentEvaluationRequest(request);
      prompt = evaluationPrompt(request);
    } catch (error) {
      throw new AdapterFailure(
        error instanceof AgentRequestTransportLimitError
          ? "operational-limit"
          : "incomplete-evidence",
        error instanceof AgentRequestTransportLimitError
          ? error.message
          : "Pi evaluation request evidence is incomplete or invalid.",
        undefined,
        { cause: error },
      );
    }
    if (prompt.length > request.limits.maxInitialRequestChars) {
      throw new AdapterFailure(
        "operational-limit",
        `Pi request exceeds maxInitialRequestChars (${request.limits.maxInitialRequestChars}).`,
      );
    }

    const args = [
      "--print",
      "--mode",
      "json",
      "--no-session",
      "--tools",
      PI_TOOLS,
      "--no-skills",
      "--no-context-files",
      "--no-extensions",
      "--no-approve",
      "--offline",
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
          command: "pi",
          args,
          cwd: request.workspaceRoot,
          input: prompt,
          signal,
          maxInitialRequestChars: request.limits.maxInitialRequestChars,
          maxProviderFrameChars: request.limits.maxProviderFrameChars,
          handle,
          resources,
          terminationControl,
        });
        const parsed = parsePiEvents(
          result.stdout,
          request.limits.maxProviderFrameChars,
          request.limits.maxFinalResultChars,
          request.limits.maxRetainedCommandOutputChars,
        );
        if (parsed.commands.length > request.budgets.maxCommands) {
          throw new AdapterFailure(
            "preventive-budget",
            `Pi emitted ${parsed.commands.length} command observations, exceeding the configured limit.`,
          );
        }
        try {
          return validateAgentEvaluationResult(request, parsed);
        } catch (error) {
          throw new AdapterFailure(
            "final-result-protocol",
            "Pi returned an invalid terminal result.",
            undefined,
            { cause: error },
          );
        }
      },
    });
  }
}

export function parsePiEvents(
  raw: string,
  maxFrameChars: number,
  maxFinalResultChars: number,
  maxRetainedCommandOutputChars: number,
): AgentEvaluationResult {
  const commands: AgentCommandTrace[] = [];
  const assistantTurns: {
    text: string;
    stopReason: string | undefined;
    usage: AgentUsage | undefined;
    costAmount: number | undefined;
  }[] = [];
  let terminalText: string | undefined;
  let usage: AgentUsage | undefined;
  let costAmount: number | undefined;
  let lastStopReason: string | undefined;

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    if (line.length > maxFrameChars) {
      throw new AdapterFailure(
        "operational-limit",
        `Pi event line ${index + 1} exceeds maxProviderFrameChars.`,
      );
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new AdapterFailure(
        "final-result-protocol",
        `Pi event line ${index + 1} is not valid JSON.`,
        undefined,
        { cause: error },
      );
    }
    const type = String(event.type ?? "");
    if (type === "tool_execution_start" || type === "tool_execution_end") {
      const toolName = typeof event.toolName === "string"
        ? event.toolName
        : "unknown";
      const args = event.args;
      const command = args === undefined
        ? toolName
        : `${toolName} ${stableJson(args)}`;
      commands.push({
        command: command.slice(0, maxRetainedCommandOutputChars),
        status: type === "tool_execution_end"
          ? (event.isError === true ? "error" : "completed")
          : "started",
      });
      continue;
    }
    if (type !== "message_end") continue;
    const message = objectValue(event.message);
    if (!message || message.role !== "assistant") continue;
    const text = assistantText(message.content);
    const stopReason = typeof message.stopReason === "string"
      ? message.stopReason
      : undefined;
    if (stopReason) lastStopReason = stopReason;
    const turnUsage = usageFromMessage(message);
    const turnCost = costFromMessage(message);
    assistantTurns.push({
      text,
      stopReason,
      usage: turnUsage,
      costAmount: turnCost,
    });
    if (stopReason === "stop" || stopReason === "end_turn") {
      terminalText = text || terminalText;
      usage = turnUsage ?? usage;
      costAmount = turnCost ?? costAmount;
    }
  }

  if (terminalText === undefined) {
    const completed = assistantTurns.filter((turn) =>
      turn.stopReason === undefined || turn.stopReason === ""
    );
    if (assistantTurns.length === 1 && completed.length === 1) {
      terminalText = assistantTurns[0].text;
      usage = assistantTurns[0].usage;
      costAmount = assistantTurns[0].costAmount;
    } else if (
      assistantTurns.length === 0 || !assistantTurns.some((t) => t.text)
    ) {
      throw new AdapterFailure(
        "final-result-protocol",
        `Pi event stream did not contain assistant terminal text (last stop reason: ${
          lastStopReason ?? "unknown"
        }; ${commands.length} command trace${
          commands.length === 1 ? "" : "s"
        } observed).`,
      );
    } else {
      throw new AdapterFailure(
        "final-result-protocol",
        `Pi ended before producing a terminal assistant turn (last stop reason: ${
          lastStopReason ?? "unknown"
        }).`,
      );
    }
  }

  if (terminalText.length > maxFinalResultChars) {
    throw new AdapterFailure(
      "final-result-protocol",
      "Pi terminal result exceeds maxFinalResultChars.",
    );
  }
  const extracted = extractResultObject(terminalText);
  let findings;
  try {
    findings = parseFindingsObject(extracted);
  } catch (error) {
    throw new AdapterFailure(
      "final-result-protocol",
      "Pi assistant terminal text is not one valid result object.",
      undefined,
      { cause: error },
    );
  }
  return {
    findings,
    commands,
    usage,
    usageAvailability: usage ? "final" : "unavailable",
    cost: costAmount === undefined ? undefined : { amount: costAmount },
    costAvailability: costAmount === undefined ? "unavailable" : "final",
  };
}

function assistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const part = objectValue(item);
    if (!part) continue;
    if (part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.join("");
}

function usageFromMessage(
  message: Record<string, unknown>,
): AgentUsage | undefined {
  const usage = objectValue(message.usage);
  if (!usage) return undefined;
  return {
    inputTokens: numberValue(usage.input) ?? numberValue(usage.inputTokens),
    cachedInputTokens: numberValue(usage.cacheRead) ??
      numberValue(usage.cachedInputTokens),
    outputTokens: numberValue(usage.output) ?? numberValue(usage.outputTokens),
  };
}

function costFromMessage(
  message: Record<string, unknown>,
): number | undefined {
  const cost = objectValue(message.usage)
    ? objectValue(objectValue(message.usage)?.cost)
    : undefined;
  if (cost) {
    const total = numberValue(cost.total);
    if (total !== undefined) return total;
  }
  return numberValue(message.cost);
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

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
