/**
 * Test helpers for the shared runner's tests. This file is not a test.
 *
 * A fake host is a plain JavaScript module run by the runtime running the
 * tests, so the same tests work under `deno test` and `bun test`, on POSIX
 * and on Windows, without a shell or a compiled stub.
 */
import { writeFile } from "node:fs/promises";
import process from "node:process";

/** Run `body` in a fresh temporary directory, removed afterwards. */
export { withTempDir } from "./files.ts";

/** The executable and leading arguments that run a JavaScript file. */
export interface ScriptCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

/** Run `script` with the runtime running this test. */
function scriptCommand(script: string): ScriptCommand {
  return process.versions.deno
    ? { executable: process.execPath, args: ["run", "--allow-all", script] }
    : { executable: process.execPath, args: [script] };
}

/** Write `source` as a module and return the command that runs it. */
export async function writeScript(
  path: string,
  source: string,
): Promise<ScriptCommand> {
  await writeFile(path, source);
  return scriptCommand(path);
}

/**
 * Module source for a process that writes its pid to `pidPath`, then sleeps.
 * Spawned by another fake process, it stands in for a host's descendant.
 */
export function sleeperSource(pidPath: string): string {
  return `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
setTimeout(() => {}, 60_000);
`;
}

/**
 * Module source that starts `sleeper` as a child sharing its output, so the
 * descendant also holds the captured pipes open.
 */
export function spawnSleeperSource(sleeper: ScriptCommand): string {
  return `import { spawn } from "node:child_process";
spawn(${JSON.stringify(sleeper.executable)}, ${
    JSON.stringify(sleeper.args)
  }, { stdio: "inherit" });
`;
}

/** True while a process with this pid exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM: the pid exists but belongs to someone else.
    return (cause as { code?: unknown }).code === "EPERM";
  }
}

/** Wait until `check` holds, or fail after `timeoutMs`. */
export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
