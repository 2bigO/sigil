import {
  type CompilationTerminalEvent,
  type ExpectedCompilationRun,
  isCompilationReport,
  isDiagnostic,
  isStageReport,
  object,
  validExpectedRun,
} from "./event-protocol.ts";
import { equalReportWireValue } from "./report-protocol.ts";
import type {
  CompilationEvent,
  CompilerDiagnostic,
  StageReport,
} from "./types.ts";

export type ReadableEnvelopeSource = AsyncIterable<Uint8Array>;
export type StreamValidationResult =
  | { readonly kind: "terminal"; readonly event: CompilationTerminalEvent }
  | { readonly kind: "protocol-invalid" }
  | { readonly kind: "source-unavailable" };

// @sigil implements packages/compiler/src/event-reader.sigil::SigilCompilationEventReader::CompilationEventReaderProtocol interface,constraints,cases
export async function validateCompilationEventStream(
  source: ReadableEnvelopeSource,
  expected: ExpectedCompilationRun,
  signal: AbortSignal,
): Promise<StreamValidationResult> {
  if (!validExpectedRun(expected)) return { kind: "protocol-invalid" };
  if (signal.aborted) return { kind: "source-unavailable" };

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const iterator = source[Symbol.asyncIterator]();
  const state = new ReaderState(expected);
  let text = "";
  let cancelled = false;
  let wakeCancellation!: () => void;
  const cancellation = new Promise<"cancelled">((resolve) => {
    wakeCancellation = () => resolve("cancelled");
  });
  signal.addEventListener("abort", wakeCancellation, { once: true });
  try {
    while (true) {
      const settled = await Promise.race([
        iterator.next().then((result) => ({ kind: "source" as const, result }))
          .catch(() => ({ kind: "failed" as const })),
        cancellation.then(() => ({ kind: "cancelled" as const })),
      ]);
      if (settled.kind === "cancelled") {
        cancelled = true;
        return { kind: "source-unavailable" };
      }
      if (settled.kind === "failed") return { kind: "source-unavailable" };
      if (settled.result.done) break;
      const chunk = settled.result.value;
      if (!(chunk instanceof Uint8Array) || chunk.length === 0) {
        return { kind: "source-unavailable" };
      }
      try {
        text += decoder.decode(chunk, { stream: true });
      } catch {
        return { kind: "protocol-invalid" };
      }
      while (text.includes("\n")) {
        const index = text.indexOf("\n");
        let frame = text.slice(0, index);
        text = text.slice(index + 1);
        if (frame.endsWith("\r")) frame = frame.slice(0, -1);
        const outcome = state.consume(frame);
        if (outcome) return outcome;
      }
      if (signal.aborted) {
        cancelled = true;
        return { kind: "source-unavailable" };
      }
    }
    try {
      text += decoder.decode();
    } catch {
      return { kind: "protocol-invalid" };
    }
    if (text) {
      return state.terminal
        ? { kind: "protocol-invalid" }
        : { kind: "source-unavailable" };
    }
    return state.terminal
      ? { kind: "terminal", event: state.terminal }
      : { kind: "source-unavailable" };
  } finally {
    signal.removeEventListener("abort", wakeCancellation);
    if (cancelled) void iterator.return?.().catch(() => undefined);
  }
}

class ReaderState {
  sequence = 0;
  runId?: string;
  terminal?: CompilationTerminalEvent;
  private openStage?: string;
  private lastStageIndex = -1;
  private readonly diagnostics: CompilerDiagnostic[] = [];
  private readonly stageReports = new Map<string, StageReport>();
  private readonly fingerprints = new Set<string>();

  constructor(private readonly expected: ExpectedCompilationRun) {}

