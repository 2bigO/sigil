import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { checkPluginManifests } from "./plugin-manifests.ts";
import { FOUNDATION_SKILLS } from "./validate-skill.ts";

const root = resolve(import.meta.dirname!, "..");
const FILES = [
  "packages/cli/deno.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  ".cursor-plugin/plugin.json",
  ".cursor-plugin/marketplace.json",
  "gemini-extension.json",
  "plugin.json",
  "package.json",
  ".opencode/plugins/sigil.js",
];

async function withCopy(
  run: (copy: string) => Promise<void>,
): Promise<void> {
  const copy = await Deno.makeTempDir({ prefix: "sigil-plugin-manifests-" });
  try {
    for (const file of FILES) {
      await Deno.mkdir(dirname(join(copy, file)), { recursive: true });
      await Deno.copyFile(join(root, file), join(copy, file));
    }
    for (const name of Object.keys(FOUNDATION_SKILLS)) {
      await Deno.mkdir(join(copy, "skills", name), { recursive: true });
    }
    await run(copy);
  } finally {
    await Deno.remove(copy, { recursive: true });
  }
}

async function editJson(
  path: string,
  edit: (value: Record<string, unknown>) => void,
): Promise<void> {
  const value = JSON.parse(await Deno.readTextFile(path));
  edit(value);
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2));
}

Deno.test("the committed plugin manifests agree with the CLI release", async () => {
  equal(await checkPluginManifests(root), []);
});

Deno.test("a manifest with another version fails and is named", async () => {
  await withCopy(async (copy) => {
    await editJson(join(copy, ".codex-plugin/plugin.json"), (value) => {
      value.version = "0.8.0";
    });
    const errors = await checkPluginManifests(copy);
    equal(errors.length, 1);
    assert(errors[0].startsWith(".codex-plugin/plugin.json: version"));
  });
});

Deno.test("an extra skill folder fails and is named", async () => {
  await withCopy(async (copy) => {
    await Deno.mkdir(join(copy, "skills/sigil-extra"));
    const errors = await checkPluginManifests(copy);
    equal(errors, ["skills/sigil-extra: unexpected skill folder"]);
  });
});

Deno.test("a renamed marketplace entry fails and is named", async () => {
  await withCopy(async (copy) => {
    await editJson(join(copy, ".agents/plugins/marketplace.json"), (value) => {
      (value.plugins as { name: string }[])[0].name = "sigil-skills";
    });
    const errors = await checkPluginManifests(copy);
    equal(errors.length, 1);
    assert(
      errors[0].startsWith(".agents/plugins/marketplace.json: plugin entry"),
    );
  });
});

Deno.test("the Claude marketplace entry must not carry a version", async () => {
  await withCopy(async (copy) => {
    await editJson(join(copy, ".claude-plugin/marketplace.json"), (value) => {
      (value.plugins as { version?: string }[])[0].version = "0.9.0";
    });
    const errors = await checkPluginManifests(copy);
    equal(errors.length, 1);
    assert(errors[0].startsWith(".claude-plugin/marketplace.json:"));
  });
});

Deno.test("the root plugin manifest has no schema and package.json stays dependency-free", async () => {
  await withCopy(async (copy) => {
    await editJson(join(copy, "plugin.json"), (value) => {
      value.$schema = "https://agent-plugins.org/schema.json";
    });
    await editJson(join(copy, "package.json"), (value) => {
      value.dependencies = { left: "1.0.0" };
    });
    await Deno.writeTextFile(join(copy, "package-lock.json"), "{}");
    const errors = await checkPluginManifests(copy);
    equal(errors.map((error) => error.split(":")[0]).sort(), [
      "package-lock.json",
      "package.json",
      "plugin.json",
    ]);
  });
});

Deno.test("the OpenCode plugin registers the skills folder once", async () => {
  const module = await import("../.opencode/plugins/sigil.js");
  const hooks = await module.default();
  const config: { skills?: { paths: string[] } } = {};
  await hooks.config(config);
  await hooks.config(config);
  equal(config.skills?.paths, [join(root, "skills")]);
});
