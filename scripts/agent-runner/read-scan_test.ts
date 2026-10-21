import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  analyzeHostStream,
  buildHostLaunch,
  claudeDenySettings,
  type HostName,
  type JsonObject,
  type ToolCall,
} from "./hosts.ts";
import {
  defaultForbiddenRoots,
  type ReadScan,
  type ReadScanOptions,
  scanReads,
} from "./read-scan.ts";
import { withTempDir } from "./test_support.ts";

const HOME = "/home/u";
const REPO = "/home/u/work/sigil";
const SLOTTED = "/home/u/Slotted Work";
const STAGING = "/tmp/sigil-design-1/pass";

const ROOTS = defaultForbiddenRoots({
  repoRoot: REPO,
  home: HOME,
  slottedWorkspace: SLOTTED,
});

const OPTIONS: ReadScanOptions = {
  forbiddenRoots: ROOTS,
  home: HOME,
  stagingDir: STAGING,
};

/** A Claude stream: init, one Agent call, then the given child tool calls. */
function claudeStream(
  childCalls: readonly { name: string; input: JsonObject }[],
  orchestratorCalls: readonly { name: string; input: JsonObject }[] = [],
): JsonObject[] {
  const toolUse = (name: string, input: JsonObject, id = "toolu_x") => ({
    type: "tool_use",
    id,
    name,
    input,
  });
  return [
    { type: "system", subtype: "init", cwd: STAGING, agents: ["reviewer"] },
    {
      type: "assistant",
      message: {
        model: "model-o",
        content: [
          ...orchestratorCalls.map((c) => toolUse(c.name, c.input)),
          toolUse(
            "Agent",
            { subagent_type: "reviewer", prompt: "Review it." },
            "toolu_agent",
          ),
        ],
      },
    },
    ...childCalls.map((call) => ({
      type: "assistant",
      parent_tool_use_id: "toolu_agent",
      message: { model: "model-c", content: [toolUse(call.name, call.input)] },
    })),
    { type: "result", result: "done" },
  ];
}

async function scanClaude(
  childCalls: readonly { name: string; input: JsonObject }[],
  orchestratorCalls: readonly { name: string; input: JsonObject }[] = [],
): Promise<ReadScan> {
  const analysis = await analyzeHostStream(
    "claude",
    claudeStream(childCalls, orchestratorCalls),
    { childNames: ["reviewer"] },
  );
  return scanReads("claude", analysis, OPTIONS);
}

/** Scan one child Bash command on Claude. */
function scanBash(command: string): Promise<ReadScan> {
  return scanClaude([{ name: "Bash", input: { command } }]);
}

const rollout = (lines: unknown[]) =>
  lines.map((line) => JSON.stringify(line)).join("\n") + "\n";

/** A Codex home with a parent rollout and one child rollout. */
async function codexHome(
  root: string,
  childLines: readonly unknown[],
  childCwd: string,
): Promise<string> {
  const home = join(root, "codex-home");
  const sessions = join(home, "sessions/2026/10/21");
  await mkdir(sessions, { recursive: true });
  await writeFile(
    join(sessions, "rollout-1-parent.jsonl"),
    rollout([
      { type: "session_meta", payload: { id: "p", cwd: STAGING } },
      { type: "turn_context", payload: { cwd: STAGING, model: "gpt-o" } },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "spawn_agent",
          arguments: JSON.stringify({ fork_turns: "none", task_name: "r" }),
        },
      },
    ]),
  );
  await writeFile(
    join(sessions, "rollout-2-child.jsonl"),
    rollout([
      {
        type: "session_meta",
        payload: {
          id: "c",
          cwd: childCwd,
          source: { subagent: { thread_spawn: { agent_path: "/root/r" } } },
        },
      },
      { type: "turn_context", payload: { cwd: childCwd, model: "gpt-c" } },
      ...childLines,
    ]),
  );
  return home;
}

async function scanCodex(
  childLines: readonly unknown[],
  childCwd = STAGING,
): Promise<ReadScan> {
  let scan: ReadScan | null = null;
  await withTempDir("agent-runner-read-scan-", async (root) => {
    const home = await codexHome(root, childLines, childCwd);
    const analysis = await analyzeHostStream("codex", [], {
      childNames: ["reviewer"],
      codexHome: home,
    });
    scan = scanReads("codex", analysis, OPTIONS);
  });
  return scan!;
}

