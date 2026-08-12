import type {
  AgentExecutionBudgets,
  CompilationFocus,
  CompilationLimits,
  CompileConfiguration,
} from "./types.ts";

const DEFAULT_EXECUTION_BUDGETS: AgentExecutionBudgets = {
  elapsedTimeMs: 1_800_000,
  maxCommands: 512,
  maxCommandOutputChars: 3_000_000,
  maxInputTokens: 1_000_000,
  maxOutputTokens: 1_000_000,
};

const DEFAULT_LIMITS: CompilationLimits = {
  maxCompilationRequestChars: 1_000_000,
  maxAgentInputChars: 1_000_000,
  sessionTtlMs: 86_400_000,
  providerCleanupMs: 5_000,
};

// @sigil implements packages/compiler/src/compiler.sigil::SigilOneShotCompilation::OneShotCompilation logic,cases
export function stageForCompilationFocus(
  focus: CompilationFocus | undefined,
): string | undefined {
  return focus === "design"
    ? "architecture-design"
    : focus === "implementation"
    ? "current-code-compatibility"
    : undefined;
}

// @sigil implements packages/compiler/src/profile.sigil::SigilCompilationProfile::CompilationProfile logic
export function parseCompilationConfiguration(
  value: unknown,
): CompileConfiguration {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tools.compile must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.budgets !== undefined) {
    validatePositiveIntegerFields(
      raw.budgets,
      DEFAULT_EXECUTION_BUDGETS,
      "tools.compile.budgets",
    );
  }
  if (raw.limits !== undefined) {
    validatePositiveIntegerFields(
      raw.limits,
      DEFAULT_LIMITS,
      "tools.compile.limits",
    );
  }
  return raw as unknown as CompileConfiguration;
}

// @sigil implements packages/compiler/src/profile.sigil::SigilCompilationProfile::CompilationProfile logic
export function resolveCompilationSettings(
  configuration: CompileConfiguration,
): {
  readonly budgets: AgentExecutionBudgets;
  readonly limits: CompilationLimits;
} {
  const budgets = { ...DEFAULT_EXECUTION_BUDGETS, ...configuration.budgets };
  validatePositiveIntegerFields(
    budgets,
    DEFAULT_EXECUTION_BUDGETS,
    "tools.compile.budgets",
  );
  const limits = { ...DEFAULT_LIMITS, ...configuration.limits };
  validatePositiveIntegerFields(
    limits,
    DEFAULT_LIMITS,
    "tools.compile.limits",
  );
  return { budgets, limits };
}

function validatePositiveIntegerFields(
  value: unknown,
  defaults: object,
  path: string,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  const known = new Set(Object.keys(defaults));
  for (const [name, configured] of Object.entries(value)) {
    if (!known.has(name)) {
      throw new Error(
        `${path} contains unknown field ${JSON.stringify(name)}.`,
      );
    }
    if (!Number.isSafeInteger(configured) || (configured as number) <= 0) {
      throw new Error(`${path}.${name} must be a positive safe integer.`);
    }
  }
}
