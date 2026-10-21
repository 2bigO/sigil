/**
 * Finds reads of forbidden roots in the tool calls a host recorded for a pass.
 *
 * A pass runs from a staging directory outside the repo. It is invalid when
 * the orchestrator or any child read inside the sigil repo, an installed sigil
 * plugin, or the maintainer's Slotted workspace, since any of them can leak
 * the reference design. `scanReads` is a pure function over the calls that
 * `analyzeHostStream` collects, so a later stage can rerun it on retained
 * evidence.
 *
 * What it cannot see: reads through a symlink whose own path lies outside
 * every root, paths a program builds at run time (variables other than HOME,
 * command substitution, script files), files opened by a program the
 * orchestrator runs without naming them, and every child call on Pi.
 */
import { posix } from "node:path";
import type { HostName, ToolCall } from "./hosts.ts";

export interface ForbiddenRootsOptions {
  /** The sigil checkout; pass its real path. */
  readonly repoRoot: string;
  readonly home: string;
  /** The maintainer's Slotted workspace, when there is one. */
  readonly slottedWorkspace?: string;
}

/**
 * The repo, the Slotted workspace and every place a host keeps an installed
 * copy of sigil, from `docs/install/` and the hosts' own layouts:
 *
 * - Claude Code: the plugin cache `~/.claude/plugins/cache/sigil` and the
 *   marketplace clone `~/.claude/plugins/marketplaces/sigil`.
 * - Codex: the plugin cache `~/.codex/plugins/cache/sigil` and the
 *   marketplace snapshot `~/.codex/.tmp/marketplaces/sigil`.
 * - Pi: `pi install git:...` clones into `~/.pi/agent/git/<host>/<owner>/<repo>`.
 *   The whole `git` directory is forbidden so a fork's clone counts too.
 * - The user skill directories `~/.claude/skills`, `~/.codex/skills` and
 *   `~/.agents/skills`, whole: the retired `sigil skill install` left copies
 *   or symlinks into a checkout there, under names that changed over time.
 *
 * A pass has its skills staged, so none of these is a legitimate input.
 */
export function defaultForbiddenRoots(
  options: ForbiddenRootsOptions,
): string[] {
  const home = (path: string) => posix.join(options.home, path);
  const roots = [
    options.repoRoot,
    ...(options.slottedWorkspace ? [options.slottedWorkspace] : []),
    home(".claude/plugins/cache/sigil"),
    home(".claude/plugins/marketplaces/sigil"),
    home(".claude/skills"),
    home(".codex/plugins/cache/sigil"),
    home(".codex/.tmp/marketplaces/sigil"),
    home(".codex/skills"),
    home(".agents/skills"),
    home(".pi/agent/git"),
  ].map((root) => resolvePath(root, "/", options.home));
  return [...new Set(roots)];
}

export interface ReadScanOptions {
  /** Absolute directories nothing in the pass may read. */
  readonly forbiddenRoots: readonly string[];
  readonly home: string;
  /** The pass directory; the cwd of a call that records none. */
  readonly stagingDir: string;
}

/** What `scanReads` needs from a `HostAnalysis`. */
export interface ReadEvidence {
  readonly toolCalls: readonly ToolCall[];
  readonly childCount: number | null;
}

/**
 * `forbidden`: some call reached a forbidden root. `unverified`: none did,
 * but the host hid some child's calls. That is always so on Pi, whose stream
 * shows no child call. On Claude Code and Codex it is so when fewer child
 * sessions show a tool call than children were started, counting the
 * orchestrator's spawn calls and the child sessions the host shows. A child
 * that truly made no call is indistinguishable from a hidden one.
 * `clean`: every call is visible and none reached a forbidden root.
 */
export type ReadVerdict = "clean" | "forbidden" | "unverified";

export interface ForbiddenRead {
  /** The offending call, as the host recorded it. */
  readonly call: ToolCall;
  /** The resolved path, or search root, that reached the forbidden root. */
  readonly path: string;
  readonly root: string;
  /**
   * `path`: a path at or under a forbidden root. `recursive search`: a search
   * rooted at `/`, the home directory, or a forbidden root or its ancestor.
   */
  readonly reason: "path" | "recursive search";
}

export interface ReadScan {
  readonly verdict: ReadVerdict;
  readonly forbidden: ForbiddenRead[];
  /** Why the children's reads could not all be seen; null when they were. */
  readonly unverifiedReason: string | null;
}

