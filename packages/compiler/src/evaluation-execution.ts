import type {
  AdapterObservabilityDeclaration,
  AgentBudgetOutcome,
  AgentCost,
  AgentExecutionBudgets,
  AgentOperationalLimits,
  AgentUsage,
  BudgetEnforcement,
  BudgetOutcome,
  TelemetryAvailability,
} from "./types.ts";

export const DEFAULT_AGENT_OPERATIONAL_LIMITS: AgentOperationalLimits = {
  maxInitialRequestChars: 1_000_000,
  maxProviderFrameChars: 3_000_000,
  maxFinalResultChars: 1_000_000,
  maxRetainedCommandOutputChars: 3_000_000,
  providerCleanupMs: 5_000,
};

// @sigil implements packages/compiler/src/evaluation-execution.sigil::SigilAgentExecutionPolicy::AgentBudgetOutcome interface,cases
export function deriveBudgetOutcome(
  budgets: AgentExecutionBudgets,
  observability: AdapterObservabilityDeclaration,
  usage: AgentUsage | undefined,
  usageAvailability: TelemetryAvailability = usage ? "final" : "unavailable",
  cost: AgentCost | undefined,
  costAvailability: TelemetryAvailability = cost ? "final" : "unavailable",
): AgentBudgetOutcome {
  return {
    token: tokenOutcome(
      budgets,
      observability.tokenBudgetEnforcement,
      usage,
      usageAvailability,
    ),
    cost: outcome(
      budgets.maxCost,
      observability.costBudgetEnforcement,
      cost?.amount,
      costAvailability,
    ),
  };
}

function tokenOutcome(
  budgets: AgentExecutionBudgets,
  enforcement: BudgetEnforcement,
  usage: AgentUsage | undefined,
  availability: TelemetryAvailability,
): BudgetOutcome {
  if (
    budgets.maxInputTokens === undefined &&
    budgets.maxOutputTokens === undefined
  ) return "not-configured";
  if (enforcement === "preflight" || enforcement === "live") {
    return "within-limit";
  }
  if (availability !== "final") return "indeterminate";
  if (
    (budgets.maxInputTokens !== undefined &&
      usage?.inputTokens === undefined) ||
    (budgets.maxOutputTokens !== undefined &&
      usage?.outputTokens === undefined)
  ) return "indeterminate";
  if (
    (budgets.maxInputTokens !== undefined &&
      usage!.inputTokens! > budgets.maxInputTokens) ||
    (budgets.maxOutputTokens !== undefined &&
      usage!.outputTokens! > budgets.maxOutputTokens)
  ) return "exceeded";
  return "within-limit";
}

// @sigil implements packages/compiler/src/evaluation-execution.sigil::SigilAgentExecutionPolicy::AgentOperationalLimits interface
export function truncateRetainedOutput(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit);
}

function outcome(
  limit: number | undefined,
  enforcement: BudgetEnforcement,
  observed: number | undefined,
  availability: TelemetryAvailability,
): BudgetOutcome {
  if (limit === undefined) return "not-configured";
  if (enforcement === "preflight" || enforcement === "live") {
    return observed !== undefined && observed > limit
      ? "exceeded"
      : "within-limit";
  }
  if (availability !== "final" || observed === undefined) {
    return "indeterminate";
  }
  return observed > limit ? "exceeded" : "within-limit";
}
