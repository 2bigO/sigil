import assert from "node:assert/strict";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import {
  copySkill,
  copyTree,
  exists,
  isNotFound,
  sha256,
  treeSha256,
  writeJson,
} from "./files.ts";
import { withTempDir } from "./test_support.ts";

async function writeTree(
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, ...name.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
}

const WORKSPACE = {
  "design.sigil": "Booking\n",
  ".sigil/config.json": "{}\n",
  ".sigil/claims/booking.egg": "(reading a)\n",
  ".sigil/claims/nested/more.egg": "(reading b)\n",
  "docs/notes.md": "notes\n",
};

test("copyTree leaves out a skipped path and everything beneath it", async () => {
  await withTempDir("agent-runner-files-", async (root) => {
    await writeTree(join(root, "source"), WORKSPACE);
    await copyTree(
      join(root, "source"),
      join(root, "copy"),
      new Set([".sigil/claims"]),
    );
    assert.equal(await exists(join(root, "copy/.sigil/claims")), false);
    assert.equal(
      await readFile(join(root, "copy/.sigil/config.json"), "utf8"),
      "{}\n",
    );
    assert.equal(
      await readFile(join(root, "copy/docs/notes.md"), "utf8"),
      "notes\n",
    );
    assert.equal(
      await readFile(join(root, "copy/design.sigil"), "utf8"),
      "Booking\n",
    );
  });
});

test("treeSha256 is identical for identical trees and changes with names or content", async () => {
  await withTempDir("agent-runner-files-", async (root) => {
    await writeTree(join(root, "a"), WORKSPACE);
    await copyTree(join(root, "a"), join(root, "b"));
    const original = await treeSha256(join(root, "a"));
    assert.match(original, /^[0-9a-f]{64}$/);
    assert.equal(await treeSha256(join(root, "b")), original);

    await writeFile(join(root, "b/docs/notes.md"), "changed\n");
    assert.notEqual(await treeSha256(join(root, "b")), original);

    await writeTree(join(root, "c"), {
      ...WORKSPACE,
      "docs/renamed.md": "notes\n",
    });
    assert.notEqual(await treeSha256(join(root, "c")), original);
  });
});

test("copyTree refuses an entry that is not a file or directory", {
  skip: process.platform === "win32",
}, async () => {
  await withTempDir("agent-runner-files-", async (root) => {
    await writeTree(join(root, "source"), { "real.txt": "x" });
    await symlink(join(root, "source/real.txt"), join(root, "source/link"));
    await assert.rejects(
      copyTree(join(root, "source"), join(root, "copy")),
      /Unsupported entry in a copied tree/,
    );
  });
});

test("copySkill copies SKILL.md, an optional VERSION and references", async () => {
  await withTempDir("agent-runner-files-", async (root) => {
    await writeTree(join(root, "with-version"), {
      "SKILL.md": "# skill\n",
      "VERSION": "1.0\n",
      "references/a.md": "a\n",
      "scripts/ignored.sh": "echo no\n",
    });
    await copySkill(join(root, "with-version"), join(root, "out-1"));
    assert.deepEqual((await readdir(join(root, "out-1"))).sort(), [
      "SKILL.md",
      "VERSION",
      "references",
    ]);

    await writeTree(join(root, "no-version"), {
      "SKILL.md": "# skill\n",
      "references/a.md": "a\n",
    });
    await copySkill(join(root, "no-version"), join(root, "out-2"));
    assert.equal(await exists(join(root, "out-2/VERSION")), false);
    assert.equal(
      await readFile(join(root, "out-2/references/a.md"), "utf8"),
      "a\n",
    );

    await writeTree(join(root, "no-skill"), { "references/a.md": "a\n" });
    await assert.rejects(
      copySkill(join(root, "no-skill"), join(root, "out-3")),
      (cause) => isNotFound(cause),
    );
  });
});

test("writeJson creates its directory and leaves no temporary file", async () => {
  await withTempDir("agent-runner-files-", async (root) => {
    const path = join(root, "deep/dir/value.json");
    await writeJson(path, { a: 1 });
    assert.equal(await readFile(path, "utf8"), '{\n  "a": 1\n}\n');
    assert.deepEqual(await readdir(join(root, "deep/dir")), ["value.json"]);
  });
});

test("exists and isNotFound tell a missing path from other failures", async () => {
  await withTempDir("agent-runner-files-", async (root) => {
    assert.equal(await exists(root), true);
    assert.equal(await exists(join(root, "missing")), false);
    assert.equal(isNotFound({ code: "ENOENT" }), true);
    assert.equal(isNotFound({ code: "EACCES" }), false);
    assert.equal(isNotFound(null), false);
  });
});

test("sha256 matches a known digest", async () => {
  assert.equal(
    await sha256(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
