import { match as matches, strictEqual as equal } from "node:assert/strict";
import { delimiter, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readBatch, runBatch } from "./batch.ts";
import { exists, treeSha256 } from "../agent-runner/files.ts";
import { executeCommand } from "./main.ts";
import { writeExecutableScript, writeFakeHost } from "./test_support.ts";

const slotted = fileURLToPath(
  new URL("../../examples/slotted", import.meta.url),
);

async function listing(dir: string): Promise<string[]> {
  const names: string[] = [];
  async function walk(path: string, prefix: string) {
    for await (const entry of Deno.readDir(path)) {
      const name = `${prefix}${entry.name}`;
      names.push(name);
      if (entry.isDirectory) await walk(`${path}/${entry.name}`, `${name}/`);
    }
  }
  await walk(dir, "");
  return names.sort();
}

const COMMON = ["--passes", "1", "--timeout-ms", "60000"];

Deno.test("a pass runs one orchestrator on a private copy, is scored from the benchmark's own check, and the report regenerates without launch", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-cli-test-" });
  try {
    const host = await writeFakeHost(`${root}/fake-claude.py`, {
      planted: true,
    });
    const batch = `${root}/batch`;
    const fixtureBefore = {
      files: await listing(slotted),
      sigil: await treeSha256(`${slotted}/.sigil`),
    };
    const defaultRoot = `${root}/default-benchmarks`;
    const launched = await executeCommand([
      "run",
      "--agent",
      "claude:requested-fake-model",
      ...COMMON,
      "--reasoning",
      "medium",
      "--out",
      batch,
    ], { agentExecutables: { claude: host }, defaultOutputRoot: defaultRoot });
    equal(launched.batchDir, resolve(batch));
    // --out never creates or touches the default output root.
    equal(await exists(defaultRoot), false);
    equal(launched.scheduled, 1);
    equal(
      launched.valid,
      1,
      `expected one valid pass; see ${batch}/report.md`,
    );
    // The fixture was never touched: the pass worked on a copy.
    equal(await treeSha256(`${slotted}/.sigil`), fixtureBefore.sigil);
    equal(
      (await listing(slotted)).join(),
      fixtureBefore.files.join(),
    );

    const pass = `${batch}/attempts/000001/pass`;
    // The pass began from a copy with config and nothing stored.
    const start = JSON.parse(
      await Deno.readTextFile(`${pass}/run/start-state.json`),
    );
    equal(start.rootConfig, true);
    equal(start.rootClaims, false);
    equal(start.storeEntries.length, 0);
    equal(
      start.skills.join(),
      "sigil-compute-design,sigil-egglog,sigil-understand",
    );
    const argv = JSON.parse(await Deno.readTextFile(`${pass}/run/argv.json`));
    // The fake host captures this via Python's own `shutil.which`, which
    // uses the OS-native separator and, on Windows, resolves the extension
    // from PATHEXT -- so it comes back as literal ".EXE", not ".exe": the
    // same on-disk file either way on a case-insensitive filesystem.
    const exeSuffixPattern = Deno.build.os === "windows" ? "\\.exe" : "";
    matches(
      argv.sigilc,
      new RegExp(
        `[\\\\/]attempts[\\\\/]000001[\\\\/]pass[\\\\/]bin[\\\\/]sigilc${exeSuffixPattern}$`,
        Deno.build.os === "windows" ? "i" : undefined,
      ),
    );
    // The skill's write-back landed in the copy, not in the fixture.
    equal(await exists(`${pass}/root/.sigil/claims/interpretations`), true);
    equal(await exists(`${slotted}/.sigil/claims`), false);

    // A design-action manifest carries no pre-merge baseline keys.
    const writtenManifest = JSON.parse(
      await Deno.readTextFile(`${batch}/manifest.json`),
    );
    equal("baselineClaimsSha256" in writtenManifest.tools, false);
    equal("baselineSigilcSha256" in writtenManifest.tools, false);

    // The benchmark ran its own check and scored from it.
    const { records } = await readBatch(batch);
    equal(records[0].status, "valid");
    equal(records[0].state, "disjoint");
    equal(records[0].handbackState, "disjoint");
    equal(records[0].unreadUnits, 0);
    equal(records[0].requestedEffort, "medium");
    equal(records[0].childModels.join(), "served-fake-model");
    equal(records[0].childEffortVerification, "unverified");
    equal(
      (await Deno.readTextFile(
        `${batch}/attempts/000001/evidence/check/check.stdout.txt`,
      )).includes('"scope": "workspace"'),
      true,
    );
    const outcome = JSON.parse(
      await Deno.readTextFile(`${batch}/attempts/000001/outcome.json`),
    );
    equal(outcome.linked.validation.valid, true);
    equal(outcome.linked.report.unread.length, 0);
    equal("sources" in outcome, false);
    await Deno.stat(`${pass}/store/claims/workspace.linked.json`);
    const report = await Deno.readTextFile(`${batch}/report.md`);
    matches(report, /## Runs/);
    matches(report, /## Agent and model comparison/);
    matches(report, /requested-fake-model/);
    matches(report, /served-fake-model \(observed\)/);
    equal((report.match(/\| 000001 \| claude \|/g) ?? []).length, 1);
    matches(
      report,
      /\| medium \| 1 \| valid \| disjoint \| disjoint \| booking-pending-range-contradiction \| 0 \| 0 \| 1 × served-fake-model \/ effort unverified \|/,
    );
    matches(report, /booking-pending-range-contradiction: 1\/1/);
    equal(report.includes("## Source readings"), false);
    await Deno.writeTextFile(
      host,
      "#!/usr/bin/env python3\nraise RuntimeError('report launched a host')\n",
    );
    const regenerated = await executeCommand(["report", batch]);
    equal(regenerated.reportPath, `${resolve(batch)}${sep}report.md`);
    equal(await Deno.readTextFile(regenerated.reportPath), report);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a run with no --out lands under the default output root, with a report and a sibling .gitignore", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-default-root-test-" });
  try {
    const host = await writeFakeHost(`${root}/fake-claude.py`, {
      planted: true,
    });
    const defaultRoot = `${root}/default-benchmarks`;
    const result = await executeCommand([
      "run",
      "--agent",
      "claude:fake-model",
      ...COMMON,
    ], { agentExecutables: { claude: host }, defaultOutputRoot: defaultRoot });
    // The batch landed directly under the default root, not --out.
    equal(result.batchDir.startsWith(`${resolve(defaultRoot)}${sep}`), true);
    equal(await exists(`${result.batchDir}/report.md`), true);
    equal(result.reportPath, `${result.batchDir}${sep}report.md`);
    // The default root's own .gitignore, a sibling of the batch directory.
    equal(
      await Deno.readTextFile(`${defaultRoot}/.gitignore`),
      "*\n",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a second pass reuses nothing from the first and the fixture stays unchanged", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-two-pass-" });
  try {
    const host = await writeFakeHost(`${root}/fake-claude.py`);
    const batch = `${root}/batch`;
    const before = await treeSha256(`${slotted}/.sigil`);
    const result = await executeCommand([
      "run",
      "--agent",
      "claude:fake-model",
      "--passes",
      "2",
      "--timeout-ms",
      "60000",
      "--out",
      batch,
    ], { agentExecutables: { claude: host } });
    equal(result.scheduled, 2);
    equal(result.valid, 2);
    equal(await treeSha256(`${slotted}/.sigil`), before);
    const starts = [];
    for (const id of ["000001", "000002"]) {
      starts.push(JSON.parse(
        await Deno.readTextFile(
          `${batch}/attempts/${id}/pass/run/start-state.json`,
        ),
      ));
    }
    // Pass two began with an empty store and a root with no stored readings,
    // although pass one stored seven sources' readings and wrote them back.
    for (const start of starts) {
      equal(start.storeEntries.length, 0);
      equal(start.rootClaims, false);
    }
    equal(
      await exists(
        `${batch}/attempts/000001/pass/root/.sigil/claims/interpretations`,
      ),
      true,
    );
    const first = await Deno.realPath(`${batch}/attempts/000001/pass`);
    const second = await Deno.realPath(`${batch}/attempts/000002/pass`);
    equal(first === second, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("failed host does not block later passes and report", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-continued-test-" });
  try {
    const host = await writeFakeHost(`${root}/fake-claude.py`, {
      planted: true,
    });
    const batch = `${root}/batch`;
    const result = await executeCommand([
      "run",
      "--agent",
      "codex:missing-model",
      "--agent",
      "claude:fake-model",
      ...COMMON,
      "--out",
      batch,
    ], {
      agentExecutables: { codex: `${root}/missing`, claude: host },
    });
    equal(result.scheduled, 2);
    equal(result.failed, 1);
    equal(result.interrupted, 0);
    equal(result.valid, 1);
    const { records } = await readBatch(batch);
    equal(records[0].status, "failed");
    equal(records[1].status, "valid");
    const outcome = JSON.parse(
      await Deno.readTextFile(`${batch}/attempts/000002/outcome.json`),
    );
    equal(outcome.status, "valid", outcome.error ?? "");
    equal(
      outcome.linked.report.findings.some((finding: { law: string }) =>
        finding.law === "contradictory-claims"
      ),
      true,
    );
    const report = await Deno.readTextFile(result.reportPath);
    matches(report, /booking-pending-range-contradiction: 1\/1/);
    matches(
      report,
      /Attempt 000002, `booking-pending-range-contradiction`: linked finding/,
    );
    matches(
      report,
      /\[linked report\]\(attempts\/000002\/pass\/store\/claims\/workspace\.linked\.json\)/,
    );
    matches(report, /\| 000001 \| codex \| missing-model .*\| failed \|/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a pass that leaves a source unread is valid and honest: unread units named, the rest scored", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-incomplete-test-" });
  try {
    const host = await writeFakeHost(`${root}/fake-claude.py`, {
      planted: true,
      skipSource: "rooms.sigil",
    });
    const batch = `${root}/batch`;
    const result = await executeCommand([
      "run",
      "--agent",
      "claude:fake-model",
      ...COMMON,
      "--out",
      batch,
    ], { agentExecutables: { claude: host } });
    equal(result.scheduled, 1);
    // The agent handed back the check's own state, so the pass is valid.
    equal(result.valid, 1);
    const { records } = await readBatch(batch);
    // A gating finding outranks incompleteness; the unread list still names
    // the source, and claims_test covers the `incomplete` state itself.
    equal(records[0].state, "disjoint");
    equal((records[0].unreadUnits ?? 0) > 0, true);
    const outcome = JSON.parse(
      await Deno.readTextFile(`${batch}/attempts/000001/outcome.json`),
    );
    equal(outcome.linked.exitCode, 1);
    equal(
      outcome.linked.report.unread.some((entry: { source: string }) =>
        entry.source === "rooms.sigil"
      ),
      true,
    );
    const report = await Deno.readTextFile(result.reportPath);
    // Booking's contradiction still scores; Rooms' ownership anchor was unread.
    matches(report, /booking-pending-range-contradiction: 1\/1/);
    matches(
      report,
      /booking-rooms-archived-mark-ownership: 0\/0 \(1 unavailable\)/,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("an agent that hands back coherent while the benchmark's check is incomplete makes the pass invalid and unscored", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-disagree-test-" });
  try {
    const host = await writeFakeHost(`${root}/fake-claude.py`, {
      planted: true,
      skipSource: "rooms.sigil",
      handback: "coherent",
    });
    const batch = `${root}/batch`;
    const result = await executeCommand([
      "run",
      "--agent",
      "claude:fake-model",
      ...COMMON,
      "--out",
      batch,
    ], { agentExecutables: { claude: host } });
    equal(result.valid, 0);
    equal(result.failed, 1);
    const { records } = await readBatch(batch);
    equal(records[0].status, "invalid");
    equal(records[0].failureStep, "handback");
    equal(records[0].state, null);
    equal(records[0].handbackState, "coherent");
    equal((records[0].unreadUnits ?? 0) > 0, true);
    const report = await Deno.readTextFile(result.reportPath);
    matches(report, /\| invalid \| — \| coherent \| — \| — \|/);
    // The pass is not scored, so nothing is counted for or against it.
    matches(report, /booking-pending-range-contradiction: 0\/0/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a pass that runs out of time is interrupted with partial evidence, not scored as missed", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-timeout-test-" });
  try {
    const host = await writeFakeHost(`${root}/fake-claude.py`, {
      planted: true,
      stopAfterSources: 1,
      sleepAfterSeconds: 120,
    });
    const batch = `${root}/batch`;
    const started = Date.now();
    const result = await executeCommand([
      "run",
      "--agent",
      "claude:fake-model",
      "--passes",
      "1",
      "--timeout-ms",
      "6000",
      "--out",
      batch,
    ], { agentExecutables: { claude: host } });
    equal(result.interrupted, 1);
    equal(result.valid, 0);
    equal(Date.now() - started < 30_000, true);
    const { records } = await readBatch(batch);
    equal(records[0].status, "interrupted");
    equal(records[0].state, null);
    // Partial evidence: the pass directory, its host events and a check of
    // whatever was stored before the timeout.
    equal(
      await exists(`${batch}/attempts/000001/pass/run/start-state.json`),
      true,
    );
    await Deno.stat(`${batch}/attempts/000001/evidence/stdout.jsonl`);
    const outcome = JSON.parse(
      await Deno.readTextFile(`${batch}/attempts/000001/outcome.json`),
    );
    equal(outcome.linked.validation.state, "incomplete");
    equal(records[0].unreadUnits === outcome.linked.report.unread.length, true);
    equal((records[0].unreadUnits ?? 0) > 0, true);
    const report = await Deno.readTextFile(result.reportPath);
    matches(report, /\| interrupted \| — \| — \| — \| — \| \d+ \|/);
    matches(report, /booking-pending-range-contradiction: 0\/0/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

for (
  const [childEffort, expectedStatus] of [
    ["low", "invalid"],
    ["medium", "valid"],
  ] as const
) {
  Deno.test(`a Codex child at effort ${childEffort} under a medium request is ${expectedStatus}, with the effort read from the rollouts`, async () => {
    const root = await Deno.makeTempDir({ prefix: "slotted-codex-test-" });
    try {
      const host = await writeFakeHost(`${root}/fake-codex.py`, {
        host: "codex",
        planted: true,
        childEffort,
      });
      await Deno.writeTextFile(
        `${root}/auth.json`,
        '{"token":"secret-credential"}',
      );
      const batch = `${root}/batch`;
      await executeCommand([
        "run",
        "--agent",
        "codex:gpt-fake",
        ...COMMON,
        "--reasoning",
        "medium",
        "--codex-auth",
        `${root}/auth.json`,
        "--out",
        batch,
      ], { agentExecutables: { codex: host } });
      const { records } = await readBatch(batch);
      equal(records[0].status, expectedStatus, records[0].error ?? "");
      equal(records[0].childEfforts.join(), childEffort);
      equal(records[0].childEffortVerification, "observed");
      equal(records[0].observedModels.join(), "served-fake-model");
      if (expectedStatus === "invalid") {
        equal(records[0].failureStep, "effort");
        equal(records[0].state, null);
      } else {
        equal(records[0].state, "disjoint");
      }
      // The scratch home keeps rollouts but never the credentials.
      const home = `${batch}/attempts/000001/evidence/codex-home`;
      equal(await exists(`${home}/auth.json`), false);
      equal(await exists(`${home}/sessions`), true);
      const argv = JSON.parse(
        await Deno.readTextFile(`${batch}/attempts/000001/pass/run/argv.json`),
      );
      equal(argv.argv.includes("workspace-write"), true);
      equal(
        argv.argv.includes('agents.default_subagent_reasoning_effort="medium"'),
        true,
      );
      equal(argv.codexHome, resolve(home));
      const report = await Deno.readTextFile(`${batch}/report.md`);
      matches(
        report,
        new RegExp(`1 × served-fake-model / ${childEffort} \\(observed\\)`),
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
}

Deno.test("unknown agent or missing model fails before the tree read and child launch", async () => {
  for (const value of ["unknown:model", "claude:"]) {
    let error = "";
    try {
      await executeCommand([
        "run",
        "--agent",
        value,
        "--passes",
        "1",
        "--out",
        "/missing/should-not-be-created",
      ]);
    } catch (cause) {
      error = String(cause);
    }
    matches(error, /Unknown agent|Missing model/);
  }
});

Deno.test("report rebuilds a partial batch with all pending rows and no launch", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-partial-report-" });
  const batch = `${root}/batch`;
  const controller = new AbortController();
  controller.abort();
  try {
    await runBatch({
      selections: [{ agent: "claude", model: "unavailable" }],
      passes: 1,
      outputDir: batch,
      timeoutMs: 1000,
      signal: controller.signal,
      agentExecutables: { claude: "/missing/agent" },
    });
    const result = await executeCommand(["report", batch]);
    equal(result.unfinished, 1);
    const markdown = await Deno.readTextFile(result.reportPath);
    equal((markdown.match(/\| pending \|/g) ?? []).length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("an aborted run records the active attempt as interrupted", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-abort-test-" });
  const marker = `${root}/started`;
  const host = await writeExecutableScript(
    `${root}/hanging-claude.py`,
    `#!/usr/bin/env python3
import pathlib, time
pathlib.Path(${JSON.stringify(marker)}).write_text('started', encoding='utf8')
while True: time.sleep(1)
`,
    [{ command: "python3" }, { command: "python" }],
  );
  const controller = new AbortController();
  try {
    const pending = executeCommand([
      "run",
      "--agent",
      "claude:fake-model",
      "--passes",
      "1",
      "--out",
      `${root}/batch`,
      "--timeout-ms",
      "30000",
    ], { agentExecutables: { claude: host }, signal: controller.signal });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        await Deno.stat(marker);
        break;
      } catch (cause) {
        if (!(cause instanceof Deno.errors.NotFound)) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    await Deno.stat(marker);
    controller.abort();
    const result = await pending;
    equal(result.interrupted, 1);
    equal(result.unfinished, 0);
    const { records } = await readBatch(`${root}/batch`);
    equal(records[0].status, "interrupted");
  } finally {
    controller.abort();
    await removeRecursiveWithRetry(root);
  }
});

Deno.test("CLI SIGINT and SIGTERM stop the detached host and write a report", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-cli-signal-test-" });
  try {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const batch = `${root}/${signal}`;
      const marker = `${root}/${signal}-started`;
      const bin = `${root}/${signal}-bin`;
      await Deno.mkdir(bin);
      await writeExecutableScript(
        `${bin}/claude`,
        `#!/usr/bin/env python3
import pathlib, sys, time
if '--version' in sys.argv:
    print('fake-claude 1.0')
    sys.exit(0)
pathlib.Path(${JSON.stringify(marker)}).write_text('started', encoding='utf8')
# Bounded, not infinite: a forced kill of the CLI process above it (the only
# outcome Windows allows for an externally delivered signal) skips that
# process's own descendant cleanup, so this exits on its own rather than
# outliving the test as an orphan holding the directory's files open.
for _ in range(60): time.sleep(1)
`,
        [{ command: "python3" }, { command: "python" }],
      );
      const child = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-run",
          "--allow-env",
          "scripts/slotted-benchmark/main.ts",
          "run",
          "--agent",
          "claude:fake-model",
          "--passes",
          "1",
          "--out",
          batch,
          "--timeout-ms",
          "30000",
        ],
        env: { PATH: [bin, Deno.env.get("PATH") ?? ""].join(delimiter) },
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const output = child.output();
      try {
        const deadline = Date.now() + 15_000;
        let started = false;
        while (Date.now() < deadline) {
          try {
            await Deno.stat(marker);
            started = true;
            break;
          } catch (cause) {
            if (!(cause instanceof Deno.errors.NotFound)) throw cause;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        equal(started, true, `host did not start for ${signal}`);
        child.kill(signal);
        const result = await output;
        if (Deno.build.os === "windows" && result.code !== 0) {
          // Windows has no real SIGTERM/SIGINT delivery: both Node's and
          // Deno's docs describe `kill()` there as a forced termination the
          // target cannot catch or clean up after, which is exactly why
          // process.ts's own signalOwnedProcess never waits for a graceful
          // exit on Windows either. A listener in main.ts can still win that
          // race often enough to produce a clean "interrupted" report (seen
          // repeatedly in CI), but a forced kill with no report is an
          // equally acceptable outcome there -- only still-running, or any
          // other platform, is a real failure.
          continue;
        }
        equal(
          result.code,
          0,
          `stderr: ${new TextDecoder().decode(result.stderr)}\nstdout: ${
            new TextDecoder().decode(result.stdout)
          }`,
        );
        const { records } = await readBatch(batch);
        equal(records[0].status, "interrupted");
        matches(await Deno.readTextFile(`${batch}/report.md`), /interrupted/);
      } finally {
        try {
          child.kill("SIGKILL");
        } catch { /* The child already exited. */ }
        try {
          await output;
        } catch { /* The child failed before producing output. */ }
      }
    }
  } finally {
    await removeRecursiveWithRetry(root);
  }
});

/**
 * On Windows, a just-killed descendant (the python interpreter under the
 * compiled claude.exe stub) can keep its executable's file handle open for
 * a while after termination -- GitHub's Windows runners routinely have
 * Defender's real-time scan hold a freshly-exited process's own .exe open,
 * observed to sometimes outlast even a generous retry budget -- so an
 * immediate recursive remove can hit "used by another process". Retry past
 * that race, but this is cleanup, not the behavior under test (every
 * assertion above it already passed): on Windows, give up quietly rather
 * than failing the test over a lock the OS will clear on its own:
 * the runner recycles its whole temp directory after the job regardless.
 */
async function removeRecursiveWithRetry(path: string): Promise<void> {
  const maxAttempts = 40;
  for (let attempt = 1;; attempt++) {
    try {
      await Deno.remove(path, { recursive: true });
      return;
    } catch (cause) {
      if (attempt >= maxAttempts) {
        if (Deno.build.os !== "windows") throw cause;
        console.error(`leaving ${path} for the OS to clean up: ${cause}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