/** The tools by which an orchestrator starts a child, on any host. */
const SPAWN_TOOLS = new Set([
  "Agent",
  "Task",
  "spawn_agent",
  "collab_tool_call",
  "subagent",
]);

export function scanReads(
  host: HostName,
  evidence: ReadEvidence,
  options: ReadScanOptions,
): ReadScan {
  const home = resolvePath(options.home, "/", "/");
  const roots = options.forbiddenRoots.map((root) =>
    resolvePath(root, "/", home)
  );
  const staging = resolvePath(options.stagingDir, "/", home);
  const forbidden: ForbiddenRead[] = [];
  // Claude Code keeps a shell's cwd from one Bash call to the next.
  const carried = new Map<string, string>();
  for (const call of evidence.toolCalls) {
    const recorded = call.cwd ? resolvePath(call.cwd, staging, home) : staging;
    const session = call.childSession ?? "";
    const current = host === "claude"
      ? carried.get(session) ?? recorded
      : recorded;
    const seen = new Set<string>();
    // A relative path is checked against the recorded cwd as well, in case
    // the carried one is wrong.
    for (const base of new Set([current, recorded])) {
      const targets = callTargets(call, base, home);
      if (base === current && targets.cwdAfter !== null) {
        carried.set(session, targets.cwdAfter);
      }
      for (const path of targets.paths) {
        const root = roots.find((r) => relation(path, r) === "under");
        if (root && !seen.has(`path ${path}`)) {
          seen.add(`path ${path}`);
          forbidden.push({ call, path, root, reason: "path" });
        }
      }
      for (const path of targets.searches) {
        const root = roots.find((r) => relation(path, r) !== null);
        const top = path === "/" || sameText(path, home);
        if ((root || top) && !seen.has(`search ${path}`)) {
          seen.add(`search ${path}`);
          forbidden.push({
            call,
            path,
            root: root ?? path,
            reason: "recursive search",
          });
        }
      }
    }
  }

  let unverifiedReason: string | null = null;
  if (host === "pi") {
    unverifiedReason = "Pi does not show its children's tool calls";
  } else {
    const spawned = evidence.toolCalls.filter((call) =>
      call.childSession === null && SPAWN_TOOLS.has(call.tool)
    ).length;
    const started = Math.max(spawned, evidence.childCount ?? 0);
    const visible = new Set(
      evidence.toolCalls.map((call) =>
        call.childSession
      ).filter((s) => s !== null),
    ).size;
    if (visible < started) {
      unverifiedReason = `${
        started - visible
      } of ${started} child sessions showed no tool calls`;
    }
  }
  return {
    verdict: forbidden.length > 0
      ? "forbidden"
      : unverifiedReason
      ? "unverified"
      : "clean",
    forbidden,
    unverifiedReason,
  };
}

/** What one call touched: paths read or named, and recursive search roots. */
interface Targets {
  readonly paths: string[];
  readonly searches: string[];
  /** The shell's cwd after the call, when it ran `cd`. */
  cwdAfter: string | null;
}

/** Input keys that name a file or directory, across the hosts' file tools. */
export const PATH_KEYS = [
  "file_path",
  "path",
  "notebook_path",
  "filePath",
  "paths",
  "file",
  "files",
  "directory",
  "dir",
];

function callTargets(call: ToolCall, base: string, home: string): Targets {
  const targets: Targets = { paths: [], searches: [], cwdAfter: null };
  const input = call.input;
  if (typeof input === "string") {
    if (call.tool === "apply_patch") {
      for (
        const match of input.matchAll(
          /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm,
        )
      ) {
        targets.paths.push(resolvePath(match[1].trim(), base, home));
      }
      return targets;
    }
    // Codex code mode: JavaScript calling `tools.exec_command({cmd: "..."})`.
    const workdir = stringLiteral(input, "workdir");
    const cwd = workdir ? resolvePath(workdir, base, home) : base;
    for (const command of stringLiterals(input, "cmd")) {
      merge(targets, analyzeShell(lexCommands(command), cwd, home));
    }
    for (const match of input.matchAll(PATH_IN_TEXT)) {
      targets.paths.push(resolvePath(match[0], cwd, home));
    }
    return targets;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return targets;
  }
  const record = input as Record<string, unknown>;
  const workdir = [record.workdir, record.working_directory, record.cwd].find((
    value,
  ): value is string => typeof value === "string");
  const cwd = workdir ? resolvePath(workdir, base, home) : base;
  const command = record.command ?? record.cmd;
  if (typeof command === "string") {
    merge(targets, analyzeShell(lexCommands(command), cwd, home));
  } else if (Array.isArray(command)) {
    const words = command.map(String);
    merge(
      targets,
      analyzeShell([{ words, redirects: [], outputs: [] }], cwd, home),
    );
  }
  for (const key of PATH_KEYS) {
    const value = record[key];
    for (const path of Array.isArray(value) ? value : [value]) {
      if (typeof path === "string" && path.length > 0) {
        targets.paths.push(resolvePath(path, cwd, home));
      }
    }
  }
  // Claude's Glob and Pi's find take a glob pattern under `path`; Claude's
  // Grep pattern is a regular expression and names no file.
  const tool = call.tool.toLowerCase();
  const searchDir = typeof record.path === "string"
    ? resolvePath(record.path, cwd, home)
    : cwd;
  if (
    (tool === "glob" || tool === "find") && typeof record.pattern === "string"
  ) {
    targets.paths.push(resolvePath(record.pattern, searchDir, home));
  }
  if (tool === "grep" || tool === "find") targets.searches.push(searchDir);
  return targets;
}

