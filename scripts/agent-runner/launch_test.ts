import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { exists } from "./files.ts";
import type { ChildAgentDefinition } from "./hosts.ts";
import { launchAgent, type LaunchRequest } from "./launch.ts";
import {
  isAlive,
  type ScriptCommand,
  sleeperSource,
  spawnSleeperSource,
  waitFor,
  withTempDir,
  writeScript,
} from "./test_support.ts";

const WRITER: ChildAgentDefinition = {
  name: "writer-child",
  description: "Writes one file",
  prompt: "Write the file you are told to write.",
  claudeTools: ["Read", "Write"],
  piTools: ["read", "write"],
};

type Verdict = "accepted" | "rejected";

function parseVerdict(text: string): Verdict | null {
  const match = text.match(/^Verdict: (accepted|rejected)$/m);
  return match ? match[1] as Verdict : null;
}

/** A fake host body that answers `--version`, then runs `body`. */
function hostSource(body: string): string {
  return `if (process.argv.includes("--version")) {
  console.log("fake 2.0.0");
  process.exit(0);
}
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
${body}
`;
}

async function setUp(
  root: string,
  body: string,
): Promise<Omit<LaunchRequest<Verdict>, "prompt">> {
  const passDir = join(root, "pass");
  await mkdir(passDir, { recursive: true });
  await mkdir(join(root, "bin"));
  const host: ScriptCommand = await writeScript(
    join(root, "host.mjs"),
    hostSource(body),
  );
  return {
    agent: "claude",
    requestedModel: "model-w",
    reasoning: "medium",
    passDir,
    binDir: join(root, "bin"),
    evidenceDir: join(root, "evidence"),
    timeoutMs: 15_000,
    executable: host.executable,
    executableArgs: host.args,
    allowedShell: ["sigil", "git"],
    children: [WRITER],
    parseHandback: parseVerdict,
  };
}

test("a custom prompt, shell allowlist and hand-back parser are used and the evidence is kept", async () => {
  await withTempDir("agent-runner-launch-", async (root) => {
    const request = await setUp(
      root,
      `import { writeFileSync } from "node:fs";
writeFileSync("argv.json", JSON.stringify(process.argv.slice(2)));
writeFileSync("path.txt", process.env.PATH ?? "");
emit({ type: "assistant", message: { model: "model-served", content: [] } });
process.stderr.write("a warning\\n");
emit({ type: "result", result: "Wrote it.\\nVerdict: accepted\\n" });
`,
    );
    const contexts: unknown[] = [];
    const result = await launchAgent({
      ...request,
      prompt: (context) => {
        contexts.push(context);
        return `Custom prompt. ${context.spawnInstruction}`;
      },
    });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.handback, "accepted");
    assert.equal(result.hostVersion, "fake 2.0.0");
    assert.deepEqual(result.observedModels, ["model-served"]);
    assert.deepEqual(contexts, [{
      spawnInstruction:
        'Start each child with the Agent tool and subagent_type "writer-child".',
      model: "model-w",
      effort: "medium",
    }]);

    const evidence = join(root, "evidence");
    assert.equal(result.promptPath, join(evidence, "prompt.txt"));
    assert.equal(
      await readFile(result.promptPath, "utf8"),
      'Custom prompt. Start each child with the Agent tool and subagent_type "writer-child".',
    );
    assert.match(
      await readFile(join(evidence, "stdout.jsonl"), "utf8"),
      /model-served/,
    );
    assert.equal(
      await readFile(join(evidence, "stderr.txt"), "utf8"),
      "a warning\n",
    );
    assert.equal(
      result.finalResponsePath,
      join(evidence, "final-response.txt"),
    );
    assert.equal(
      await readFile(result.finalResponsePath, "utf8"),
      "Wrote it.\nVerdict: accepted\n",
    );

    // The host ran in the pass directory with the pinned bin directory first
    // on PATH, and the prompt as its last argument.
    const pass = request.passDir;
    assert.ok(
      (await readFile(join(pass, "path.txt"), "utf8")).startsWith(
        join(root, "bin"),
      ),
    );
    const argv: string[] = JSON.parse(
      await readFile(join(pass, "argv.json"), "utf8"),
    );
    assert.equal(argv.at(-1), await readFile(result.promptPath, "utf8"));
    assert.ok(argv.includes("Bash(sigil *)") && argv.includes("Bash(git *)"));
    assert.ok(!argv.includes("Bash(cp *)"), "another stage's shell leaked in");
    const agents = JSON.parse(argv[argv.indexOf("--agents") + 1]);
    assert.deepEqual(Object.keys(agents), ["writer-child"]);
    // Recorded settings leave out the host-prefix arguments and the prompt.
    assert.equal(result.settings[0], "--print");
    assert.ok(!result.settings.includes(argv.at(-1)!));
  });
});

