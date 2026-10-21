/**
 * The design-quality benchmark's command line. It has `sigil-write` author a
 * design from a benchmark's requirement file and measures the result against
 * the reference design.
 */
import process from "node:process";

export const COMMANDS = ["run", "measure", "reread", "report"] as const;
export type CommandName = typeof COMMANDS[number];

export const HELP = `Usage: bun run main.ts COMMAND [OPTIONS]

Commands:
  run      Regenerate designs: run --benchmark NAME --agent AGENT:MODEL...
           --reasoning LEVEL --passes N [--out DIR] [--timeout-ms MS]
  measure  Score a committed design and its stored readings without a model:
           measure --benchmark NAME [--root DIR --store DIR] [--out FILE]
  reread   Take new claims readings on stored designs, and with --coverage
           new coverage readings too: reread BATCH_DIR|reference [--coverage]
  report   Re-measure listed batches with the current sigilc and write one
           table per measure beside the reference: report DIR...

Benchmarks live in benchmarks/<name>/requirement.md. Evidence goes under
.benchmarks/ at the repository root.
`;

export type CommandHandler = (args: readonly string[]) => Promise<void>;

/** Handlers are registered by the modules that implement each command. */
export async function executeCommand(
  args: readonly string[],
  handlers: Partial<Record<CommandName, CommandHandler>> = {},
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