function merge(into: Targets, from: Targets): void {
  into.paths.push(...from.paths);
  into.searches.push(...from.searches);
  if (from.cwdAfter !== null) into.cwdAfter = from.cwdAfter;
}

/** Path-shaped words in free text: absolute, home-relative or dot-relative. */
const PATH_IN_TEXT =
  /(?<=^|[\s"'`=(:,{[<>|;&])(?:~|\$HOME|\$\{HOME\}|\.\.?)?\/[^\s"'`;|&<>(){}[\],]*|(?<=^|[\s"'`=(:,{[])~(?=$|[\s"'`;|&)\]},])/g;

/** Every double-quoted string literal given to `key:` in JavaScript text. */
export function stringLiterals(text: string, key: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(
    `["']?\\b${key}["']?\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`,
    "g",
  );
  for (const match of text.matchAll(pattern)) {
    try {
      values.push(JSON.parse(match[1]));
    } catch { /* Not a JSON-compatible literal; the path scan still runs. */ }
  }
  return values;
}

function stringLiteral(text: string, key: string): string | null {
  return stringLiterals(text, key)[0] ?? null;
}

/** One simple shell command: its words and its redirection targets. */
export interface SimpleCommand {
  readonly words: string[];
  /** Every redirection target, input and output alike. */
  readonly redirects: string[];
  /** The targets of output redirections (`>`, `>>`, `>&`, `&>`) only. */
  readonly outputs: string[];
}

const SEPARATORS = new Set([";", "|", "&", "&&", "||", "(", ")", "`"]);
const REDIRECTS = new Set(["<", ">", ">>", ">&", "&>", "<<"]);
const OUTPUT_REDIRECTS = new Set([">", ">>", ">&", "&>"]);

/**
 * Split a shell command into simple commands, honouring quotes and escapes
 * so that a quoted path with spaces stays one word. File descriptor numbers
 * before a redirection are dropped. Not a full shell: expansions stay as
 * written, apart from `~` and HOME, which `resolvePath` expands.
 */
export function lexCommands(command: string): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  let current: SimpleCommand = { words: [], redirects: [], outputs: [] };
  let word = "";
  let inWord = false;
  let redirectNext = false;
  let outputNext = false;
  const endWord = () => {
    if (!inWord) return;
    if (redirectNext) {
      current.redirects.push(word);
      if (outputNext) current.outputs.push(word);
    } else current.words.push(word);
    word = "";
    inWord = false;
    redirectNext = false;
    outputNext = false;
  };
  const operator = (op: string) => {
    // A number right before a redirection is a file descriptor.
    if (REDIRECTS.has(op) && inWord && /^\d+$/.test(word)) {
      word = "";
      inWord = false;
    }
    endWord();
    if (REDIRECTS.has(op)) {
      redirectNext = true;
      outputNext = OUTPUT_REDIRECTS.has(op);
    } else if (SEPARATORS.has(op)) {
      redirectNext = false;
      outputNext = false;
      if (current.words.length || current.redirects.length) {
        commands.push(current);
      }
      current = { words: [], redirects: [], outputs: [] };
    }
  };
  const length = command.length;
  for (let i = 0; i < length; i++) {
    const ch = command[i];
    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      const stop = close < 0 ? length : close;
      word += command.slice(i + 1, stop);
      inWord = true;
      i = stop;
    } else if (ch === '"') {
      inWord = true;
      for (i++; i < length && command[i] !== '"'; i++) {
        if (command[i] === "\\" && '"\\$`\n'.includes(command[i + 1] ?? "")) {
          i++;
          if (command[i] !== "\n") word += command[i];
        } else {
          word += command[i];
        }
      }
    } else if (ch === "\\") {
      if (i + 1 < length && command[i + 1] !== "\n") {
        word += command[i + 1];
        inWord = true;
      }
      i++;
    } else if (ch === " " || ch === "\t") {
      endWord();
    } else if (ch === "\n") {
      operator(";");
    } else if (ch === "#" && !inWord) {
      const newline = command.indexOf("\n", i);
      i = (newline < 0 ? length : newline) - 1;
    } else {
      const two = command.slice(i, i + 2);
      if (["&&", "||", ">>", ">&", "&>", "<<"].includes(two)) {
        operator(two);
        i++;
      } else if (";|&()<>`".includes(ch)) {
        operator(ch);
      } else {
        word += ch;
        inWord = true;
      }
    }
  }
  operator(";");
  return commands;
}

