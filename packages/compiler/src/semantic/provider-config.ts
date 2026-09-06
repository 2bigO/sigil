export type SemanticProviderKind =
  | "codex"
  | "claude"
  | "pi"
  | "opencode"
  | "command";

export interface SemanticProviderConfiguration {
  readonly kind: SemanticProviderKind;
  readonly model?: string;
  readonly command?: string;
  readonly args?: readonly string[];
}

export interface SemanticToolsConfigurationV1 {
  readonly version: 1;
  readonly defaultProvider?: string;
  readonly proposalTimeoutMs?: number;
  readonly providers: Readonly<Record<string, SemanticProviderConfiguration>>;
}

export interface SemanticConfigIssue {
  readonly path: string;
  readonly message: string;
}

const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const KINDS: readonly SemanticProviderKind[] = [
  "codex",
  "claude",
  "pi",
  "opencode",
  "command",
];

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validateSemanticTools(value: unknown): {
  readonly config?: SemanticToolsConfigurationV1;
  readonly issues: readonly SemanticConfigIssue[];
} {
  const issues: SemanticConfigIssue[] = [];
  if (value === undefined) {
    return { config: { version: 1, providers: {} }, issues };
  }
  if (!object(value)) {
    return {
      issues: [{
        path: "tools.semantic",
        message: "semantic configuration must be an object.",
      }],
    };
  }
  if (
    Object.keys(value).some((key) =>
      !["version", "defaultProvider", "proposalTimeoutMs", "providers"]
        .includes(key)
    )
  ) {
    issues.push({
      path: "tools.semantic",
      message: "semantic configuration contains an unknown field.",
    });
  }
  if (value.version !== 1) {
    issues.push({
      path: "tools.semantic.version",
      message: "semantic configuration version must be 1.",
    });
  }
  if (
    value.defaultProvider !== undefined &&
    (typeof value.defaultProvider !== "string" ||
      !NAME.test(value.defaultProvider))
  ) {
    issues.push({
      path: "tools.semantic.defaultProvider",
      message: "defaultProvider must be a valid provider name.",
    });
  }
  const proposalTimeoutMs = value.proposalTimeoutMs;
  if (
    proposalTimeoutMs !== undefined &&
    (typeof proposalTimeoutMs !== "number" ||
      !Number.isSafeInteger(proposalTimeoutMs) || proposalTimeoutMs <= 0 ||
      proposalTimeoutMs > 2_147_483_647)
  ) {
    issues.push({
      path: "tools.semantic.proposalTimeoutMs",
      message:
        "proposalTimeoutMs must be a positive integer no greater than 2147483647.",
    });
  }
  if (!object(value.providers)) {
    issues.push({
      path: "tools.semantic.providers",
      message: "providers must be an object.",
    });
  }
  const providers: Record<string, SemanticProviderConfiguration> = {};
  if (object(value.providers)) {
    for (const [name, raw] of Object.entries(value.providers)) {
      if (!NAME.test(name)) {
        issues.push({
          path: `tools.semantic.providers.${name}`,
          message:
            "provider name must match [a-z][a-z0-9_-]* and be at most 64 characters.",
        });
        continue;
      }
      if (!object(raw)) {
        issues.push({
          path: `tools.semantic.providers.${name}`,
          message: "provider entry must be an object.",
        });
        continue;
      }
      if (
        typeof raw.kind !== "string" ||
        !KINDS.includes(raw.kind as SemanticProviderKind)
      ) {
        issues.push({
          path: `tools.semantic.providers.${name}.kind`,
          message:
            "provider kind must be codex, claude, pi, opencode, or command.",
        });
        continue;
      }
      const kind = raw.kind as SemanticProviderKind;
      const allowed = kind === "command"
        ? ["kind", "command", "args"]
        : ["kind", "model"];
      if (Object.keys(raw).some((key) => !allowed.includes(key))) {
        issues.push({
          path: `tools.semantic.providers.${name}`,
          message: `provider fields for ${kind} are ${allowed.join(", ")}.`,
        });
      }
      if (
        kind === "command" &&
        (typeof raw.command !== "string" || !raw.command.trim())
      ) {
        issues.push({
          path: `tools.semantic.providers.${name}.command`,
          message: "command providers require a non-empty command.",
        });
      }
      if (
        kind !== "command" && raw.model !== undefined &&
        (typeof raw.model !== "string" || !raw.model.trim())
      ) {
        issues.push({
          path: `tools.semantic.providers.${name}.model`,
          message: "model must be a non-empty string when supplied.",
        });
      }
      if (
        kind === "command" && raw.args !== undefined &&
        (!Array.isArray(raw.args) ||
          raw.args.some((arg) => typeof arg !== "string"))
      ) {
        issues.push({
          path: `tools.semantic.providers.${name}.args`,
          message: "command args must be literal strings.",
        });
      }
      if (kind === "command" && raw.model !== undefined) {
        issues.push({
          path: `tools.semantic.providers.${name}.model`,
          message: "command providers do not accept model.",
        });
      }
      if (
        kind !== "command" &&
        (raw.command !== undefined || raw.args !== undefined)
      ) {
        issues.push({
          path: `tools.semantic.providers.${name}`,
          message: "bundled providers do not accept command or args.",
        });
      }
      providers[name] = {
        kind,
        ...(typeof raw.model === "string" ? { model: raw.model } : {}),
        ...(typeof raw.command === "string" ? { command: raw.command } : {}),
        ...(Array.isArray(raw.args) ? { args: raw.args as string[] } : {}),
      };
    }
  }
  if (
    value.defaultProvider !== undefined &&
    typeof value.defaultProvider === "string" &&
    !Object.hasOwn(providers, value.defaultProvider)
  ) {
    issues.push({
      path: "tools.semantic.defaultProvider",
      message: `defaultProvider ${
        JSON.stringify(value.defaultProvider)
      } is not configured.`,
    });
  }
  return issues.length ? { issues } : {
    config: {
      version: 1,
      ...(typeof value.defaultProvider === "string"
        ? { defaultProvider: value.defaultProvider }
        : {}),
      ...(typeof proposalTimeoutMs === "number" ? { proposalTimeoutMs } : {}),
      providers,
    },
    issues,
  };
}

export function semanticToolsFrom(
  value: unknown,
): SemanticToolsConfigurationV1 {
  const result = validateSemanticTools(value);
  if (!result.config) {
    throw new Error(
      result.issues.map((issue) => `${issue.path}: ${issue.message}`).join(
        "\n",
      ),
    );
  }
  return result.config;
}
