import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolCall } from "./hosts.ts";
import {
  describeWrite,
  scanWrites,
  type WriteScanOptions,
} from "./write-scan.ts";

const HOME = "/home/u";
const STAGING = "/tmp/design-benchmark-1/writer";
const OPTIONS: WriteScanOptions = {
  stagingDir: STAGING,
  allowedDirs: ["design", "run", "store"].map((dir) => `${STAGING}/${dir}`),
  home: HOME,
};

function call(tool: string, input: unknown, cwd: string | null = STAGING) {
  return {
    actor: "orchestrator",
    childSession: null,
    tool,
    input,
    cwd,
  } satisfies ToolCall;
}

function written(calls: ToolCall[], host: "claude" | "codex" = "claude") {
  return scanWrites(host, calls, OPTIONS).map((write) => write.path);
}

test("writes inside design, run and store are allowed", () => {
  assert.deepEqual(
    written([
      call("Write", { file_path: "design/booking.sigil", content: "x" }),
      call("Write", { file_path: `${STAGING}/run/review/request.md` }),
      call("Bash", {
        command:
          "mkdir -p run/prep && cp design/a.sigil run/capture/ && sigilc prepare --source a.sigil --out run/prep --root design --store store > run/out.json 2>/dev/null",
      }),
      call("Bash", { command: "sigil fmt design/a.sigil --root design" }),
      call("Bash", { command: "cat design/a.sigil 2>&1 | tee run/log.txt" }),
    ]),
    [],
  );
});

test("a write tool, a redirect and a copy outside the allowed directories are found", () => {
  assert.deepEqual(
    written([
      call("Write", { file_path: "requirement.md", content: "edited" }),
      call("Bash", { command: "echo x > /tmp/elsewhere.txt" }),
      call("Bash", { command: "cp design/a.sigil /tmp/other-pass/" }),
      call("Bash", { command: "mv run/a skills/sigil-write/SKILL.md" }),
      call("Bash", { command: "touch bin/sigilc" }),
      call("Bash", { command: "sigilc check --root design --store /tmp/x" }),
    ]),
    [
      `${STAGING}/requirement.md`,
      "/tmp/elsewhere.txt",
      "/tmp/other-pass",
      `${STAGING}/skills/sigil-write/SKILL.md`,
      `${STAGING}/bin/sigilc`,
      "/tmp/x",
    ],
  );
});

test("reads are not writes, and input redirects are not either", () => {
  assert.deepEqual(
    written([
      call("Read", { file_path: "/tmp/elsewhere.txt" }),
      call("Bash", { command: "cat < /tmp/in.txt > run/out.txt" }),
      call("Bash", { command: "cp /tmp/source.txt run/copy.txt" }),
      call("Bash", { command: "sigil fmt --check requirement.md" }),
    ]),
    [],
  );
});

test("a cd carries to the next Claude call, and nested shells are followed", () => {
  assert.deepEqual(
    written([
      call("Bash", { command: "cd run" }),
      call("Bash", { command: "echo x > notes.txt" }),
      call("Bash", { command: "cd .. && sh -c 'echo y > top.txt'" }),
    ]),
    [`${STAGING}/top.txt`],
  );
});

test("apply_patch, sed -i and Codex code mode commands are scanned", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: design/a.sigil",
    "*** Update File: requirement.md",
    "*** End Patch",
  ].join("\n");
  assert.deepEqual(
    written([
      call("apply_patch", patch),
      call("Bash", { command: "sed -i '' 's/a/b/' design/a.sigil" }),
      call("Bash", { command: "sed -i 's/a/b/' requirement.md" }),
      call(
        "exec",
        'await tools.exec_command({cmd: "echo z > /var/tmp/z.txt", workdir: "run"})',
      ),
    ], "codex"),
    [
      `${STAGING}/requirement.md`,
      `${STAGING}/requirement.md`,
      "/var/tmp/z.txt",
    ],
  );
});

test("a child's write outside the staging directory is found and described", () => {
  const writes = scanWrites("claude", [{
    actor: "reviewer",
    childSession: "toolu_1",
    tool: "Write",
    input: { file_path: "/private/tmp/review.md" },
    cwd: STAGING,
  }], OPTIONS);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/tmp/review.md");
  assert.equal(describeWrite(writes[0]), "reviewer Write wrote /tmp/review.md");
});
