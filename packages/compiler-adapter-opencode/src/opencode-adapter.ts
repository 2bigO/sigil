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
  evaluationPrompt,
  normalizeObservability,
  parseFindingsObject,
  runAdapterSubprocess,
  validateAgentEvaluationRequest,
  validateAgentEvaluationResult,
} from "@qoherent/sigil-compiler";
import metadata from "../deno.json" with { type: "json" };

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
    bash: "deny",
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

  // @sigil implements packages/compiler-adapter-opencode/src/opencode-adapter.sigil::SigilOpenCodeCompilerAdapter::OpenCodeAdapter interface,logic,constraints,cases
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
        "operational-limit",
        "OpenCode request preflight failed.",
        undefined,
        { cause: error },
      );
    }
    if (prompt.length > request.limits.maxInitialRequestChars) {
      throw new AdapterFailure(
        "operational-limit",
        `OpenCode request exceeds maxInitialRequestChars (${request.limits.maxInitialRequestChars}).`,
      );
    }

    const args = [
      "run",
      "--format",
      "json",
      "--dir",
      request.workspaceRoot,
      ...(this.model ? ["--model", this.model] : []),
    ];
    return await coordinateAdapterExecution({
      elapsedOrigin,
      elapsedTimeMs: request.budgets.elapsedTimeMs,
      implementationIdentity:
        `${this.implementationId}@${this.implementationVersion}`,
      signal: request.signal,
      invoke: async (signal) => {
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
          providerCleanupMs: request.limits.providerCleanupMs,
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
  const text: string[] = [];
  const commands: AgentCommandTrace[] = [];
  let usage: AgentUsage | undefined;
  let costAmount: number | undefined;
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
    if (type === "text" && typeof part.text === "string") {
      text.push(part.text);
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
    } else if (type === "step_finish") {
      const tokens = objectValue(part.tokens);
      const cache = objectValue(tokens?.cache);
      if (tokens) {
        usage = {
          inputTokens: numberValue(tokens.input),
          cachedInputTokens: numberValue(cache?.read),
          outputTokens: numberValue(tokens.output),
        };
      }
      costAmount = numberValue(part.cost);
    } else if (type === "error") {
      throw new AdapterFailure(
        "execution",
        `OpenCode reported an execution error: ${
          JSON.stringify(part.error ?? event.error ?? part)
        }`,
      );
    }
  }
  const finalText = text.join("");
  if (!finalText) {
    throw new AdapterFailure(
      "final-result-protocol",
      "OpenCode event stream did not contain assistant terminal text.",
    );
  }
  if (finalText.length > maxFinalResultChars) {
    throw new AdapterFailure(
      "final-result-protocol",
      "OpenCode terminal result exceeds maxFinalResultChars.",
    );
  }
  let findings;
  try {
    findings = parseFindingsObject(finalText);
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
    usage,
    usageAvailability: usage ? "final" : "unavailable",
    cost: costAmount === undefined ? undefined : { amount: costAmount },
    costAvailability: costAmount === undefined ? "unavailable" : "final",
  };
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
