import { resolveCompilationSettings } from "../profile.ts";
import { CompilerFailure } from "../status.ts";
import type { CompileConfiguration, EffectiveProfile } from "../types.ts";
import { digest } from "./turtle.ts";

export const SEMANTIC_STAGE_IDS = [
  "deterministic-foundation",
  "semantic-closure",
  "implementation-coverage",
] as const;
export function semanticStageAlias(stage?: string): string | undefined {
  if (
    ["semantic-readiness", "architecture-design", "standards-risk"].includes(
      stage ?? "",
    )
  ) return "semantic-closure";
  if (stage === "current-code-compatibility") return "implementation-coverage";
  return stage;
}

export async function semanticProfile(
  name: string,
  configuration: CompileConfiguration,
  requestedStage?: string,
  kernelFingerprint = "source-runtime",
): Promise<EffectiveProfile> {
  const custom = configuration.profiles?.[name];
  const base = custom?.extends ?? name;
  if (!["standard", "critical-system"].includes(base)) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      `Unknown compilation profile ${JSON.stringify(name)}.`,
    );
  }
  const requested = semanticStageAlias(requestedStage);
  if (requested && !SEMANTIC_STAGE_IDS.some((id) => id === requested)) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      `Unknown compilation stage ${JSON.stringify(requestedStage)}.`,
    );
  }
  const selected = requested
    ? SEMANTIC_STAGE_IDS.slice(
      0,
      SEMANTIC_STAGE_IDS.indexOf(
        requested as typeof SEMANTIC_STAGE_IDS[number],
      ) + 1,
    )
    : SEMANTIC_STAGE_IDS;
  const disabled = new Set(custom?.disabledStages?.map(semanticStageAlias));
  if (selected.some((stage) => disabled.has(stage))) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      "A required deterministic semantic stage cannot be disabled.",
    );
  }
  const settings = resolveCompilationSettings(configuration);
  const stages = selected.map((id, index) => ({
    id,
    required: true,
    enabled: true,
    agentic: false,
    dependencies: index ? [selected[index - 1]] : [],
    evaluatorIds: [],
  }));
  const profile = {
    name,
    criticalSystem: base === "critical-system",
    contextBudgetChars: settings.limits.maxCompilationRequestChars,
    agentInputBudgetChars: settings.limits.maxAgentInputChars,
    limits: settings.limits,
    executionBudgets: settings.budgets,
    stages,
    evaluators: [],
  };
  return {
    ...profile,
    fingerprint: await digest(
      JSON.stringify({ ...profile, kernelFingerprint }),
    ),
  };
}
