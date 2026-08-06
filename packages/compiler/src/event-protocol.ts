import type {
  CompilationEvent,
  CompilationReport,
  CompilerDiagnostic,
  StageReport,
} from "./types.ts";
import {
  validateCompilationReportWire,
  validDiagnostic,
  validStageReport,
} from "./report-protocol.ts";

export type CompilationOperation =
  | "one-shot-compilation"
  | "session-evaluation";

export interface ExpectedCompilationRun {
  readonly operation: CompilationOperation;
  readonly stageIdentities: readonly string[];
  readonly sessionIdentity?: string;
}

export type CompilationTerminalEvent = CompilationEvent & {
  readonly type: "completed" | "failed" | "cancelled";
};

export interface StageIdentity {
  readonly stage: string;
}

export function validExpectedRun(value: ExpectedCompilationRun): boolean {
  return (value.operation === "one-shot-compilation" ||
    value.operation === "session-evaluation") &&
    value.stageIdentities.length > 0 &&
    value.stageIdentities.every((stage) => stage.length > 0) &&
    new Set(value.stageIdentities).size === value.stageIdentities.length &&
    (value.operation === "session-evaluation"
      ? !!value.sessionIdentity
      : value.sessionIdentity === undefined);
}

// @sigil implements packages/compiler/src/event-protocol.sigil::SigilCompilationEventProtocol::CompilationEventProtocol interface,constraints,cases
export function compilationEvent(
  runId: string,
  sequence: number,
  type: CompilationEvent["type"],
  payload: Readonly<Record<string, unknown>>,
): CompilationEvent {
  if (
    !runId || !Number.isInteger(sequence) || sequence < 1 ||
    sequence > 0xffff_ffff
  ) {
    throw new Error("Invalid compilation event identity or sequence.");
  }
  return { protocolVersion: 1, runId, sequence, type, payload };
}

export function startedPayload(
  expected: ExpectedCompilationRun,
): { readonly operation: string; readonly sessionIdentity?: string } {
  return expected.operation === "session-evaluation"
    ? {
      operation: expected.operation,
      sessionIdentity: expected.sessionIdentity!,
    }
    : { operation: expected.operation };
}

export function isStageReport(value: unknown): value is StageReport {
  return validStageReport(value) &&
    (value.state === "completed" || value.state === "failed");
}

export function isDiagnostic(value: unknown): value is CompilerDiagnostic {
  return validDiagnostic(value);
}

export function isCompilationReport(
  value: unknown,
): value is CompilationReport {
  return validateCompilationReportWire(value);
}

export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
