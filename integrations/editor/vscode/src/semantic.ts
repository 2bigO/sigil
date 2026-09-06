import { spawn } from "node:child_process";

export interface SemanticCommandResult {
  readonly version: 1;
  readonly command: string;
  readonly [key: string]: unknown;
}

const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;

/** Run one bounded JSON CLI command. The CLI remains the sole semantic authority. */
export function runSemanticCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<SemanticCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = (): void => fail(new Error("Semantic command cancelled."));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > MAX_STDOUT_BYTES) {
        fail(new Error("Semantic command JSON output exceeds 16 MiB."));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > MAX_STDERR_BYTES) {
        fail(new Error("Semantic command diagnostics exceed 1 MiB."));
      }
    });
    child.once("close", (code, closeSignal) => {
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      if (closeSignal) {
        reject(new Error(`Semantic command terminated by ${closeSignal}.`));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout.toString("utf8"));
      } catch {
        reject(
          new Error(
            `Semantic command returned malformed JSON: ${
              stderr.toString("utf8").trim()
            }`,
          ),
        );
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        reject(new Error("Semantic command response must be an object."));
        return;
      }
      const result = parsed as Record<string, unknown>;
      if (result.version !== 1 || typeof result.command !== "string") {
        reject(new Error("Unsupported semantic command response version."));
        return;
      }
      if (code !== 0 && code !== 1) {
        reject(
          new Error(
            stderr.toString("utf8").trim() ||
              `Semantic command exited with ${code ?? "unknown"}.`,
          ),
        );
        return;
      }
      resolve(result as SemanticCommandResult);
    });
  });
}
