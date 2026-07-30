export type CommandName =
  | "skill"
  | "init"
  | "version"
  | "parse"
  | "check"
  | "fmt"
  | "glossary"
  | "graph"
  | "context"
  | "compile"
  | "render";
export type HelpTopic = "root" | CommandName | "skill-list" | "skill-install";
export type OutputFormat = "json" | "jsonl" | "text" | "markdown";
export type SkillAgent = "codex" | "claude" | "opencode" | "pi";

export interface GlobalOptions {
  readonly root?: string;
  readonly format?: OutputFormat;
  readonly pretty: boolean;
  readonly quiet: boolean;
}

export type CommandRequest =
  | SkillListRequest
  | SkillInstallRequest
  | InitRequest
  | VersionRequest
  | ParseRequest
  | CheckRequest
  | FmtRequest
  | GlossaryRequest
  | GraphRequest
  | ContextRequest
  | CompileRequest
  | RenderRequest;
export interface SkillListRequest extends GlobalOptions {
  readonly command: "skill-list";
}
export interface SkillInstallRequest extends GlobalOptions {
  readonly command: "skill-install";
  readonly project: boolean;
  readonly agents: readonly SkillAgent[];
}
export interface InitRequest extends GlobalOptions {
  readonly command: "init";
  readonly path?: string;
  readonly name?: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}
export interface VersionRequest extends GlobalOptions {
  readonly command: "version";
  readonly path?: string;
}
export interface ParseRequest extends GlobalOptions {
  readonly command: "parse";
  readonly file: string;
}
export interface CheckRequest extends GlobalOptions {
  readonly command: "check";
  readonly path?: string;
}
export interface FmtRequest extends GlobalOptions {
  readonly command: "fmt";
  readonly path?: string;
  readonly check: boolean;
}
export interface GlossaryRequest extends GlobalOptions {
  readonly command: "glossary";
  readonly path?: string;
}
export interface GraphRequest extends GlobalOptions {
  readonly command: "graph";
  readonly path?: string;
}
export interface ContextRequest extends GlobalOptions {
  readonly command: "context";
  readonly component?: string;
  readonly file?: string;
  readonly path?: string;
}
export interface CompileRequest extends GlobalOptions {
  readonly command: "compile";
  readonly component?: string;
  readonly file?: string;
  readonly path?: string;
  readonly profile?: string;
  readonly noCache: boolean;
  readonly output?: string;
}
export interface RenderRequest extends GlobalOptions {
  readonly command: "render";
  readonly path?: string;
}
export interface UsageError {
  readonly kind: "usage-error";
  readonly message: string;
  readonly helpTopic: HelpTopic;
}
export type ParseArgsResult = {
  readonly kind: "ok";
  readonly request: CommandRequest;
} | {
  readonly kind: "help";
  readonly helpTopic: HelpTopic;
} | {
  readonly kind: "cli-version";
} | UsageError;