function assertForbidden(scan: ReadScan, path: string): void {
  assert.equal(scan.verdict, "forbidden", JSON.stringify(scan));
  assert.ok(
    scan.forbidden.some((finding) => finding.path === path),
    `no finding for ${path}: ${JSON.stringify(scan.forbidden)}`,
  );
}

test("a Claude child's Read of a repo example by absolute path is forbidden", async () => {
  const path = `${REPO}/examples/slotted/booking.sigil`;
  const scan = await scanClaude([{ name: "Read", input: { file_path: path } }]);
  assertForbidden(scan, path);
  assert.equal(scan.forbidden[0].call.actor, "reviewer");
  assert.equal(scan.forbidden[0].call.tool, "Read");
  assert.equal(scan.forbidden[0].root, REPO);
});

test("an orchestrator's own read of the repo is forbidden", async () => {
  const path = `${REPO}/README.md`;
  const scan = await scanClaude(
    [{ name: "Read", input: { file_path: `${STAGING}/requirement.md` } }],
    [{ name: "Read", input: { file_path: path } }],
  );
  assertForbidden(scan, path);
  assert.equal(scan.forbidden[0].call.actor, "orchestrator");
});

test("a Codex child's relative cat that climbs into the repo is forbidden", async () => {
  const path = `${REPO}/examples/slotted/rooms.sigil`;
  const scan = await scanCodex(
    [{
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd: "cat ../../examples/slotted/rooms.sigil",
          workdir: `${REPO}/out/stage`,
        }),
      },
    }],
    `${REPO}/out/stage`,
  );
  assertForbidden(scan, path);
  assert.equal(scan.forbidden[0].call.actor, "/root/r");
});

test("a Codex child's code-mode exec reading through a cd is forbidden", async () => {
  const path = `${REPO}/examples/slotted/rooms.sigil`;
  const scan = await scanCodex([{
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "exec",
      input:
        `const r = await tools.exec_command({cmd:"cd ${REPO}/out/stage && cat ../../examples/slotted/rooms.sigil",max_output_tokens:3000});\ntext(r.output);\n`,
    },
  }]);
  assertForbidden(scan, path);
});

test("a Codex child that reads only the staging directory is clean", async () => {
  const scan = await scanCodex([{
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({
        cmd: "cat requirement.md skills/sigil-write/SKILL.md && rg Booking",
        workdir: STAGING,
      }),
    },
  }]);
  assert.equal(scan.verdict, "clean", JSON.stringify(scan));
});

test("a recursive grep of the home directory is forbidden", async () => {
  const scan = await scanBash("grep -r Booking ~");
  assertForbidden(scan, HOME);
  assert.equal(scan.forbidden[0].reason, "recursive search");
});

test("find from the filesystem root is forbidden", async () => {
  const scan = await scanBash("find / -name '*.sigil' 2>/dev/null");
  assertForbidden(scan, "/");
  assert.equal(scan.forbidden[0].reason, "recursive search");
});

test("a recursive search of an ancestor of the repo is forbidden", async () => {
  assertForbidden(await scanBash("rg --files /home/u/work"), "/home/u/work");
  assertForbidden(await scanBash("rg -g '*.sigil' Room $HOME"), HOME);
});

test("a recursive search of home or / is forbidden even with no root under it", async () => {
  const analysis = await analyzeHostStream(
    "claude",
    claudeStream([
      { name: "Bash", input: { command: "grep -rl Booking ~" } },
      { name: "Bash", input: { command: "find / -name x" } },
    ]),
    { childNames: ["reviewer"] },
  );
  const scan = scanReads("claude", analysis, {
    ...OPTIONS,
    forbiddenRoots: ["/srv/sigil"],
  });
  assert.deepEqual(scan.forbidden.map((f) => f.path), [HOME, "/"]);
});

test("a path-shaped grep pattern is not taken for the searched directory", async () => {
  const scan = await scanBash("grep -rn /home/u/work .");
  assert.equal(scan.verdict, "clean", JSON.stringify(scan));
});

test("rg without a path searches the staging cwd and is clean", async () => {
  const scan = await scanBash("rg -n Booking");
  assert.equal(scan.verdict, "clean", JSON.stringify(scan));
});

test("a non-recursive listing of the home directory is clean", async () => {
  const scan = await scanBash("ls ~ && grep Booking ~/notes.txt");
  assert.equal(scan.verdict, "clean", JSON.stringify(scan));
});

