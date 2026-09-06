import { assert, assertEquals } from "@std/assert";
import {
  semanticToolsFrom,
  validateSemanticTools,
} from "../src/semantic/provider-config.ts";

Deno.test("semantic provider config validates strict provider shapes", () => {
  const valid = validateSemanticTools({
    version: 1,
    defaultProvider: "local",
    proposalTimeoutMs: 1000,
    providers: {
      local: { kind: "command", command: "provider", args: ["--json"] },
      codex: { kind: "codex", model: "gpt" },
    },
  });
  assert(valid.config);
  assertEquals(valid.issues, []);
  assertEquals(semanticToolsFrom(valid.config).defaultProvider, "local");
  assert(
    validateSemanticTools({
      version: 1,
      defaultProvider: "missing",
      providers: {},
    }).issues.length > 0,
  );
  assert(
    validateSemanticTools({
      version: 1,
      providers: { bad: { kind: "command" } },
    }).issues.length > 0,
  );
});
