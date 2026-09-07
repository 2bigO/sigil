import { assert, assertEquals } from "@std/assert";
import { runCli } from "../src/main.ts";

// @sigil tests packages/cli/_module.sigil::SigilCli::RemovedSemanticCommands interface
Deno.test("removed semantic routes reject usage and are absent from CLI help", async () => {
  for (
    const subcommand of [
      "intent",
      "status",
      "answer",
      "accept",
      "project",
      "slice",
      "receipts",
      "verify",
      "artifacts",
      "migrate",
    ]
  ) {
    const result = await runCli(["semantic", subcommand]);
    assertEquals(result.exitCode, 2, subcommand);
    assertEquals(result.stdout, "");
    assert(result.stderr.includes('Unknown command "semantic"'));
  }
  const help = await runCli(["--help"]);
  assert(!/^\s+semantic\s/m.test(help.stdout));
  assert(/^\s+export\s/m.test(help.stdout));
});
