import type {
  AgentAdapter,
  AgentEvaluationRequest,
  AgentFinding,
} from "./types.ts";

type CommandRunner = (
  command: string,
  args: readonly string[],
  input: string,
  signal?: AbortSignal,
) => Promise<string>;

const defaultRunner: CommandRunner = async (command, args, input, signal) => {
  const child = new Deno.Command(command, {
    args: [...args],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    signal,
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  const result = await child.output();
  if (!result.success) {
    throw new Error(
      `${command} exited with ${result.code}: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    );
  }
  return new TextDecoder().decode(result.stdout);
};

abstract class ReadOnlyCliAdapter implements AgentAdapter {
  abstract readonly id: string;
  abstract readonly provider: "codex" | "claude";
  readonly capabilities = {
    readOnlyWorkspace: true,
    network: false,
    codeGeneration: false,
  } as const;

  constructor(
    readonly model?: string,
    private readonly runner: CommandRunner = defaultRunner,
  ) {}

  protected abstract invocation(): {
    command: string;
    args: readonly string[];
  };

  // @sigil implements packages/compiler/#module.sigil::SigilCompiler::AgentAdapter interface,logic,cases
  async evaluate(
    request: AgentEvaluationRequest,
  ): Promise<readonly AgentFinding[]> {
    const invocation = this.invocation();
    const raw = await this.runner(
      invocation.command,
      invocation.args,
      evaluationPrompt(request),
      request.signal,
    );
    return parseFindings(raw);
  }
}

export class CodexAdapter extends ReadOnlyCliAdapter {
  readonly id = "codex";
  readonly provider = "codex" as const;

  protected invocation(): { command: string; args: readonly string[] } {
    return {
      command: "codex",
      args: [
        "exec",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        ...(this.model ? ["--model", this.model] : []),
        "-",
      ],
    };
  }
}

export class ClaudeAdapter extends ReadOnlyCliAdapter {
  readonly id = "claude";
  readonly provider = "claude" as const;

  protected invocation(): { command: string; args: readonly string[] } {
    return {
      command: "claude",
      args: [
        "--print",
        "--permission-mode",
        "plan",
        "--tools",
        "",
        "--output-format",
        "text",
        ...(this.model ? ["--model", this.model] : []),
      ],
    };
  }
}

export class MockAdapter implements AgentAdapter {
  readonly id = "mock";
  readonly provider = "mock" as const;
  readonly capabilities = {
    readOnlyWorkspace: true,
    network: false,
    codeGeneration: false,
  } as const;

  constructor(
    private readonly findings:
      | readonly AgentFinding[]
      | ((request: AgentEvaluationRequest) => readonly AgentFinding[]) = [],
  ) {}

  evaluate(
    request: AgentEvaluationRequest,
  ): Promise<readonly AgentFinding[]> {
    return Promise.resolve(
      typeof this.findings === "function"
        ? this.findings(request)
        : this.findings,
    );
  }
}

function evaluationPrompt(request: AgentEvaluationRequest): string {
  return `You are a read-only Sigil evaluator running stage "${request.stage}".
Apply this evaluation skill:
${request.skill}

Evaluate only the supplied context. Do not edit files, execute commands, use
network access, or propose findings without concrete evidence. Return only a
JSON array. Each item must contain code, severity (error, warning, optimization,
or information), message, optional filePath/line/column, evidence, impact, and
correction.

Context:
${request.context}`;
}

function parseFindings(raw: string): readonly AgentFinding[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("Agent output did not contain a JSON findings array.");
  }
  const value: unknown = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(value)) {
    throw new Error("Agent findings must be an array.");
  }
  return value.map((item, index) => validateFinding(item, index));
}

function validateFinding(value: unknown, index: number): AgentFinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Agent finding ${index} must be an object.`);
  }
  const item = value as Record<string, unknown>;
  const severity = item.severity;
  if (
    !["error", "warning", "optimization", "information"].includes(
      String(severity),
    )
  ) throw new Error(`Agent finding ${index} has an invalid severity.`);
  for (
    const key of [
      "code",
      "message",
      "evidence",
      "impact",
      "correction",
    ]
  ) {
    if (typeof item[key] !== "string" || !item[key]) {
      throw new Error(`Agent finding ${index}.${key} must be non-empty.`);
    }
  }
  return {
    code: item.code as string,
    severity: severity as AgentFinding["severity"],
    message: item.message as string,
    filePath: typeof item.filePath === "string" ? item.filePath : undefined,
    line: typeof item.line === "number" ? item.line : undefined,
    column: typeof item.column === "number" ? item.column : undefined,
    evidence: item.evidence as string,
    impact: item.impact as string,
    correction: item.correction as string,
  };
}
