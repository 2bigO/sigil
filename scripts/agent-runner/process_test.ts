import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import {
  captureStream,
  settleWithin,
  signalOwnedProcess,
  spawnProcess,
  taskkillArgs,
} from "./process.ts";
import {
  isAlive,
  sleeperSource,
  spawnSleeperSource,
  waitFor,
  withTempDir,
  writeScript,
} from "./test_support.ts";

const posix = process.platform !== "win32";

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("captureStream keeps a bounded prefix and drains the rest", async () => {
  const capture = captureStream(streamOf(["abc", "def", "ghi"]), 5);
  await capture.done;
  assert.equal(capture.isDone(), true);
  assert.equal(new TextDecoder().decode(capture.read()), "abcde");
});

test("settleWithin reports whether a promise settled in time", async () => {
  assert.equal(await settleWithin(Promise.resolve(), 50), true);
  assert.equal(await settleWithin(Promise.reject(new Error("x")), 50), true);
  assert.equal(await settleWithin(new Promise(() => {}), 20), false);
});

test("a missing executable is rejected with ENOENT", async () => {
  await assert.rejects(
    spawnProcess(join(process.cwd(), "definitely-not-an-executable")),
    (cause: { code?: unknown }) => cause.code === "ENOENT",
  );
});

test("a spawned process adds to the inherited environment and reports its exit", async () => {
  await withTempDir("agent-runner-process-", async (root) => {
    const command = await writeScript(
      join(root, "env.mjs"),
      `process.stdout.write(JSON.stringify({
  added: process.env.AGENT_RUNNER_ADDED,
  path: Boolean(process.env.PATH),
  cwd: process.cwd(),
}));
process.stderr.write("to stderr");
process.exit(3);
`,
    );
    const child = await spawnProcess(command.executable, {
      args: command.args,
      cwd: root,
      env: { AGENT_RUNNER_ADDED: "yes" },
      stdout: "piped",
      stderr: "piped",
    });
    const stdout = captureStream(child.stdout!);
    const stderr = captureStream(child.stderr!);
    const status = await child.status;
    await Promise.all([stdout.done, stderr.done]);
    assert.deepEqual(status, { success: false, code: 3, signal: null });
    const seen = JSON.parse(new TextDecoder().decode(stdout.read()));
    assert.equal(seen.added, "yes");
    assert.equal(seen.path, true, "PATH was not inherited");
    assert.equal(new TextDecoder().decode(stderr.read()), "to stderr");
  });
});

test("a signalled process reports 128 plus the signal number", {
  skip: !posix,
}, async () => {
  await withTempDir("agent-runner-process-", async (root) => {
    const command = await writeScript(
      join(root, "wait.mjs"),
      "setTimeout(() => {}, 60_000);\n",
    );
    const child = await spawnProcess(command.executable, {
      args: command.args,
    });
    child.kill("SIGKILL");
    assert.deepEqual(await child.status, {
      success: false,
      code: 137,
      signal: "SIGKILL",
    });
  });
});

test("taskkill stops a Windows process together with its tree", () => {
  assert.deepEqual(taskkillArgs(4242), ["/PID", "4242", "/T", "/F"]);
});

test("SIGKILL to an owned process stops its descendants", async () => {
  await withTempDir("agent-runner-process-", async (root) => {
    const pidPath = join(root, "grandchild.pid");
    const sleeper = await writeScript(
      join(root, "sleeper.mjs"),
      sleeperSource(pidPath),
    );
    const host = await writeScript(
      join(root, "host.mjs"),
      spawnSleeperSource(sleeper) + "setTimeout(() => {}, 60_000);\n",
    );
    const child = await spawnProcess(host.executable, {
      args: host.args,
      stdout: "piped",
      stderr: "piped",
      detached: true,
    });
    const stdout = captureStream(child.stdout!);
    const stderr = captureStream(child.stderr!);
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
      "the grandchild to start",
    );
    // POSIX signals the process group by a negative pid; Windows runs
    // `taskkill /T` while the host is still alive.
    await signalOwnedProcess(child, "SIGKILL");
    await child.status;
    await waitFor(() => !isAlive(grandchild), 5_000, "the grandchild to exit");
    // With the whole tree gone, nothing holds the output pipes open.
    assert.equal(
      await settleWithin(Promise.all([stdout.done, stderr.done]), 5_000),
      true,
    );
  });
});

test("SIGTERM to a detached host reaches its process group", {
  skip: !posix,
}, async () => {
  await withTempDir("agent-runner-process-", async (root) => {
    const pidPath = join(root, "grandchild.pid");
    const sleeper = await writeScript(
      join(root, "sleeper.mjs"),
      sleeperSource(pidPath),
    );
    const host = await writeScript(
      join(root, "host.mjs"),
      spawnSleeperSource(sleeper) + "setTimeout(() => {}, 60_000);\n",
    );
    const child = await spawnProcess(host.executable, {
      args: host.args,
      detached: true,
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
      "the grandchild to start",
    );
    await signalOwnedProcess(child, "SIGTERM");
    assert.equal((await child.status).signal, "SIGTERM");
    await waitFor(() => !isAlive(grandchild), 5_000, "the grandchild to exit");
  });
});

test("signalling an exited process or one without a pid does not throw", async () => {
  await withTempDir("agent-runner-process-", async (root) => {
    const command = await writeScript(join(root, "exit.mjs"), "");
    const child = await spawnProcess(command.executable, {
      args: command.args,
      detached: true,
    });
    await child.status;
    await signalOwnedProcess(child, "SIGTERM");
    await signalOwnedProcess(child, "SIGKILL");
    await signalOwnedProcess({
      kill() {
        throw new Error("already gone");
      },
    }, "SIGKILL");
  });
});
