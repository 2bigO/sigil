import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const executable = process.platform === "win32" ? "vsce.cmd" : "vsce";
const output = `build/sigil-vscode-${manifest.version}.vsix`;
const result = spawnSync(
  executable,
  ["package", "--no-dependencies", "--out", output],
  { cwd: new URL("..", import.meta.url), stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
