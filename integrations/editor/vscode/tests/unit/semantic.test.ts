import assert from "node:assert/strict";
import test from "node:test";
import { runSemanticCommand } from "../../src/semantic.ts";

test("semantic command accepts bounded versioned JSON result", async () => {
  const script =
    "process.stdout.write(JSON.stringify({version:1,command:'semantic-status',status:'yellow'}))";
  const result = await runSemanticCommand(
    process.execPath,
    ["-e", script],
    process.cwd(),
  );
  assert.equal(result.command, "semantic-status");
  assert.equal(result.status, "yellow");
});

test("semantic command retains completed nonzero semantic outcomes", async () => {
  const script =
    "process.stdout.write(JSON.stringify({version:1,command:'semantic-project',status:'stale'}));process.exitCode=1";
  const result = await runSemanticCommand(
    process.execPath,
    ["-e", script],
    process.cwd(),
  );
  assert.equal(result.status, "stale");
});

test("fake CLI completes the public semantic handoff sequence", async () => {
  const responses: Record<
    string,
    { version: 1; command: string; status: string }
  > = {
    "semantic-intent": {
      version: 1,
      command: "semantic-intent",
      status: "green",
    },
    "semantic-accept": {
      version: 1,
      command: "semantic-accept",
      status: "green",
    },
    "semantic-project": {
      version: 1,
      command: "semantic-project",
      status: "current",
    },
    "semantic-receipts": {
      version: 1,
      command: "semantic-receipts",
      status: "unverified",
    },
    "semantic-verify": {
      version: 1,
      command: "semantic-verify",
      status: "red",
    },
  };
  const script = `const response = ${
    JSON.stringify(responses)
  }[process.argv[1]];
if (!response) process.exit(2);
process.stdout.write(JSON.stringify(response));
if (response.command === "semantic-verify") process.exitCode = 1;`;
  for (const command of Object.keys(responses)) {
    const result = await runSemanticCommand(
      process.execPath,
      ["-e", script, command],
      process.cwd(),
    );
    assert.equal(result.command, command);
  }
});

test("semantic command rejects malformed or unsupported responses", async () => {
  await assert.rejects(
    runSemanticCommand(
      process.execPath,
      ["-e", "process.stdout.write('oops')"],
      process.cwd(),
    ),
    /malformed JSON/,
  );
  await assert.rejects(
    runSemanticCommand(process.execPath, [
      "-e",
      "process.stdout.write(JSON.stringify({version:2,command:'x'}))",
    ], process.cwd()),
    /Unsupported semantic command response/,
  );
});
