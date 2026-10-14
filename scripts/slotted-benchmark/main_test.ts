import { strictEqual as equal } from "node:assert/strict";
import { join } from "node:path";
import { ensureDefaultOutputRoot } from "./main.ts";
import { exists } from "./files.ts";

Deno.test("ensureDefaultOutputRoot creates the root and a self-ignoring .gitignore", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-default-root-" });
  try {
    const target = join(root, ".benchmarks");
    await ensureDefaultOutputRoot(target);
    equal(await exists(target), true);
    equal(
      await Deno.readTextFile(join(target, ".gitignore")),
      "*\n",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureDefaultOutputRoot leaves an existing .gitignore untouched", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-default-root-" });
  try {
    const target = join(root, ".benchmarks");
    await Deno.mkdir(target, { recursive: true });
    await Deno.writeTextFile(join(target, ".gitignore"), "custom\n");
    await ensureDefaultOutputRoot(target);
    equal(await Deno.readTextFile(join(target, ".gitignore")), "custom\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureDefaultOutputRoot is idempotent when called twice", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-default-root-" });
  try {
    const target = join(root, ".benchmarks");
    await ensureDefaultOutputRoot(target);
    await ensureDefaultOutputRoot(target);
    equal(await Deno.readTextFile(join(target, ".gitignore")), "*\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
