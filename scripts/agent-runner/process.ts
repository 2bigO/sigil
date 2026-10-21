import { spawn } from "node:child_process";
import { constants } from "node:os";
import process from "node:process";
import type { Readable } from "node:stream";

export interface CapturedStream {
  readonly done: Promise<void>;
  read(): Uint8Array;
  isDone(): boolean;
  cancel(): void;
}

/** Collect a bounded prefix while continuing to drain the entire child stream. */
export function captureStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes = 16 * 1024 * 1024,
): CapturedStream {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let finished = false;
  const done = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size < maxBytes) {
          const kept = value.subarray(0, maxBytes - size);
          chunks.push(kept.slice());
          size += kept.length;
        }
      }
    } finally {
      finished = true;
      reader.releaseLock();
    }
  })();
  return {
    done,
    read() {
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    },
    isDone: () => finished,
    cancel() {
      try {
        void reader.cancel().catch(() => {});
      } catch { /* The stream may finish between the check and cancel. */ }
    },
  };
}

export async function settleWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** How a process ended. A signalled process reports `128 + signal`. */
export interface ProcessStatus {
  readonly success: boolean;
  readonly code: number;
  readonly signal: string | null;
}

export interface SpawnOptions {
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** Added to this process's environment, which the child also inherits. */
  readonly env?: Readonly<Record<string, string>>;
  readonly stdout?: "piped" | "null";
  readonly stderr?: "piped" | "null";
  /**
   * On POSIX this gives the child a process group of its own, so the group
   * can be signalled as a whole. Ignored on Windows, where a detached child
   * gets a console of its own and `taskkill /T` stops the tree anyway.
   */
  readonly detached?: boolean;
}

/** A spawned child. Its piped output is exposed as web streams. */
export interface OwnedProcess {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  /** Settles when the process exits, which may be before its output closes. */
  readonly status: Promise<ProcessStatus>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

/**
 * Start a process with stdin closed. Resolves once the process is running and
 * rejects when it cannot start, for example because the executable is missing.
 */
export function spawnProcess(
  command: string,
  options: SpawnOptions = {},
): Promise<OwnedProcess> {
  const child = spawn(command, [...(options.args ?? [])], {
    cwd: options.cwd,
    // `spawn` replaces the environment rather than adding to it.
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: [
      "ignore",
      options.stdout === "piped" ? "pipe" : "ignore",
      options.stderr === "piped" ? "pipe" : "ignore",
    ],
    detached: options.detached === true && process.platform !== "win32",
    windowsHide: true,
  });
  const status = new Promise<ProcessStatus>((resolve) => {
    child.once("exit", (code, signal) => {
      const signo = signal ? constants.signals[signal] : undefined;
      const exitCode = code ?? (signo === undefined ? 1 : 128 + signo);
      resolve({ success: exitCode === 0, code: exitCode, signal });
    });
  });
  return new Promise<OwnedProcess>((resolve, reject) => {
    const onError = (cause: Error) => reject(cause);
    child.once("error", onError);
    child.once("spawn", () => {
      child.off("error", onError);
      // A later error (a failed kill, a broken pipe) must not crash the run.
      child.on("error", () => {});
      resolve({
        pid: child.pid!,
        stdout: child.stdout ? toWebStream(child.stdout) : null,
        stderr: child.stderr ? toWebStream(child.stderr) : null,
        status,
        kill(signal) {
          child.kill(signal);
        },
      });
    });
  });
}

/** Wrap a node stream as a web stream; cancelling it destroys the source. */
function toWebStream(readable: Readable): ReadableStream<Uint8Array> {
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      readable.on("data", (chunk: Uint8Array) => {
        if (closed) return;
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 1) <= 0) readable.pause();
      });
      readable.once("end", close);
      // A destroyed stream emits `close` without `end`.
      readable.once("close", close);
      readable.once("error", (cause) => {
        if (closed) return;
        closed = true;
        controller.error(cause);
      });
    },
    pull() {
      readable.resume();
    },
    cancel() {
      closed = true;
      readable.destroy();
    },
  }, { highWaterMark: 16 });
}

/** What signalling needs from a child; Deno's and `spawnProcess`'s both fit. */
export interface SignalTarget {
  readonly pid?: number;
  kill(signal: "SIGTERM" | "SIGKILL"): unknown;
}

/** The `taskkill` arguments that force-stop a Windows process and its tree. */
export function taskkillArgs(pid: number): string[] {
  return ["/PID", String(pid), "/T", "/F"];
}

export async function signalOwnedProcess(
  child: SignalTarget,
  signal: "SIGTERM" | "SIGKILL",
): Promise<void> {
  if (process.platform === "win32") {
    if (signal === "SIGTERM") {
      try {
        child.kill(signal);
      } catch { /* The child may already have exited. */ }
      return;
    }
    if (child.pid === undefined) return;
    try {
      const taskkill = await spawnProcess("taskkill", {
        args: taskkillArgs(child.pid),
      });
      if (!await settleWithin(taskkill.status, 1_000)) {
        try {
          taskkill.kill("SIGKILL");
        } catch { /* taskkill may already have exited. */ }
      }
    } catch { /* taskkill may be unavailable or the tree already exited. */ }
    return;
  }
  try {
    if (child.pid === undefined) throw new Error("the child has no pid");
    // Detached children own a process group, so descendants are stopped too.
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch { /* The process group may already have exited. */ }
  }
}
