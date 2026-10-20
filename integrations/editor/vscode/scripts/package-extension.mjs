import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { packagePlan, parsePackageArguments } from "./package-plan.mjs";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const options = parsePackageArguments(process.argv.slice(2));
const { output, shipped } = packagePlan(manifest.version, options);
const extension = new URL("..", import.meta.url);
const executable = process.platform === "win32" ? "vsce.cmd" : "vsce";
const bin = new URL("bin/", extension);

try {
  await rm(bin, { recursive: true, force: true });
  if (shipped) {
    await mkdir(bin, { recursive: true });
    await copyFile(options.binary, new URL(shipped, extension));
  }
  const args = ["package", "--no-dependencies", "--out", output];
  if (options.target) args.push("--target", options.target);
  const result = spawnSync(executable, args, {
    cwd: extension,
    stdio: "inherit",
    // Node refuses to start a .cmd file without a shell.
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  // The shipped binary belongs to one package, not to the working tree.
  await rm(bin, { recursive: true, force: true });
}
