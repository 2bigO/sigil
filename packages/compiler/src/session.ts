import { compile } from "./compiler.ts";
import {
  type CompilationEventWriter,
  openCompilationEventWriter,
  type WritableEnvelopeSink,
  type WriterResult,
} from "./event-writer.ts";
import { SigilProposalWorkspace } from "./proposal-workspace.ts";
import {
  type CompilationSessionLease,
  FileCompilationSessionStore,
} from "./session-store.ts";
import { CompilerFailure, compilerFailureCode } from "./status.ts";
import type {
  CompilationEvent,
  CompilationHistoryStore,
  CompilationProposal,
  CompilationReport,
  CompilationSessionRecord,
  CompilationSessionRefreshResult,
} from "./types.ts";

const DEFAULT_SESSION_TTL_MS = 86_400_000;

export interface SessionEvaluationOptions {
  readonly cancellationSignal?: AbortSignal;
  readonly eventSink?: WritableEnvelopeSink;
  /** Backward-compatible decoded-event callback façade. */
  readonly onEvent?: (event: CompilationEvent) => void | Promise<void>;
}

// @sigil implements packages/compiler/src/session.sigil::SigilCompilationSession interface,state,logic,constraints,cases
export class SigilCompilationSession {
  constructor(
    readonly sessionIdentity: string,
    private readonly store: FileCompilationSessionStore =
      new FileCompilationSessionStore(),
    private readonly compiler: typeof compile = compile,
    private readonly sessionTtlMs: number = DEFAULT_SESSION_TTL_MS,
  ) {}

  async evaluate(
    proposal: CompilationProposal,
    options: SessionEvaluationOptions = {},
  ): Promise<CompilationReport> {
    let lease: CompilationSessionLease | undefined;
    let eventWriter: CompilationEventWriter | undefined;
    try {
      const opened = await this.store.open(this.sessionIdentity);
      lease = opened.lease;
      assertUsable(opened.record);
      const openedWriter = await openCompilationEventWriter(
        options.eventSink ?? callbackEventSink(options.onEvent),
        {
          operation: "session-evaluation",
          sessionIdentity: this.sessionIdentity,
          stageIdentities: sessionStageIdentities(opened.record.focus),
        },
      );
      if (openedWriter.kind === "failure") {
        throw new CompilerFailure(
          "COMPILER_FAILED",
          `Session event stream could not be established: ${openedWriter.result}.`,
        );
      }
      eventWriter = openedWriter.writer;
      const workspace = await SigilProposalWorkspace.restore(
        opened.record.proposalWorkspace,
      );
      const generation = await workspace.apply(proposal);
      const history = new SessionHistoryStore(opened.record.latestReport);
      const report = await this.compiler(
        generation.workspacePath,
        opened.record.target,
        {
          profile: opened.record.profileName,
          focus: opened.record.focus,
          cancellationSignal: options.cancellationSignal,
          history,
          onEvent: (event) => forwardProgress(eventWriter!, event),
        },
      );
      const authoritative: CompilationReport = {
        ...report,
        runId: eventWriter.runId,
        workspaceRoot: opened.record.workspacePath.replaceAll("\\", "/"),
        session: {
          sessionIdentity: this.sessionIdentity,
          baseEpoch: opened.record.baseEpoch,
          generation: generation.generation,
          baseFingerprint: opened.record.baseFingerprint,
          proposalFingerprint: generation.proposalFingerprint,
        },
      };
      const record: CompilationSessionRecord = {
        ...opened.record,
        lifecycle: "active",
        expiresAt: nextExpiry(this.sessionTtlMs),
        generation: generation.generation,
        proposalFingerprint: generation.proposalFingerprint,
        proposalWorkspace: workspace.persistedState(),
        latestReport: authoritative,
      };
      await this.store.commit(lease, record);
      await lease.release();
      lease = undefined;
      requireTerminalDelivery(await eventWriter.completed(authoritative));
      return authoritative;
    } catch (error) {
      await lease?.release().catch(() => {});
      const code = compilerFailureCode(error);
      if (eventWriter) {
        const message = error instanceof Error ? error.message : String(error);
        const delivery = code === "COMPILER_CANCELLED"
          ? await eventWriter.cancelled(message)
          : await eventWriter.failed(code, message);
        if (delivery !== "delivered") {
          throw new CompilerFailure(
            "COMPILER_FAILED",
            "Required terminal session event could not be written.",
            { cause: error },
          );
        }
      }
      throw error;
    }
  }

