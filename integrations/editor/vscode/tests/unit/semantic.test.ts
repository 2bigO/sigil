import assert from "node:assert/strict";
import test from "node:test";
import { runSemanticCommand } from "../../src/semantic.ts";

test("semantic command accepts bounded versioned JSON result", async () => {
  const script = "process.stdout.write(JSON.stringify({version:1,command:'semantic-status',status:'yellow'}))";
  const result = await runSemanticCommand(process.execPath, ["-e", script], process.cwd());
  assert.equal(result.command, "semantic-status");
  assert.equal(result.status, "yellow");
});

test("semantic command retains completed nonzero semantic outcomes", async () => {
  const script = "process.stdout.write(JSON.stringify({version:1,command:'semantic-project',status:'stale'}));process.exitCode=1";
  const result = await runSemanticCommand(process.execPath, ["-e", script], process.cwd());
  assert.equal(result.status, "stale");
});

test("semantic command rejects malformed or unsupported responses", async () => {
  await assert.rejects(
    runSemanticCommand(process.execPath, ["-e", "process.stdout.write('oops')"], process.cwd()),
    /malformed JSON/,
  );
  await assert.rejects(
    runSemanticCommand(process.execPath, ["-e", "process.stdout.write(JSON.stringify({version:2,command:'x'}))"], process.cwd()),
    /Unsupported semantic command response/,
  );
});