test("a read through the /private/tmp alias of the staging dir is clean", async () => {
  const scan = await scanClaude([{
    name: "Read",
    input: { file_path: "/private/tmp/sigil-design-1/pass/requirement.md" },
  }]);
  assert.equal(scan.verdict, "clean", JSON.stringify(scan));
});

test("the /private/var alias of a forbidden root is still forbidden", async () => {
  const root = "/var/folders/xy/T/slotted";
  const analysis = await analyzeHostStream(
    "claude",
    claudeStream([{
      name: "Read",
      input: { file_path: "/private/var/folders/xy/T/slotted/rooms.sigil" },
    }]),
    { childNames: ["reviewer"] },
  );
  const scan = scanReads("claude", analysis, {
    ...OPTIONS,
    forbiddenRoots: [root],
  });
  assertForbidden(scan, `${root}/rooms.sigil`);
});

test("a read of the installed Claude plugin cache is forbidden", async () => {
  const path =
    `${HOME}/.claude/plugins/cache/sigil/sigil/0.9.0/examples/slotted/slotted.sigil`;
  const scan = await scanClaude([{ name: "Read", input: { file_path: path } }]);
  assertForbidden(scan, path);
  assert.equal(scan.forbidden[0].root, `${HOME}/.claude/plugins/cache/sigil`);
});

test("a home-relative read of the Codex plugin cache is forbidden", async () => {
  const scan = await scanBash(
    "cat ~/.codex/plugins/cache/sigil/sigil/0.9.0/skills/sigil-write/SKILL.md",
  );
  assertForbidden(
    scan,
    `${HOME}/.codex/plugins/cache/sigil/sigil/0.9.0/skills/sigil-write/SKILL.md`,
  );
});

test("a quoted path with spaces into the Slotted workspace is forbidden", async () => {
  const scan = await scanBash(`head -n 20 '${SLOTTED}/booking.sigil'`);
  assertForbidden(scan, `${SLOTTED}/booking.sigil`);
});

test("a sibling sharing a forbidden root's prefix is clean", async () => {
  const scan = await scanClaude([
    { name: "Read", input: { file_path: `${REPO}-other/notes.md` } },
    { name: "Bash", input: { command: "cat /home/u/Slotted/notes.md" } },
  ]);
  assert.equal(scan.verdict, "clean", JSON.stringify(scan));
});

test("Glob and Grep with a path parameter are checked as searches", async () => {
  assertForbidden(
    await scanClaude([{
      name: "Glob",
      input: { pattern: "**/*.sigil", path: HOME },
    }]),
    `${HOME}/**/*.sigil`,
  );
  assertForbidden(
    await scanClaude([{
      name: "Glob",
      input: { pattern: `${REPO}/examples/**/*.sigil` },
    }]),
    `${REPO}/examples/**/*.sigil`,
  );
  assertForbidden(
    await scanClaude([{
      name: "Grep",
      input: { pattern: "Booking", path: "/home/u/work" },
    }]),
    "/home/u/work",
  );
  // A Grep pattern is a regular expression, not a path.
  const clean = await scanClaude([
    { name: "Grep", input: { pattern: REPO } },
    { name: "Glob", input: { pattern: "**/*.md" } },
  ]);
  assert.equal(clean.verdict, "clean", JSON.stringify(clean));
});

test("a cd in one Claude shell call carries to the next", async () => {
  const scan = await scanClaude([
    { name: "Bash", input: { command: "cd /home/u/work" } },
    { name: "Bash", input: { command: "cat sigil/examples/x.sigil" } },
  ]);
  assertForbidden(scan, `${REPO}/examples/x.sigil`);
});

test("a Pi stream with no child tool calls is unverified", async () => {
  const events = [{
    type: "message_end",
    message: {
      role: "assistant",
      model: "m",
      content: [{
        type: "toolCall",
        name: "subagent",
        arguments: { agent: "reviewer", task: "Review.", context: "fresh" },
      }, {
        type: "toolCall",
        name: "read",
        arguments: { path: "requirement.md" },
      }],
    },
  }];
  const analysis = await analyzeHostStream("pi", events, {
    childNames: ["reviewer"],
  });
  const scan = scanReads("pi", analysis, OPTIONS);
  assert.equal(scan.verdict, "unverified");
  assert.match(scan.unverifiedReason ?? "", /Pi/);

  // A forbidden read the orchestrator shows still wins over unverified.
  const leaked = await analyzeHostStream("pi", [{
    type: "message_end",
    message: {
      role: "assistant",
      content: [{
        type: "toolCall",
        name: "read",
        arguments: { path: `${REPO}/examples/slotted/rooms.sigil` },
      }],
    },
  }], { childNames: ["reviewer"] });
  assert.equal(scanReads("pi", leaked, OPTIONS).verdict, "forbidden");
});