  consume(frame: string): StreamValidationResult | undefined {
    if (!frame || this.terminal) return { kind: "protocol-invalid" };
    if (hasDuplicateObjectKey(frame)) return { kind: "protocol-invalid" };
    let value: unknown;
    try {
      value = JSON.parse(frame);
    } catch {
      return { kind: "protocol-invalid" };
    }
    if (
      !object(value) || value.protocolVersion !== 1 ||
      !exactKeys(value, [
        "protocolVersion",
        "runId",
        "sequence",
        "type",
        "payload",
      ]) || !canonicalRunId(value.runId) ||
      value.sequence !== this.sequence + 1 || !object(value.payload) ||
      typeof value.type !== "string"
    ) return { kind: "protocol-invalid" };
    const event = value as unknown as CompilationEvent;
    this.sequence++;
    if (this.sequence === 1) {
      if (
        event.type !== "started" ||
        !exactKeys(
          event.payload,
          this.expected.operation === "session-evaluation"
            ? ["operation", "sessionIdentity"]
            : ["operation"],
        ) ||
        event.payload.operation !== this.expected.operation ||
        event.payload.sessionIdentity !== this.expected.sessionIdentity
      ) return { kind: "protocol-invalid" };
      this.runId = event.runId;
      return;
    }
    if (event.runId !== this.runId || event.type === "started") {
      return { kind: "protocol-invalid" };
    }
    if (event.type === "stage-started") {
      if (!exactKeys(event.payload, ["stage"])) {
        return { kind: "protocol-invalid" };
      }
      const stage = event.payload.stage;
      const index = typeof stage === "string"
        ? this.expected.stageIdentities.indexOf(stage)
        : -1;
      if (index <= this.lastStageIndex || this.openStage) {
        return { kind: "protocol-invalid" };
      }
      this.openStage = stage as string;
      this.lastStageIndex = index;
      return;
    }
    if (event.type === "diagnostic") {
      if (
        !exactKeys(event.payload, ["diagnostic"]) &&
        !exactKeys(event.payload, ["diagnostic", "componentName"])
      ) return { kind: "protocol-invalid" };
      const diagnostic = event.payload.diagnostic;
      if (
        !isDiagnostic(diagnostic) || diagnostic.stage !== this.openStage ||
        this.fingerprints.has(diagnostic.fingerprint) ||
        event.payload.componentName === ""
      ) return { kind: "protocol-invalid" };
      this.fingerprints.add(diagnostic.fingerprint);
      this.diagnostics.push(diagnostic);
      return;
    }
    if (event.type === "stage-completed") {
      if (!exactKeys(event.payload, ["report"])) {
        return { kind: "protocol-invalid" };
      }
      const report = event.payload.report;
      if (!isStageReport(report) || report.id !== this.openStage) {
        return { kind: "protocol-invalid" };
      }
      this.openStage = undefined;
      this.stageReports.set(report.id, report);
      return;
    }
    if (event.type === "completed") {
      if (!exactKeys(event.payload, ["report"])) {
        return { kind: "protocol-invalid" };
      }
      const report = event.payload.report;
      if (!isCompilationReport(report) || !this.reconciles(report)) {
        return { kind: "protocol-invalid" };
      }
      this.terminal = event as CompilationTerminalEvent;
      return;
    }
    if (event.type === "failed") {
      if (
        !exactKeys(event.payload, ["code", "message"]) ||
        typeof event.payload.code !== "string" || !event.payload.code ||
        typeof event.payload.message !== "string"
      ) {
        return { kind: "protocol-invalid" };
      }
      this.terminal = event as CompilationTerminalEvent;
      return;
    }
    if (event.type === "cancelled") {
      if (
        !exactKeys(event.payload, ["code", "message"]) ||
        event.payload.code !== "COMPILER_CANCELLED" ||
        typeof event.payload.message !== "string"
      ) {
        return { kind: "protocol-invalid" };
      }
      this.terminal = event as CompilationTerminalEvent;
      return;
    }
    return { kind: "protocol-invalid" };
  }

  private reconciles(report: import("./types.ts").CompilationReport): boolean {
    if (
      report.runId !== this.runId ||
      report.session?.sessionIdentity !== this.expected.sessionIdentity ||
      report.stages.map((stage) => stage.id).join("\0") !==
        this.expected.stageIdentities.join("\0") ||
      report.stages.some((stage) =>
        stage.state === "pending" || stage.state === "running" ||
        stage.state === "cancelled"
      )
    ) return false;
    for (const [id, delivered] of this.stageReports) {
      if (
        !equalReportWireValue(
          delivered,
          report.stages.find((stage) => stage.id === id),
        )
      ) return false;
    }
    return this.diagnostics.every((delivered) =>
      report.diagnostics.filter((candidate) =>
        candidate.fingerprint === delivered.fingerprint &&
        equalReportWireValue(candidate, delivered)
      ).length === 1
    );
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    [...expected].sort().every((key, index) => keys[index] === key);
}

function canonicalRunId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(
        value,
      );
}

function hasDuplicateObjectKey(source: string): boolean {
  let index = 0;
  let duplicate = false;
  const whitespace = () => {
    while (/\s/.test(source[index] ?? "")) index++;
  };
  const string = (): string => {
    const start = index++;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
      } else if (source[index++] === '"') {
        return JSON.parse(source.slice(start, index));
      }
    }
    return "";
  };
  const value = (): void => {
    whitespace();
    if (source[index] === '"') {
      string();
      return;
    }
    if (source[index] === "{") {
      index++;
      const keys = new Set<string>();
      whitespace();
      while (index < source.length && source[index] !== "}") {
        if (source[index] !== '"') return;
        const key = string();
        if (keys.has(key)) duplicate = true;
        keys.add(key);
        whitespace();
        if (source[index++] !== ":") return;
        value();
        whitespace();
        if (source[index] === ",") {
          index++;
          whitespace();
        } else break;
      }
      if (source[index] === "}") index++;
      return;
    }
    if (source[index] === "[") {
      index++;
      whitespace();
      while (index < source.length && source[index] !== "]") {
        value();
        whitespace();
        if (source[index] === ",") {
          index++;
          whitespace();
        } else break;
      }
      if (source[index] === "]") index++;
      return;
    }
    while (index < source.length && !/[\s,\]}]/.test(source[index])) index++;
  };
  try {
    value();
  } catch {
    return false;
  }
  return duplicate;
}
