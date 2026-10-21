/**
 * Finds writes outside the directories a pass may write, from the tool calls a
 * host recorded. It is the tool-call half of a write check; the other half is
 * a snapshot of the staging directory before and after the run, which catches
 * what a call does not name.
 *
 * A write is a path given to a file-writing tool (Write, Edit, NotebookEdit,
 * Pi's write and edit, Codex's apply_patch), the target of a shell output
 * redirection, or a path that a shell program writes: the destination of `cp`,
 * `mv`, `install` and `ln`, every operand of `mkdir`, `touch`, `tee`, `rm`,
 * `rmdir` and `truncate`, the files of `sed -i`, `dd of=`, the files `sigil
 * fmt` rewrites, and the `--out` and `--store` directories of `sigilc`.
 *
 * What it cannot see is what `scanReads` cannot see: paths a program builds at
 * run time, files a script writes without naming them on its command line, and
 * every child call on Pi.
 */
import { posix } from "node:path";
import type { HostName, ToolCall } from "./hosts.ts";
import {
  commandProgram,
  lexCommands,
  patchPaths,
  pathKeyTargets,
  recordWorkdir,
  resolvePath,
  SHELLS,
  type SimpleCommand,
  stringLiteral,
  stringLiterals,
} from "./read-scan.ts";

export interface WriteScanOptions {
  /** The pass directory; the cwd of a call that records none. */
  readonly stagingDir: string;
  /** Absolute directories the pass may write in. */
  readonly allowedDirs: readonly string[];
  readonly home: string;
}

export interface OutsideWrite {
  /** The offending call, as the host recorded it. */
  readonly call: ToolCall;
  /** The resolved path written. */
  readonly path: string;
}

/** Device files any shell may write to without touching the disk. */
const DEVICES = /^\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)$/;

/** Tools that write the file their path argument names. */
const WRITE_TOOLS = new Set([
  "write",
  "edit",
  "multiedit",
  "notebookedit",
  "create_file",
  "str_replace_editor",
]);

/** Every write some call made outside the allowed directories, in call order. */
export function scanWrites(
  host: HostName,
  calls: readonly ToolCall[],
  options: WriteScanOptions,
): OutsideWrite[] {
  const home = resolvePath(options.home, "/", "/");
  const staging = resolvePath(options.stagingDir, "/", home);
  const allowed = options.allowedDirs.map((dir) =>
    resolvePath(dir, staging, home)
  );
  const found: OutsideWrite[] = [];
  // Claude Code keeps a shell's cwd from one Bash call to the next.
  const carried = new Map<string, string>();
  for (const call of calls) {
    const recorded = call.cwd ? resolvePath(call.cwd, staging, home) : staging;
    const session = call.childSession ?? "";
    const base = host === "claude"
      ? carried.get(session) ?? recorded
      : recorded;
    const targets = writeTargets(call, base, home);
    if (targets.cwdAfter !== null) carried.set(session, targets.cwdAfter);
    const seen = new Set<string>();
    for (const path of targets.paths) {
      if (DEVICES.test(path) || seen.has(path)) continue;
      seen.add(path);
      if (!allowed.some((dir) => isUnder(path, dir))) {
        found.push({ call, path });
      }
    }
  }
  return found;
}

interface Targets {
  readonly paths: string[];
  cwdAfter: string | null;
}

function writeTargets(call: ToolCall, base: string, home: string): Targets {
  const targets: Targets = { paths: [], cwdAfter: null };
  const input = call.input;
  const tool = call.tool.toLowerCase();
  if (typeof input === "string") {
    if (tool === "apply_patch") {
      targets.paths.push(...resolveAll(patchPaths(input), base, home));
      return targets;
    }
    // Codex code mode: JavaScript calling `tools.exec_command({cmd: "..."})`.
    const workdir = stringLiteral(input, "workdir");
    const cwd = workdir ? resolvePath(workdir, base, home) : base;
    for (const command of stringLiterals(input, "cmd")) {
      merge(targets, shellWrites(lexCommands(command), cwd, home));
    }
    return targets;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return targets;
  }
  const record = input as Record<string, unknown>;
  const cwd = recordWorkdir(record, base, home);
  if (tool === "apply_patch") {
    const patch = record.input ?? record.patch;
    if (typeof patch === "string") {
      targets.paths.push(...resolveAll(patchPaths(patch), cwd, home));
    }
  }
  const command = record.command ?? record.cmd;
  if (typeof command === "string") {
    merge(targets, shellWrites(lexCommands(command), cwd, home));
  } else if (Array.isArray(command)) {
    const words = command.map(String);
    merge(
      targets,
      shellWrites([{ words, redirects: [], outputs: [] }], cwd, home),
    );
  }
  if (WRITE_TOOLS.has(tool)) {
    targets.paths.push(...pathKeyTargets(record, cwd, home));
  }
  return targets;
}

