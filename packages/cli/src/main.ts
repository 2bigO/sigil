/** Command-line interface for versioned Sigil 0.6 workspaces. @module */
import { type HelpTopic, parseArgs } from "./args.ts";
import {
  type CompilationEvent,
  type CompilationReport,
  compile,
} from "@qoherent/sigil-compiler";
import { type CommandHandlerOptions, runCommand } from "./commands.ts";
import {
  EXIT_CANCELLED,
  EXIT_RUNTIME,
  EXIT_USAGE,
  exitCodeForDiagnostics,
} from "./exit.ts";
import { formatResult } from "./formatters.ts";
import metadata from "../deno.json" with { type: "json" };

const HELP: Readonly<Record<HelpTopic, string>> = {
  root: `Usage: sigil <command> [options]

Commands:
  skill             List or install bundled agent skills
  init              Create a workspace configuration
  version           Report workspace and contract versions
  parse             Parse one Sigil file
  check             Report workspace diagnostics
  fmt               Format selected Sigil source
  glossary          Inspect reviewed glossary terms and occurrences
  graph             Report the component and import graph
  context           Return context for a component or file
  compile           Evaluate Sigil until red, yellow, or green
  render            Render workspace documentation

Options:
  --help            Show this help
  --version         Show the sigil version
`,
  skill: `Usage: sigil skill <subcommand> [options]

Subcommands:
  list              List bundled agent skills
  install           Install bundled agent skills

Options:
  --help            Show this help
`,
  "skill-list": `Usage: sigil skill list [options]

Options:
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  "skill-install": `Usage: sigil skill install [options]

Options:
  --project         Install skills into the current repository
  --agent <value>   Install for codex, claude, opencode, pi, or all
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  init: `Usage: sigil init [path] [options]

Options:
  --name <value>    Set the workspace name
  --include <glob>  Include a source glob; may be repeated
  --exclude <glob>  Exclude a source glob; may be repeated
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  version: `Usage: sigil version [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  parse: `Usage: sigil parse <file> [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  check: `Usage: sigil check [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  fmt: `Usage: sigil fmt [path] [options]

Options:
  --check           Report noncanonical source without writing
  --root <path>     Use an explicit workspace root
  --format <value>  Output json or text
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  glossary: `Usage: sigil glossary [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  graph: `Usage: sigil graph [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  context:
    `Usage: sigil context [path] (--component <name> | --file <file>) [options]

Options:
  --component <name>  Select a component
  --file <file>       Select a Sigil file
  --root <path>       Use an explicit workspace root
  --format <value>    Output json, text, or markdown
  --pretty            Pretty-print JSON output
  --quiet             Suppress command output
  --help              Show this help
`,
  compile:
    `Usage: sigil compile [path] [--component <name> | --file <file>] [options]

Options:
  --component <name>  Compile one component
  --file <file>       Compile components represented by one file
  --profile <name>    Select a compilation profile (default: standard)
  --no-cache          Do not consult compilation history
  --output <file>     Export the authoritative report
  --format <value>    Output text or jsonl
  --root <path>       Use an explicit workspace root
  --quiet             Suppress human output
  --help              Show this help
`,
  render: `Usage: sigil render [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
};

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliRunOptions extends CommandHandlerOptions {
  readonly compiler?: typeof compile;
  readonly onCompilationEvent?: (line: string) => void | Promise<void>;
  readonly onCompilationProgress?: (line: string) => void | Promise<void>;
  readonly signal?: AbortSignal;
}

/**
 * @sigil implements packages/cli/#module.sigil::SigilCli::CliInvocation interface,logic,cases
 * @sigil implements packages/cli/#module.sigil::SigilCli::StructuredOutput interface,constraints
 * @sigil implements packages/cli/#module.sigil::SigilCli::ExitStatus constraints,cases
 */
export async function runCli(
  argv: readonly string[],
  options: CliRunOptions = {},
): Promise<CliRunResult> {
  const parsed = parseArgs(argv);
  if (parsed.kind === "help") {
    return { exitCode: 0, stdout: HELP[parsed.helpTopic], stderr: "" };
  }
  if (parsed.kind === "cli-version") {
    return { exitCode: 0, stdout: `${metadata.version}\n`, stderr: "" };
  }
  if (parsed.kind === "usage-error") {
    return {
      exitCode: EXIT_USAGE,
      stdout: "",
      stderr: `Error: ${parsed.message}\n\n${HELP[parsed.helpTopic]}`,
    };
  }

  try {
    if (parsed.request.command === "compile") {
      const events: CompilationEvent[] = [];
      const compileWorkspace = options.compiler ?? compile;
      const target = parsed.request.component
        ? { kind: "component" as const, value: parsed.request.component }
        : parsed.request.file
        ? { kind: "file" as const, value: parsed.request.file }
        : { kind: "workspace" as const };
      const report = await compileWorkspace(
        parsed.request.root ?? parsed.request.path ?? Deno.cwd(),
        target,
        {
          profile: parsed.request.profile,
          noHistory: parsed.request.noCache,
          output: parsed.request.output,
          signal: options.signal,
          onEvent: async (event) => {
            events.push(event);
            if (
              parsed.request.format === "jsonl" &&
              options.onCompilationEvent
            ) {
              await options.onCompilationEvent(`${JSON.stringify(event)}\n`);
            } else if (
              parsed.request.format !== "jsonl" &&
              options.onCompilationProgress
            ) {
              const progress = compilationProgress(event);
              if (progress) await options.onCompilationProgress(progress);
            }
          },
        },
      );
      const stdout = parsed.request.quiet
        ? ""
        : parsed.request.format === "jsonl"
        ? options.onCompilationEvent
          ? ""
          : events.map((event) => JSON.stringify(event)).join("\n") + "\n"
        : formatCompilation(report);
      return {
        exitCode: report.status === "green" ? 0 : 1,
        stdout,
        stderr: "",
      };
    }
    const result = await runCommand(parsed.request, options);
    const formatDifference = result.command === "fmt" && result.check &&
      result.files.some((file) => file.status === "noncanonical");
    return {
      exitCode: formatDifference
        ? 1
        : exitCodeForDiagnostics(result.diagnostics),
      stdout: formatResult(result, parsed.request),
      stderr: "",
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        exitCode: EXIT_CANCELLED,
        stdout: "",
        stderr: "Compilation cancelled.\n",
      };
    }
    return {
      exitCode: EXIT_RUNTIME,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

if (import.meta.main) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  Deno.addSignalListener("SIGINT", cancel);
  const result = await runCli(Deno.args, {
    signal: controller.signal,
    onCompilationEvent: async (line) => {
      await Deno.stdout.write(new TextEncoder().encode(line));
    },
    onCompilationProgress: async (line) => {
      await Deno.stderr.write(new TextEncoder().encode(line));
    },
  });
  Deno.removeSignalListener("SIGINT", cancel);
  if (result.stdout) {
    await Deno.stdout.write(new TextEncoder().encode(result.stdout));
  }
  if (result.stderr) {
    await Deno.stderr.write(new TextEncoder().encode(result.stderr));
  }
  Deno.exit(result.exitCode);
}

function compilationProgress(event: CompilationEvent): string {
  if (event.type === "started") return "Compiling Sigil...\n";
  if (event.type === "stage-started") {
    return `  ${String(event.payload.stage)}...\n`;
  }
  return "";
}

function formatCompilation(report: CompilationReport): string {
  const lines = [
    `${report.status.toUpperCase()} ${
      report.componentNames.join(", ") || "workspace"
    }`,
  ];
  for (const diagnostic of report.diagnostics) {
    const location = diagnostic.filePath
      ? `${diagnostic.filePath}${
        diagnostic.range
          ? `:${diagnostic.range.start.line}:${diagnostic.range.start.column}`
          : ""
      } `
      : "";
    lines.push(
      `${diagnostic.severity} ${diagnostic.code}: ${location}${diagnostic.message}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
