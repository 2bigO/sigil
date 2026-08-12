import type {
  CompilationEvent,
  CompilationReport,
  CompilerDiagnostic,
  StageReport,
} from "./types.ts";
import {
  compilationEvent,
  type ExpectedCompilationRun,
  isCompilationReport,
  isDiagnostic,
  isStageReport,
  startedPayload,
  validExpectedRun,
} from "./event-protocol.ts";
import { equalReportWireValue } from "./report-protocol.ts";

export type SinkWriteResult =
  | "delivered-all"
  | "rejected-zero-compatible"
  | "rejected-zero-unavailable"
  | "rejected-partial";
export type WritableEnvelopeSink = (
  bytes: Uint8Array,
) => Promise<SinkWriteResult>;
export type WriterResult =
  | "delivered"
  | "suppressed"
  | "stream-unavailable"
  | "terminal-unavailable"
  | "stream-incompatible"
  | "protocol-invalid"
  | "protocol-exhausted";

export interface CompilationEventWriter {
  readonly runId: string;
  stageStarted(stage: string): Promise<WriterResult>;
  diagnostic(
    diagnostic: CompilerDiagnostic,
    componentName?: string,
  ): Promise<WriterResult>;
  stageCompleted(report: StageReport): Promise<WriterResult>;
  completed(report: CompilationReport): Promise<WriterResult>;
  failed(code: string, message: string): Promise<WriterResult>;
  cancelled(message: string): Promise<WriterResult>;
}

export type OpenWriterResult =
  | {
    readonly kind: "ready";
    readonly runId: string;
    readonly writer: CompilationEventWriter;
  }
  | { readonly kind: "failure"; readonly result: WriterResult };

// @sigil implements packages/compiler/src/event-writer.sigil::SigilCompilationEventWriter::CompilationEventWriterProtocol interface,constraints,cases
export async function openCompilationEventWriter(
  sink: WritableEnvelopeSink,
  expected: ExpectedCompilationRun,
): Promise<OpenWriterResult> {
  if (!validExpectedRun(expected)) {
    return { kind: "failure", result: "protocol-invalid" };
  }
  const runId = crypto.randomUUID().toLowerCase();
  const state = new WriterState(runId, sink, expected);
  const started = await state.write("started", startedPayload(expected), false);
  return started === "delivered" ? { kind: "ready", runId, writer: state } : {
    kind: "failure",
    result: started === "suppressed" || started === "stream-unavailable" ||
        started === "terminal-unavailable"
      ? "stream-unavailable"
      : started,
  };
}