  async refresh(): Promise<CompilationSessionRefreshResult> {
    const opened = await this.store.open(this.sessionIdentity);
    const lease = opened.lease;
    try {
      assertUsable(opened.record);
      const old = await SigilProposalWorkspace.restore(
        opened.record.proposalWorkspace,
      );
      await old.close();
      const replacement = await SigilProposalWorkspace.create(
        opened.record.workspacePath,
        this.sessionIdentity,
      );
      const record: CompilationSessionRecord = {
        ...opened.record,
        lifecycle: "active",
        expiresAt: nextExpiry(this.sessionTtlMs),
        baseEpoch: opened.record.baseEpoch + 1,
        baseFingerprint: replacement.baseFingerprint,
        proposalWorkspace: replacement.workspace.persistedState(),
        generation: undefined,
        proposalFingerprint: undefined,
        latestReport: undefined,
      };
      await this.store.commit(lease, record);
      return {
        baseEpoch: record.baseEpoch,
        baseFingerprint: record.baseFingerprint,
      };
    } finally {
      await lease.release();
    }
  }

  async close(): Promise<void> {
    let opened;
    try {
      opened = await this.store.open(this.sessionIdentity);
    } catch (error) {
      if (
        error instanceof CompilerFailure &&
        error.code === "COMPILER_WORKSPACE_OWNERSHIP_UNVERIFIED"
      ) throw error;
      if (error instanceof Deno.errors.NotFound) return;
      throw error;
    }
    const { record, lease } = opened;
    try {
      const workspace = await SigilProposalWorkspace.restore(
        record.proposalWorkspace,
      );
      await workspace.close();
      await this.store.remove(lease);
    } catch (error) {
      await lease.release().catch(() => {});
      throw error;
    }
  }
}

function sessionStageIdentities(
  focus: CompilationSessionRecord["focus"],
): readonly string[] {
  return focus === "design"
    ? [
      "deterministic-foundation",
      "semantic-readiness",
      "architecture-design",
    ]
    : [
      "deterministic-foundation",
      "semantic-readiness",
      "architecture-design",
      "current-code-compatibility",
    ];
}

async function forwardProgress(
  writer: CompilationEventWriter,
  event: CompilationEvent,
): Promise<void> {
  let result: WriterResult | undefined;
  if (event.type === "stage-started") {
    result = await writer.stageStarted(String(event.payload.stage));
  } else if (event.type === "diagnostic") {
    result = await writer.diagnostic(
      event.payload.diagnostic as import("./types.ts").CompilerDiagnostic,
      event.payload.componentName as string | undefined,
    );
  } else if (event.type === "stage-completed") {
    result = await writer.stageCompleted(
      event.payload.report as import("./types.ts").StageReport,
    );
  }
  if (result && result !== "delivered" && result !== "suppressed") {
    throw new CompilerFailure(
      "COMPILER_FAILED",
      `Session progress event delivery failed: ${result}.`,
    );
  }
}

function requireTerminalDelivery(result: WriterResult): void {
  if (result !== "delivered") {
    throw new CompilerFailure(
      "COMPILER_FAILED",
      `Required terminal session event was not delivered: ${result}.`,
    );
  }
}

function callbackEventSink(
  callback: SessionEvaluationOptions["onEvent"],
): WritableEnvelopeSink {
  return async (bytes) => {
    if (!callback) return "delivered-all";
    try {
      await callback(JSON.parse(new TextDecoder().decode(bytes)));
      return "delivered-all";
    } catch {
      return "rejected-zero-unavailable";
    }
  };
}

function assertUsable(record: CompilationSessionRecord): void {
  if (
    Date.parse(record.expiresAt) <= Date.now() || record.lifecycle === "expired"
  ) {
    throw new CompilerFailure(
      "COMPILER_SESSION_EXPIRED",
      "Compilation session has expired.",
    );
  }
  if (record.lifecycle !== "active") {
    throw new CompilerFailure(
      "COMPILER_WORKSPACE_STATE",
      `Compilation session is ${record.lifecycle}.`,
    );
  }
}

function nextExpiry(ttlMs: number): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

class SessionHistoryStore implements CompilationHistoryStore {
  constructor(private report?: CompilationReport) {}
  read(): Promise<CompilationReport | undefined> {
    return Promise.resolve(this.report);
  }
  write(_key: string, report: CompilationReport): Promise<void> {
    this.report = report;
    return Promise.resolve();
  }
}
