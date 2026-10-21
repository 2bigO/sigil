/**
 * The design-quality benchmark's command line. It has `sigil-write` author a
 * design from a benchmark's requirement file and measures the result against
 * the reference design.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { measureDesign, requirementInputs, sigilcIdentity } from "./measure.ts";
import {
  benchmarkNamed,
  defaultSigilc,
  PACKAGE_DIR,
  referenceFor,
  referenceStorePaths,
  REPO_ROOT,
} from "./records.ts";
import { buildReport, renderMeasureReport } from "./report.ts";

export const COMMANDS = ["run", "measure", "reread", "report"] as const;
export type CommandName = typeof COMMANDS[number];

export const HELP = `Usage: bun run main.ts COMMAND [OPTIONS]

Commands:
  run      Regenerate designs: run --benchmark NAME --agent AGENT:MODEL...
           --reasoning LEVEL --passes N [--out DIR] [--timeout-ms MS]
  measure  Score a committed design and its stored readings without a model:
           measure --benchmark NAME [--root DIR --store DIR]
           [--coverage FILE] [--sigilc PATH] [--json] [--out FILE]
  reread   Take new claims readings on stored designs, and with --coverage
           new coverage readings too: reread BATCH_DIR|reference [--coverage]
  report   Re-measure listed batches with the current sigilc and write one
           table per measure beside the reference: report DIR...
           [--sigilc PATH] [--out FILE]

Benchmarks live in benchmarks/<name>/requirement.md. Evidence goes under
.benchmarks/ at the repository root.
`;

export type CommandHandler = (args: readonly string[]) => Promise<void>;

/** Split `--name value` options and positional arguments. */
export function parseOptions(
  args: readonly string[],
  valued: readonly string[],
  flags: readonly string[] = [],
): { options: Map<string, string>; flags: Set<string>; positional: string[] } {
  const options = new Map<string, string>();
  const seen = new Set<string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (flags.includes(arg)) {
      seen.add(arg);
    } else if (valued.includes(arg)) {
      const value = args[++index];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (options.has(arg)) throw new Error(`${arg} is given twice`);
      options.set(arg, value);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}\n\n${HELP}`);
    } else positional.push(arg);
  }
  return { options, flags: seen, positional };
}

async function emit(text: string, out: string | undefined): Promise<void> {
  if (out === undefined) {
    process.stdout.write(text);
    return;
  }
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(out, text);
}

export const measureCommand: CommandHandler = async (args) => {
  const { options, flags, positional } = parseOptions(
    args,
    ["--benchmark", "--root", "--store", "--coverage", "--sigilc", "--out"],
    ["--json"],
  );
  if (positional.length > 0) {
    throw new Error(`Unexpected argument: ${positional[0]}`);
  }
  const benchmark = options.get("--benchmark");
  if (!benchmark) throw new Error("measure needs --benchmark NAME");
  const definition = benchmarkNamed(benchmark);
  const reference = referenceFor(definition.list);
  const referencePaths = referenceStorePaths(
    join(PACKAGE_DIR, reference.store),
  );
  const givenRoot = options.get("--root");
  if (givenRoot !== undefined && !options.has("--store")) {
    throw new Error("measure --root needs --store as well");
  }
  const root = givenRoot ?? join(REPO_ROOT, reference.root);
  const store = options.get("--store") ?? referencePaths.store;
  const coveragePath = options.get("--coverage") ??
    (givenRoot === undefined ? referencePaths.coverage : undefined);
  const sigilc = options.get("--sigilc") ?? defaultSigilc();
  const requirements = await requirementInputs(benchmark);
  const measures = await measureDesign({
    sigilc,
    root,
    store,
    coverage: coveragePath === undefined
      ? { reason: "no coverage reading given" }
      : { path: coveragePath },
    requirements,
  });
  await emit(
    flags.has("--json")
      ? `${JSON.stringify(measures, null, 2)}\n`
      : renderMeasureReport({
        benchmark,
        sigilc: await sigilcIdentity(sigilc),
        requirements,
        measures,
      }),
    options.get("--out"),
  );
};

export const reportCommand: CommandHandler = async (args) => {
  const { options, positional } = parseOptions(args, ["--sigilc", "--out"]);
  const text = await buildReport({
    batchDirs: positional,
    sigilc: options.get("--sigilc") ?? defaultSigilc(),
  });
  await emit(text, options.get("--out"));
};

/** `run` and `reread` arrive with the regenerate pass (U7). */
export const HANDLERS: Partial<Record<CommandName, CommandHandler>> = {
  measure: measureCommand,
  report: reportCommand,
};

export async function executeCommand(
  args: readonly string[],
  handlers: Partial<Record<CommandName, CommandHandler>> = HANDLERS,
): Promise<void> {
  const [command, ...tail] = args;
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
  const handler = handlers[command as CommandName];
  if (handler === undefined) {
    throw new Error(`The ${command} command is not available yet`);
  }
  await handler(tail);
}

if (import.meta.main) {
  try {
    await executeCommand(process.argv.slice(2));
  } catch (cause) {
    process.stderr.write(
      `${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exitCode = 1;
  }
}