class WriterState implements CompilationEventWriter {
  private sequence = 0;
  private closed?: WriterResult;
  private suppressed = false;
  private openStage?: string;
  private lastStageIndex = -1;
  private readonly deliveredDiagnostics: CompilerDiagnostic[] = [];
  private readonly deliveredStageReports = new Map<string, StageReport>();
  private readonly fingerprints = new Set<string>();
  private terminalAccepted = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    readonly runId: string,
    private readonly sink: WritableEnvelopeSink,
    private readonly expected: ExpectedCompilationRun,
  ) {}

  stageStarted(stage: string): Promise<WriterResult> {
    return this.enqueue(false, () => {
      if (
        !stage || this.openStage ||
        !this.expected.stageIdentities.includes(stage)
      ) return undefined;
      const index = this.expected.stageIdentities.indexOf(stage);
      if (index <= this.lastStageIndex) return undefined;
      this.openStage = stage;
      this.lastStageIndex = index;
      return ["stage-started", { stage }];
    });
  }

  diagnostic(
    diagnostic: CompilerDiagnostic,
    componentName?: string,
  ): Promise<WriterResult> {
    return this.enqueue(false, () => {
      if (
        !isDiagnostic(diagnostic) || diagnostic.stage !== this.openStage ||
        componentName === "" || this.fingerprints.has(diagnostic.fingerprint)
      ) return undefined;
      this.fingerprints.add(diagnostic.fingerprint);
      return ["diagnostic", {
        diagnostic,
        ...(componentName ? { componentName } : {}),
      }];
    });
  }

  stageCompleted(report: StageReport): Promise<WriterResult> {
    return this.enqueue(false, () => {
      if (!isStageReport(report) || report.id !== this.openStage) {
        return undefined;
      }
      this.openStage = undefined;
      return ["stage-completed", { report }];
    });
  }

  completed(report: CompilationReport): Promise<WriterResult> {
    return this.enqueue(true, () => {
      if (
        !isCompilationReport(report) || report.runId !== this.runId ||
        !isOrderedStageSubset(
          report.stages.map((stage) => stage.id),
          this.expected.stageIdentities,
        ) ||
        (this.expected.operation === "session-evaluation"
          ? report.session?.sessionIdentity !== this.expected.sessionIdentity
          : report.session !== undefined) ||
        !this.reconciles(report)
      ) return undefined;
      return ["completed", { report }];
    });
  }

  failed(code: string, message: string): Promise<WriterResult> {
    return this.enqueue(
      true,
      () =>
        typeof code !== "string" || !code || code === "COMPILER_CANCELLED" ||
          typeof message !== "string"
          ? undefined
          : ["failed", { code, message }],
    );
  }

  cancelled(message: string): Promise<WriterResult> {
    return this.enqueue(
      true,
      () =>
        typeof message === "string"
          ? ["cancelled", { code: "COMPILER_CANCELLED", message }]
          : undefined,
    );
  }

  private enqueue(
    terminal: boolean,
    build: () =>
      | readonly [CompilationEvent["type"], Record<string, unknown>]
      | undefined,
  ): Promise<WriterResult> {
    if (this.terminalAccepted) return Promise.resolve("protocol-invalid");
    if (terminal) this.terminalAccepted = true;
    let resolve!: (value: WriterResult) => void;
    const result = new Promise<WriterResult>((accept) => resolve = accept);
    const previous = this.tail;
    this.tail = (async () => {
      await previous;
      if (this.closed) {
        resolve(
          terminal && this.closed === "stream-unavailable"
            ? "terminal-unavailable"
            : this.closed,
        );
        return;
      }
      let envelope;
      try {
        envelope = build();
      } catch {
        this.closed = "protocol-invalid";
        resolve(this.closed);
        return;
      }
      if (!envelope) {
        this.closed = "protocol-invalid";
        resolve(this.closed);
        return;
      }
      if (!terminal && this.suppressed) {
        resolve("suppressed");
        return;
      }
      resolve(await this.write(envelope[0], envelope[1], terminal));
    })();
    return result;
  }

  async write(
    type: CompilationEvent["type"],
    payload: Record<string, unknown>,
    terminal: boolean,
  ): Promise<WriterResult> {
    if (this.sequence === 0xffff_ffff) {
      return this.closed = "protocol-exhausted";
    }
    const event = compilationEvent(
      this.runId,
      this.sequence + 1,
      type,
      payload,
    );
    let outcome: SinkWriteResult;
    try {
      outcome = await this.sink(
        new TextEncoder().encode(`${JSON.stringify(event)}\n`),
      );
    } catch {
      return this.closed = "stream-incompatible";
    }
    if (outcome === "delivered-all") {
      this.sequence++;
      if (type === "diagnostic") {
        this.deliveredDiagnostics.push(
          payload.diagnostic as CompilerDiagnostic,
        );
      } else if (type === "stage-completed") {
        const report = payload.report as StageReport;
        this.deliveredStageReports.set(report.id, report);
      }
      if (terminal) this.closed = "delivered";
      return "delivered";
    }
    if (outcome === "rejected-partial") {
      return this.closed = "stream-incompatible";
    }
    if (
      outcome !== "rejected-zero-compatible" &&
      outcome !== "rejected-zero-unavailable"
    ) return this.closed = "stream-incompatible";
    if (terminal) return this.closed = "terminal-unavailable";
    if (outcome === "rejected-zero-compatible") {
      this.suppressed = true;
      return "suppressed";
    }
    return this.closed = "stream-unavailable";
  }

  private reconciles(report: CompilationReport): boolean {
    if (
      report.stages.some((stage) =>
        stage.state === "pending" || stage.state === "running" ||
        stage.state === "cancelled"
      )
    ) return false;
    for (const [stageId, delivered] of this.deliveredStageReports) {
      const terminal = report.stages.find((stage) => stage.id === stageId);
      if (!terminal || !equalReportWireValue(delivered, terminal)) return false;
    }
    for (const diagnostic of this.deliveredDiagnostics) {
      const matches = report.diagnostics.filter((candidate) =>
        candidate.fingerprint === diagnostic.fingerprint &&
        equalReportWireValue(candidate, diagnostic)
      );
      if (matches.length !== 1) return false;
    }
    return true;
  }
}

function isOrderedStageSubset(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  let previous = -1;
  for (const stage of actual) {
    const index = expected.indexOf(stage);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

export interface CompilationEventStream {
  readonly runId: string;
  emit(
    type: CompilationEvent["type"],
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

export function createCompilationEventStream(
  runId: string,
  sink?: (event: CompilationEvent) => void | Promise<void>,
): CompilationEventStream {
  let sequence = 0;
  let terminal = false;
  return {
    runId,
    async emit(type, payload) {
      if (terminal) throw new Error("Compilation event stream is settled.");
      await sink?.(compilationEvent(runId, ++sequence, type, payload));
      if (type === "completed" || type === "failed" || type === "cancelled") {
        terminal = true;
      }
    },
  };
}