export const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const WRAPPERS = new Set([
  "env",
  "sudo",
  "command",
  "nice",
  "nohup",
  "time",
  "exec",
  "xargs",
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Collect the paths a sequence of simple commands names and the roots of its
 * recursive searches. Every path-shaped word counts, whatever the program,
 * so naming a forbidden path in a shell command counts as touching it. Bare
 * words such as `README.md` are relative to a cwd checked on its own, so only
 * words with a slash, `~`, `.` or `..`, redirection targets and `cd` targets
 * are paths.
 */
function analyzeShell(
  commands: readonly SimpleCommand[],
  base: string,
  home: string,
): Targets {
  const targets: Targets = { paths: [], searches: [], cwdAfter: null };
  let cwd = base;
  const addPath = (word: string) => {
    if (isPathLike(word)) targets.paths.push(resolvePath(word, cwd, home));
  };
  for (const { words, redirects } of commands) {
    for (const target of redirects) {
      targets.paths.push(resolvePath(target, cwd, home));
    }
    for (const word of words) {
      addPath(word);
      const value = word.match(/^-[^=]*=(.+)$/)?.[1] ??
        word.match(/^[A-Za-z_][A-Za-z0-9_]*=(.+)$/)?.[1];
      if (value) addPath(value);
    }
    const invoked = commandProgram(words);
    if (invoked === null) continue;
    const { program, args } = invoked;
    if (program === "cd" || program === "pushd") {
      const target = args.find((arg) => !arg.startsWith("-")) ?? "~";
      cwd = resolvePath(target, cwd, home);
      targets.paths.push(cwd);
      targets.cwdAfter = cwd;
    } else if (SHELLS.has(program)) {
      const flag = args.findIndex((arg) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
      if (flag >= 0 && args[flag + 1] !== undefined) {
        merge(targets, analyzeShell(lexCommands(args[flag + 1]), cwd, home));
      }
    } else if (program === "eval") {
      merge(targets, analyzeShell(lexCommands(args.join(" ")), cwd, home));
    }
    for (const root of searchRoots(program, args)) {
      targets.searches.push(resolvePath(root, cwd, home));
    }
  }
  return targets;
}

/**
 * The program a simple command runs, by base name, and its arguments, after
 * leading variable assignments and wrappers such as `env` or `sudo`; null
 * when the words run nothing.
 */
export function commandProgram(
  words: readonly string[],
): { program: string; args: string[] } | null {
  let at = 0;
  while (at < words.length && ASSIGNMENT.test(words[at])) at++;
  while (at < words.length && WRAPPERS.has(posix.basename(words[at]))) {
    at++;
    while (
      at < words.length &&
      (words[at].startsWith("-") || ASSIGNMENT.test(words[at]))
    ) at++;
  }
  if (at >= words.length) return null;
  return { program: posix.basename(words[at]), args: words.slice(at + 1) };
}

function isPathLike(word: string): boolean {
  return word.includes("/") || word === "~" || word === "." ||
    word === ".." || /^\$\{?HOME\}?$/.test(word);
}

/** Options that take the next word as their value, per search program. */
const VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  grep: new Set([
    "-e",
    "-f",
    "-m",
    "-A",
    "-B",
    "-C",
    "-d",
    "-D",
    "--regexp",
    "--file",
    "--max-count",
    "--include",
    "--exclude",
    "--exclude-dir",
    "--context",
    "--after-context",
    "--before-context",
  ]),
  rg: new Set([
    "-e",
    "-f",
    "-g",
    "-t",
    "-T",
    "-m",
    "-A",
    "-B",
    "-C",
    "-M",
    "-j",
    "-E",
    "-r",
    "--regexp",
    "--file",
    "--glob",
    "--iglob",
    "--type",
    "--type-not",
    "--max-count",
    "--max-depth",
    "--threads",
    "--encoding",
    "--sort",
    "--sortr",
    "--pre",
    "--replace",
  ]),
  fd: new Set(["-e", "-t", "-E", "-d", "--extension", "--type", "--exclude"]),
};

/**
 * The directories a recursive search covers, unresolved; empty when the
 * command is not one. A search given no directory covers the cwd (`.`).
 */
function searchRoots(program: string, args: readonly string[]): string[] {
  const shortFlag = (letter: string) =>
    args.some((arg) => new RegExp(`^-[a-zA-Z]*${letter}`).test(arg));
  let flags: ReadonlySet<string>;
  let hasPattern = true;
  switch (program) {
    case "find": {
      const end = args.findIndex((arg) => /^[-(!]/.test(arg));
      const roots = end < 0 ? args : args.slice(0, end);
      return roots.length > 0 ? [...roots] : ["."];
    }
    case "grep":
    case "egrep":
    case "fgrep":
    case "zgrep":
      if (
        !shortFlag("[rR]") &&
        !args.some((arg) => /^--(dereference-)?recursive$/.test(arg))
      ) return [];
      flags = VALUE_FLAGS.grep;
      break;
    case "rg":
    case "ag":
    case "ack":
      flags = VALUE_FLAGS.rg;
      if (args.includes("--files")) hasPattern = false;
      break;
    case "fd":
    case "fdfind":
      flags = VALUE_FLAGS.fd;
      break;
    case "tree":
      flags = new Set(["-L", "-P", "-I"]);
      hasPattern = false;
      break;
    case "ls":
      if (!shortFlag("R") && !args.includes("--recursive")) return [];
      flags = new Set();
      hasPattern = false;
      break;
    default:
      return [];
  }
  const positionals: string[] = [];
  let optionsEnded = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (optionsEnded || !arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
    } else if (arg === "--") {
      optionsEnded = true;
    } else if (flags.has(arg)) {
      // `-e` and `-f` give the pattern, so every positional is a directory.
      if (["-e", "-f", "--regexp", "--file"].includes(arg)) hasPattern = false;
      i++;
    }
  }
  const roots = hasPattern ? positionals.slice(1) : positionals;
  return roots.length > 0 ? roots : ["."];
}

/**
 * An absolute path: `~` and HOME expanded, resolved against `base`, and the
 * macOS `/private/tmp`, `/private/var` and `/private/etc` folded to the
 * `/tmp`, `/var` and `/etc` they alias. POSIX paths only.
 */
export function resolvePath(raw: string, base: string, home: string): string {
  let path = raw;
  if (path === "~" || path.startsWith("~/")) {
    path = home + path.slice(1);
  } else {
    path = path.replace(/^(?:\$\{HOME\}|\$HOME)(?=\/|$)/, home);
  }
  return posix.resolve("/", base, path).replace(
    /^\/private(?=\/(?:tmp|var|etc)(?:\/|$))/,
    "",
  );
}

/**
 * How `path` stands to `root`: `under` when it, or something it matches as a
 * glob, lies at or under the root; `above` when it is an ancestor of the
 * root; null otherwise. Segments compare ignoring case, since macOS volumes
 * usually do; a sibling sharing a prefix (`sigil-other`) is unrelated.
 */
function relation(path: string, root: string): "under" | "above" | null {
  const p = path.split("/").filter(Boolean);
  const r = root.split("/").filter(Boolean);
  for (let i = 0;; i++) {
    if (i === r.length) return "under";
    if (i === p.length) return "above";
    if (p[i] === "**") return "under";
    if (!segmentMatches(p[i], r[i])) return null;
  }
}

function segmentMatches(pattern: string, segment: string): boolean {
  if (!/[*?[]/.test(pattern)) return sameText(pattern, segment);
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") source += "[^/]*";
    else if (ch === "?") source += "[^/]";
    else if (ch === "[") {
      const close = pattern.indexOf("]", i + 2);
      if (close < 0) source += "\\[";
      else {
        const body = pattern.slice(i + 1, close).replace(/^!/, "^")
          .replace(/\\/g, "\\\\");
        source += `[${body}]`;
        i = close;
      }
    } else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  try {
    return new RegExp(`^${source}$`, "i").test(segment);
  } catch {
    return false;
  }
}

function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