function resolveAll(
  paths: readonly string[],
  base: string,
  home: string,
): string[] {
  return paths.map((path) => resolvePath(path, base, home));
}

function merge(into: Targets, from: Targets): void {
  into.paths.push(...from.paths);
  if (from.cwdAfter !== null) into.cwdAfter = from.cwdAfter;
}

/** Programs every operand of which is a path they write. */
const WRITES_EVERY_OPERAND = new Set([
  "mkdir",
  "touch",
  "tee",
  "rm",
  "rmdir",
  "truncate",
  "unlink",
]);
/** Programs whose last operand, or `-t DIR`, is the destination. */
const WRITES_DESTINATION = new Set(["cp", "mv", "install", "ln", "rsync"]);
/** Options of the programs above that take the next word as their value. */
const VALUE_OPTIONS = new Set(["-t", "-S", "-m", "-o", "-g", "-s", "-e"]);

function shellWrites(
  commands: readonly SimpleCommand[],
  base: string,
  home: string,
): Targets {
  const targets: Targets = { paths: [], cwdAfter: null };
  let cwd = base;
  const add = (path: string) => {
    if (path.length > 0 && !/^\d+$/.test(path) && path !== "-") {
      targets.paths.push(resolvePath(path, cwd, home));
    }
  };
  for (const command of commands) {
    for (const target of command.outputs) add(target);
    const invoked = commandProgram(command.words);
    if (invoked === null) continue;
    const { program, args } = invoked;
    const operands = operandsOf(args);
    if (program === "cd" || program === "pushd") {
      const target = args.find((arg) => !arg.startsWith("-")) ?? "~";
      cwd = resolvePath(target, cwd, home);
      targets.cwdAfter = cwd;
    } else if (SHELLS.has(program)) {
      const flag = args.findIndex((arg) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
      if (flag >= 0 && args[flag + 1] !== undefined) {
        merge(targets, shellWrites(lexCommands(args[flag + 1]), cwd, home));
      }
    } else if (program === "eval") {
      merge(targets, shellWrites(lexCommands(args.join(" ")), cwd, home));
    } else if (WRITES_EVERY_OPERAND.has(program)) {
      operands.forEach(add);
    } else if (WRITES_DESTINATION.has(program)) {
      const flag = args.findIndex((arg) => arg === "-t");
      const long = args.find((arg) => arg.startsWith("--target-directory="));
      if (flag >= 0 && args[flag + 1] !== undefined) add(args[flag + 1]);
      else if (long) add(long.slice("--target-directory=".length));
      else if (operands.length > 0) add(operands[operands.length - 1]);
    } else if (program === "sed") {
      if (
        args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg === "--in-place")
      ) {
        // BSD `sed -i ''` gives an empty backup suffix as its own word.
        const files = operands.filter((operand) => operand !== "");
        const scripted = args.some((arg) => arg === "-e" || arg === "-f");
        (scripted ? files : files.slice(1)).forEach(add);
      }
    } else if (program === "dd") {
      for (const arg of args) if (arg.startsWith("of=")) add(arg.slice(3));
    } else if (program === "sigil") {
      if (args[0] === "fmt" && !args.includes("--check")) {
        operandsOf(args.slice(1)).forEach(add);
      }
      if (args[0] === "init") operandsOf(args.slice(1)).forEach(add);
    } else if (program === "sigilc") {
      for (let i = 0; i < args.length; i++) {
        const match = args[i].match(/^--(out|store)(?:=(.*))?$/);
        if (!match) continue;
        const value = match[2] ?? args[i + 1];
        if (value !== undefined) add(value);
      }
    }
  }
  return targets;
}

/** The non-option words of a command, skipping the values of known options. */
function operandsOf(args: readonly string[]): string[] {
  const operands: string[] = [];
  let ended = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (ended || !arg.startsWith("-") || arg === "-") operands.push(arg);
    else if (arg === "--") ended = true;
    else if (VALUE_OPTIONS.has(arg)) i++;
  }
  return operands;
}

/** True when `path` is `dir` or lies under it; segments ignore case. */
function isUnder(path: string, dir: string): boolean {
  const p = path.split("/").filter(Boolean);
  const d = dir.split("/").filter(Boolean);
  if (p.length < d.length) return false;
  return d.every((segment, i) => segment.toLowerCase() === p[i].toLowerCase());
}

/** A short description of a write, for a pass record. */
export function describeWrite(write: OutsideWrite): string {
  return `${write.call.actor} ${write.call.tool} wrote ${
    posix.normalize(write.path)
  }`;
}