test("extra host arguments reach the host before the prompt", async () => {
  await withTempDir("agent-runner-launch-", async (root) => {
    const request = await setUp(
      root,
      `import { writeFileSync } from "node:fs";
writeFileSync("argv.json", JSON.stringify(process.argv.slice(2)));
emit({ type: "result", result: "Verdict: accepted" });
`,
    );
    const settings = '{"permissions":{"deny":["Read(//repo/**)"]}}';
    const result = await launchAgent({
      ...request,
      hostArgs: ["--settings", settings],
      prompt: () => "Prompt.",
    });
    assert.equal(result.status, "completed", JSON.stringify(result));
    const argv: string[] = JSON.parse(
      await readFile(join(request.passDir, "argv.json"), "utf8"),
    );
    assert.deepEqual(argv.slice(-4), ["--settings", settings, "--", "Prompt."]);
    assert.ok(result.settings.includes(settings));
  });
});

test("a host that exceeds the timeout is stopped and its partial events are kept", async () => {
  await withTempDir("agent-runner-launch-", async (root) => {
    const request = await setUp(
      root,
      `emit({ type: "assistant", message: { model: "model-partial" } });
setInterval(() => {}, 1_000);
`,
    );
    const started = Date.now();
    const result = await launchAgent({
      ...request,
      timeoutMs: 1_500,
      prompt: () => "wait forever",
    });
    assert.equal(result.status, "timeout");
    assert.equal(result.finalResponsePath, null);
    assert.equal(result.handback, null);
    assert.match(await readFile(result.stdoutPath, "utf8"), /model-partial/);
    assert.ok(Date.now() - started < 10_000, "the stop took too long");
    assert.ok(await exists(request.passDir), "the pass directory was removed");
  });
});

test("cancelling a host stops the descendants it started", async () => {
  await withTempDir("agent-runner-launch-", async (root) => {
    const pidPath = join(root, "grandchild.pid");
    const sleeper = await writeScript(
      join(root, "sleeper.mjs"),
      sleeperSource(pidPath),
    );
    const request = await setUp(
      root,
      `${spawnSleeperSource(sleeper)}
emit({ type: "assistant", message: { model: "model-cancelled" } });
setInterval(() => {}, 1_000);
`,
    );
    const controller = new AbortController();
    const pending = launchAgent({
      ...request,
      signal: controller.signal,
      prompt: () => "start a descendant",
    });
    let grandchild = 0;
    await waitFor(
      async () => {
        try {
          grandchild = Number(await readFile(pidPath, "utf8"));
          return grandchild > 0;
        } catch {
          return false;
        }
      },
      15_000,
      "the descendant to start",
    );
    controller.abort();
    const result = await pending;
    assert.equal(result.status, "cancelled");
    assert.match(await readFile(result.stdoutPath, "utf8"), /model-cancelled/);
    // On Windows the host's SIGTERM is a TerminateProcess of the host alone,
    // so only POSIX can promise the descendant went with it.
    if (process.platform !== "win32") {
      await waitFor(
        () => !isAlive(grandchild),
        5_000,
        "the descendant to exit",
      );
    }
  });
});

test("a missing executable is a launch failure", async () => {
  await withTempDir("agent-runner-launch-", async (root) => {
    const request = await setUp(root, "");
    const result = await launchAgent({
      ...request,
      executable: join(root, "does-not-exist"),
      executableArgs: [],
      prompt: () => "unused",
    });
    assert.equal(result.status, "failed");
    assert.equal(result.failureStep, "launch");
    assert.equal(result.hostVersion, null);
  });
});

test("a non-zero exit fails the orchestrator and a silent exit fails the artifact", async () => {
  await withTempDir("agent-runner-launch-", async (root) => {
    const request = await setUp(root, "process.exit(4);");
    const crashed = await launchAgent({ ...request, prompt: () => "crash" });
    assert.equal(crashed.status, "failed");
    assert.equal(crashed.failureStep, "orchestrator");
    assert.equal(crashed.exitCode, 4);
    assert.equal(crashed.error, "Agent exited 4");

    await writeFile(join(root, "host.mjs"), hostSource("// no result"));
    const silent = await launchAgent({
      ...request,
      evidenceDir: join(root, "evidence-2"),
      prompt: () => "say nothing",
    });
    assert.equal(silent.status, "failed");
    assert.equal(silent.failureStep, "artifact");
    assert.equal(silent.handback, null);
  });
});

test("a completed run whose final message has no hand-back parses to null", async () => {
  await withTempDir("agent-runner-launch-", async (root) => {
    const request = await setUp(
      root,
      'emit({ type: "result", result: "no verdict here" });',
    );
    const result = await launchAgent({ ...request, prompt: () => "go" });
    assert.equal(result.status, "completed");
    assert.equal(result.handback, null);
  });
});
