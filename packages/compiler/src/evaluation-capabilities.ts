import type {
  AdapterObservabilityDeclaration,
  AgentCapabilityContract,
} from "./types.ts";

export const REQUIRED_EVALUATION_CAPABILITIES: AgentCapabilityContract = {
  schemaVersion: 1,
  workspaceAccess: "read-only",
  agentToolNetwork: false,
  approvalEscalation: false,
  statePersistence: "ephemeral",
};

// @sigil implements packages/compiler/src/evaluation-capabilities.sigil::SigilAgentCapabilityContract::AgentCapabilityContract interface,cases
export function evaluationCapabilitiesFor(
  declared: AgentCapabilityContract,
): AgentCapabilityContract {
  return {
    schemaVersion: 1,
    workspaceAccess: "read-only",
    agentToolNetwork: false,
    approvalEscalation: false,
    statePersistence: declared.statePersistence,
  };
}

export const UNAVAILABLE_OBSERVABILITY: AdapterObservabilityDeclaration = {
  progress: "none",
  usage: "unavailable",
  cost: "unavailable",
  tokenBudgetEnforcement: "unavailable",
  costBudgetEnforcement: "unavailable",
};

// @sigil implements packages/compiler/src/evaluation-capabilities.sigil::SigilAgentCapabilityContract::AgentCapabilityContract interface,cases
export function capabilitiesMatch(
  requested: AgentCapabilityContract,
  declared: AgentCapabilityContract,
): boolean {
  return requested.schemaVersion === 1 && declared.schemaVersion === 1 &&
    requested.workspaceAccess === declared.workspaceAccess &&
    requested.agentToolNetwork === declared.agentToolNetwork &&
    requested.approvalEscalation === declared.approvalEscalation &&
    requested.statePersistence === declared.statePersistence;
}

// @sigil implements packages/compiler/src/evaluation-capabilities.sigil::SigilAgentCapabilityContract::AdapterObservabilityDeclaration interface
export function normalizeObservability(
  value: Partial<AdapterObservabilityDeclaration> | undefined,
): AdapterObservabilityDeclaration {
  return {
    progress: "none",
    usage: telemetry(value?.usage),
    cost: telemetry(value?.cost),
    tokenBudgetEnforcement: enforcement(value?.tokenBudgetEnforcement),
    costBudgetEnforcement: enforcement(value?.costBudgetEnforcement),
  };
}

function telemetry(value: unknown): "unavailable" | "partial" | "final" {
  return value === "partial" || value === "final" ? value : "unavailable";
}

function enforcement(
  value: unknown,
): "unavailable" | "preflight" | "live" | "post-settlement-only" {
  return value === "preflight" || value === "live" ||
      value === "post-settlement-only"
    ? value
    : "unavailable";
}
