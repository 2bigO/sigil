import { spawn } from "node:child_process";
import readline from "node:readline";

export interface CompilerDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning" | "optimization" | "information";
  readonly message: string;
  readonly filePath?: string;
  readonly range?: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
}

export interface CompilationReport {
  readonly reportVersion: 1;
  readonly status: "red" | "yellow" | "green";
  readonly componentNames: readonly string[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export interface CompilationEvent {
  readonly protocolVersion: 1;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface CompilationProcess {
  readonly result: Promise<CompilationReport>;
  cancel(): void;
}

// @sigil implements integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::CompilationSurface interface,logic,constraints,cases
export function runCompilationProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  onEvent: (event: CompilationEvent) => void,
  onLog: (line: string) => void,
): CompilationProcess {
  const child = spawn(executable, [...args, "--format", "jsonl"], {
    cwd,
    shell: false,
    windowsHide: true,
  });
  let expectedSequence = 1;
  let completed: CompilationReport | undefined;

  const result = new Promise<CompilationReport>((resolve, reject) => {
    child.once("error", reject);
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const event = parseCompilationEvent(line);
        if (event.sequence !== expectedSequence++) {
          throw new Error("Compilation event sequence is invalid.");
        }
        onEvent(event);
        if (event.type === "completed") {
          const report = event.payload.report;
          if (!isCompilationReport(report)) {
            throw new Error("Completed event has no valid CompilationReport.");
          }
          completed = report;
        }
      } catch (error) {
        child.kill();
        reject(error);
      }
    });
    readline.createInterface({ input: child.stderr }).on("line", onLog);
    child.once("close", (code, signal) => {
      if (completed) {
        resolve(completed);
      } else {
        reject(
          new Error(
            signal
              ? `Sigil compilation was terminated by ${signal}.`
              : `Sigil compile exited with code ${
                code ?? "unknown"
              } without a completed report.`,
          ),
        );
      }
    });
  });

  return {
    result,
    cancel: () => child.kill("SIGTERM"),
  };
}

export function parseCompilationEvent(line: string): CompilationEvent {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Compilation event must be an object.");
  }
  const event = value as Record<string, unknown>;
  if (
    event.protocolVersion !== 1 || typeof event.runId !== "string" ||
    typeof event.sequence !== "number" || typeof event.type !== "string" ||
    !event.payload || typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    throw new Error("Incompatible or malformed compilation event.");
  }
  return event as unknown as CompilationEvent;
}

export function componentAt(
  source: string,
  zeroBasedLine: number,
): string | undefined {
  const prefix = source.split(/\r?\n/).slice(0, zeroBasedLine + 1).join("\n");
  const matches = [
    ...prefix.matchAll(
      /^\s*component\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm,
    ),
  ];
  return matches.at(-1)?.[1];
}

function isCompilationReport(value: unknown): value is CompilationReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return report.reportVersion === 1 &&
    ["red", "yellow", "green"].includes(String(report.status)) &&
    Array.isArray(report.componentNames) && Array.isArray(report.diagnostics);
}