// @sigil implements packages/cli/#module.sigil::SigilCli::CliInvocation interface,logic,cases
export function parseArgs(argv: readonly string[]): ParseArgsResult {
  if (argv[0] === "--help") return { kind: "help", helpTopic: "root" };
  if (argv[0] === "--version") return { kind: "cli-version" };

  const [commandName, ...rest] = argv;
  if (!isCommand(commandName)) {
    return usage(
      commandName
        ? `Unknown command "${commandName}".`
        : "Expected command: skill, init, version, parse, check, fmt, glossary, graph, context, compile, or render.",
      "root",
    );
  }

  const commandHelpTopic = helpTopicFor(commandName, rest[0]);
  if (commandName === "skill") {
    if (rest[0] === "--help") {
      return { kind: "help", helpTopic: "skill" };
    }
    if (
      (rest[0] === "list" || rest[0] === "install") &&
      rest.includes("--help")
    ) {
      return { kind: "help", helpTopic: `skill-${rest[0]}` };
    }
    if (rest.includes("--help")) {
      return usage(
        rest[0] && !rest[0].startsWith("-")
          ? `Unknown skill subcommand "${rest[0]}".`
          : "skill requires exactly one subcommand: list or install.",
        "skill",
      );
    }
  } else if (rest.includes("--help")) {
    return { kind: "help", helpTopic: commandName };
  }

  const positional: string[] = [];
  let root: string | undefined;
  let format: OutputFormat | undefined;
  let pretty = false;
  let quiet = false;
  let component: string | undefined;
  let file: string | undefined;
  let name: string | undefined;
  const include: string[] = [];
  const exclude: string[] = [];
  let project = false;
  let agent: SkillAgent | "all" | undefined;
  let profile: string | undefined;
  let noCache = false;
  let output: string | undefined;
  let check = false;

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const take = (flag: string): string | UsageError => {
      const value = rest[++index];
      return value && !value.startsWith("-")
        ? value
        : usage(`${flag} requires a value.`, commandHelpTopic);
    };
    switch (arg) {
      case "--root": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        root = value;
        break;
      }
      case "--format": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        if (!isFormat(value)) {
          return usage(
            "--format must be json, text, or markdown.",
            commandHelpTopic,
          );
        }
        format = value;
        break;
      }
      case "--pretty":
        pretty = true;
        break;
      case "--quiet":
        quiet = true;
        break;
      case "--project":
        project = true;
        break;
      case "--agent": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        if (!isSkillAgent(value) && value !== "all") {
          return usage(
            "--agent must be codex, claude, opencode, pi, or all.",
            commandHelpTopic,
          );
        }
        agent = value;
        break;
      }
      case "--component": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        component = value;
        break;
      }
      case "--file": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        file = value;
        break;
      }
      case "--profile": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        profile = value;
        break;
      }
      case "--no-cache":
        noCache = true;
        break;
      case "--check":
        check = true;
        break;
      case "--output": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        output = value;
        break;
      }
      case "--name": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        name = value;
        break;
      }
      case "--include": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        include.push(value);
        break;
      }
      case "--exclude": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        exclude.push(value);
        break;
      }
      default:
        if (arg.startsWith("-")) {
          return usage(`Unsupported option ${arg}.`, commandHelpTopic);
        }
        positional.push(arg);
    }
  }

  const base = { root, format, pretty, quiet };
  if (commandName !== "fmt" && check) {
    return usage(`${commandName} does not accept --check.`, commandHelpTopic);
  }
  if (
    commandName !== "context" && commandName !== "compile" &&
    (component || file)
  ) {
    return usage(
      `${commandName} does not accept --component or --file.`,
      commandHelpTopic,
    );
  }
  if (commandName !== "init" && (name || include.length || exclude.length)) {
    return usage(
      `${commandName} does not accept init options.`,
      commandHelpTopic,
    );
  }
  if (commandName !== "skill" && (project || agent)) {
    return usage(
      `${commandName} does not accept skill options.`,
      commandHelpTopic,
    );
  }
  if (
    commandName !== "compile" &&
    (profile || noCache || output || format === "jsonl")
  ) {
    return usage(
      `${commandName} does not accept compile options.`,
      commandHelpTopic,
    );
  }
  if (commandName === "skill") {
    if (root) {
      return usage("skill commands do not accept --root.", commandHelpTopic);
    }
    if (positional.length === 0) {
      return usage(
        "skill requires exactly one subcommand: list or install.",
        "skill",
      );
    }
    if (!["list", "install"].includes(positional[0])) {
      return usage(
        `Unknown skill subcommand "${positional[0]}".`,
        "skill",
      );
    }
    if (positional.length > 1) {
      return usage(
        `skill ${positional[0]} does not accept positional arguments.`,
        `skill-${positional[0]}` as "skill-list" | "skill-install",
      );
    }
    if (positional[0] === "list") {
      if (project || agent) {
        return usage(
          "skill list does not accept installation options.",
          "skill-list",
        );
      }
      return { kind: "ok", request: { command: "skill-list", ...base } };
    }
    return {
      kind: "ok",
      request: {
        command: "skill-install",
        project,
        agents: !agent || agent === "all"
          ? ["codex", "claude", "opencode", "pi"]
          : [agent],
        ...base,
      },
    };
  }
  if (commandName === "init") {
    if (root) {
      return usage(
        "init uses its path argument and does not accept --root.",
        "init",
      );
    }
    if (positional.length > 1) {
      return usage("init accepts at most one path.", "init");
    }
    return {
      kind: "ok",
      request: {
        command: "init",
        path: positional[0],
        name,
        include,
        exclude,
        ...base,
      },
    };
  }
  if (commandName === "version") {
    if (positional.length > 1) {
      return usage("version accepts at most one path.", "version");
    }
    return {
      kind: "ok",
      request: { command: "version", path: positional[0], ...base },
    };
  }
  if (commandName === "parse") {
    if (positional.length !== 1) {
      return usage("parse requires exactly one file.", "parse");
    }
    return {
      kind: "ok",
      request: { command: "parse", file: positional[0], ...base },
    };
  }
  if (
    commandName === "check" || commandName === "fmt" ||
    commandName === "glossary" ||
    commandName === "graph" ||
    commandName === "render"
  ) {
    if (
      commandName === "fmt" && format &&
      !["json", "text"].includes(format)
    ) {
      return usage("--format must be text or json for fmt.", "fmt");
    }
    if (positional.length > 1) {
      return usage(
        `${commandName} accepts at most one path.`,
        commandName,
      );
    }
    return {
      kind: "ok",
      request: {
        command: commandName,
        path: positional[0],
        ...(commandName === "fmt" ? { check } : {}),
        ...base,
      } as
        | CheckRequest
        | FmtRequest
        | GlossaryRequest
        | GraphRequest
        | RenderRequest,
    };
  }
  if (commandName === "compile") {
    if (positional.length > 1) {
      return usage("compile accepts at most one path.", "compile");
    }
    if (component && file) {
      return usage(
        "compile accepts only one of --component or --file.",
        "compile",
      );
    }
    if (format && format !== "jsonl" && format !== "text") {
      return usage("--format must be text or jsonl for compile.", "compile");
    }
    return {
      kind: "ok",
      request: {
        command: "compile",
        component,
        file,
        path: positional[0],
        profile,
        noCache,
        output,
        ...base,
      },
    };
  }
  if (positional.length > 1) {
    return usage("context accepts at most one path.", "context");
  }
  if (component && file) {
    return usage(
      "context accepts only one of --component or --file.",
      "context",
    );
  }
  if (!component && !file) {
    return usage("context requires --component or --file.", "context");
  }
  return {
    kind: "ok",
    request: {
      command: "context",
      component,
      file,
      path: positional[0],
      ...base,
    },
  };
}

function isCommand(value: string | undefined): value is CommandName {
  return value === "skill" || value === "init" || value === "version" ||
    value === "parse" ||
    value === "check" || value === "fmt" || value === "glossary" ||
    value === "graph" ||
    value === "context" ||
    value === "compile" ||
    value === "render";
}
function isSkillAgent(value: string): value is SkillAgent {
  return value === "codex" || value === "claude" || value === "opencode" ||
    value === "pi";
}
function isFormat(value: string): value is OutputFormat {
  return value === "json" || value === "jsonl" || value === "text" ||
    value === "markdown";
}
function helpTopicFor(
  commandName: CommandName,
  firstArgument: string | undefined,
): HelpTopic {
  if (
    commandName === "skill" &&
    (firstArgument === "list" || firstArgument === "install")
  ) {
    return `skill-${firstArgument}`;
  }
  return commandName;
}
function usage(message: string, helpTopic: HelpTopic): UsageError {
  return { kind: "usage-error", message, helpTopic };
}
