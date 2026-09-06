import { assertEquals, assertThrows } from "@std/assert";
import {
  migrateToolsConfiguration,
  seededToolConfiguration,
} from "../src/config-authoring.ts";

Deno.test("semantic migration converts one legacy evaluator and selects its default", () => {
  const result = migrateToolsConfiguration({
    ...seededToolConfiguration(),
    compile: {
      defaultProfile: "standard",
      evaluators: {
        codex: {
          provider: "codex",
          model: "gpt-test",
          implementationId: "old",
          implementationVersion: "1",
        },
      },
      profiles: { standard: { main: ["codex"] } },
    },
  });
  const semantic = result.proposed.semantic as Record<string, unknown>;
  assertEquals(semantic.defaultProvider, "codex");
  assertEquals((semantic.providers as Record<string, unknown>).codex, {
    kind: "codex",
    model: "gpt-test",
  });
  assertEquals(
    (result.proposed.compile as Record<string, unknown>).evaluators,
    undefined,
  );
});

Deno.test("semantic migration leaves ambiguous evaluator defaults unset", () => {
  const result = migrateToolsConfiguration({
    semantic: { version: 1, providers: {} },
    compile: {
      defaultProfile: "standard",
      evaluators: {
        codex: { provider: "codex" },
        claude: { provider: "claude" },
      },
      profiles: { standard: { main: ["codex", "claude"] } },
    },
  });
  assertEquals(
    (result.proposed.semantic as Record<string, unknown>).defaultProvider,
    undefined,
  );
});

Deno.test("legacy adapter conversion rejects semantic provider conflicts", () => {
  assertThrows(() =>
    migrateToolsConfiguration({
      semantic: {
        version: 1,
        providers: { "legacy-adapter": { kind: "command", command: "other" } },
      },
      compile: { adapter: "legacy" },
    })
  );
});