test("a Claude child that shows no tool calls leaves the reads unverified", async () => {
  const scan = await scanClaude([]);
  assert.equal(scan.verdict, "unverified");
  assert.match(scan.unverifiedReason ?? "", /1 of 1/);
});

test("a Codex child rollout without calls leaves the reads unverified", async () => {
  const scan = await scanCodex([]);
  assert.equal(scan.verdict, "unverified");
});

test("a run that starts no child and reads only staging is clean", async () => {
  const analysis = await analyzeHostStream("claude", [
    { type: "system", subtype: "init", cwd: STAGING },
    {
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "t",
          name: "Read",
          input: { file_path: "requirement.md" },
        }],
      },
    },
  ], { childNames: ["reviewer"] });
  const scan = scanReads("claude", analysis, OPTIONS);
  assert.equal(scan.verdict, "clean");
  assert.equal(scan.unverifiedReason, null);
});

test("the default forbidden roots cover every host's sigil install", () => {
  assert.deepEqual(defaultForbiddenRoots({ repoRoot: REPO, home: HOME }), [
    REPO,
    `${HOME}/.claude/plugins/cache/sigil`,
    `${HOME}/.claude/plugins/marketplaces/sigil`,
    `${HOME}/.claude/skills`,
    `${HOME}/.codex/plugins/cache/sigil`,
    `${HOME}/.codex/.tmp/marketplaces/sigil`,
    `${HOME}/.codex/skills`,
    `${HOME}/.agents/skills`,
    `${HOME}/.pi/agent/git`,
  ]);
  assert.ok(ROOTS.includes(SLOTTED));
});

test("the Claude settings deny reads under every forbidden root", () => {
  // Claude Code applies a Read deny rule to Grep and Glob as well; a
  // `Glob(path)` rule is never consulted, so one Read rule per root is all.
  const settings = claudeDenySettings([REPO, `${SLOTTED}/`]);
  assert.deepEqual(settings, {
    permissions: {
      deny: [`Read(/${REPO}/**)`, `Read(/${SLOTTED}/**)`],
    },
  });
  const all = claudeDenySettings(ROOTS);
  const deny = (all.permissions as { deny: string[] }).deny;
  assert.equal(deny.length, ROOTS.length);
  assert.ok(deny.every((rule) => rule.startsWith("Read(//")));
});

test("extra host arguments come before the prompt separator", async () => {
  await withTempDir("agent-runner-read-scan-", async (root) => {
    const base = {
      model: "m",
      childModel: "m",
      passDir: root,
      allowedShell: [],
      children: [{
        name: "reviewer",
        description: "d",
        prompt: "p",
        claudeTools: ["Read"],
        piTools: ["read"],
      }],
      piSubagentsEntry: "/pi/index.js",
      hostArgs: ["--settings", "{}"],
    };
    for (const host of ["claude", "pi", "codex"] as HostName[]) {
      const launch = await buildHostLaunch({
        ...base,
        host,
        codexHome: join(root, "home"),
      });
      const args = [...launch.args];
      const at = args.indexOf("--settings");
      assert.ok(at >= 0, `${host} lacks the extra arguments`);
      assert.equal(args[at + 1], "{}");
      if (host !== "codex") assert.equal(args.at(-1), "--");
      else assert.equal(at + 2, args.length);
    }
  });
});

test("tool calls record their actor, child session and cwd", async () => {
  const analysis = await analyzeHostStream(
    "claude",
    claudeStream([{ name: "Read", input: { file_path: "a.md" } }]),
    { childNames: ["reviewer"] },
  );
  const calls: ToolCall[] = analysis.toolCalls;
  assert.deepEqual(calls.map((c) => [c.actor, c.tool, c.childSession, c.cwd]), [
    ["orchestrator", "Agent", null, STAGING],
    ["reviewer", "Read", "toolu_agent", STAGING],
  ]);
});
