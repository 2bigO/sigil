import { compile } from "./compiler.ts";
import { evaluateCompilation } from "./evaluation.ts";
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
import { constructSessionCompilationReport } from "./report-protocol.ts";
import type {
  CompilationEvent,
  CompilationHistoryStore,
  CompilationProposal,
  CompilationReport,
  CompilationSessionRecord,
  CompilationSessionRefreshResult,
  CompilationFocus,
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
    readonly focus?: CompilationFocus,
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
    let workspace: SigilProposalWorkspace | undefined;
    let commitFailed = false;
    try {
      const openedWriter = await openCompilationEventWriter(
        options.eventSink ?? callbackEventSink(options.onEvent),
        {
          operation: "session-evaluation",
          sessionIdentity: this.sessionIdentity,
          stageIdentities: sessionStageIdentities(),
        },
      );
      if (openedWriter.kind === "failure") {
        throw new CompilerFailure(
          "COMPILER_FAILED",
          `Session event stream could not be established: ${openedWriter.result}.`,
        );
      }
      eventWriter = openedWriter.writer;
      const opened = await this.store.open(this.sessionIdentity);
      lease = opened.lease;
      await expireIfNecessary(opened.record, lease, this.store);
      assertUsable(opened.record);
      workspace = await SigilProposalWorkspace.restore(
        opened.record.proposalWorkspace,
      );
      const generation = await workspace.apply(proposal);
      const history = new SessionHistoryStore(opened.record.latestReport);
      const report = await evaluateCompilation(
        this.compiler,
        generation.workspacePath,
        opened.record.target,
        opened.record.profileName,
        {
          focus: opened.record.focus,
          cancellationSignal: options.cancellationSignal,
          history,
          onEvent: (event) => forwardProgress(eventWriter!, event),
        },
      );
      const authoritative = constructSessionCompilationReport(report, {
        runId: eventWriter.runId,
        workspaceRoot: opened.record.workspacePath.replaceAll("\\", "/"),
        sessionIdentity: this.sessionIdentity,
        baseEpoch: opened.record.baseEpoch,
        generation: generation.generation,
        baseFingerprint: opened.record.baseFingerprint,
        proposalFingerprint: generation.proposalFingerprint,
      });
      const record: CompilationSessionRecord = {
        ...opened.record,
        lifecycle: "active",
        expiresAt: nextExpiry(this.sessionTtlMs),
        generation: generation.generation,
        proposalFingerprint: generation.proposalFingerprint,
        proposalWorkspace: workspace.persistedState(),
        latestReport: authoritative,
      };
      try {
        await this.store.commit(lease, record);
      } catch (error) {
        commitFailed = true;
        throw error;
      }
      await lease.release();
      lease = undefined;
      requireTerminalDelivery(await eventWriter.completed(authoritative));
      return authoritative;
    } catch (error) {
      if (commitFailed && lease && workspace) {
        const retainedLease = lease;
        try {
          await workspace.close();
          await this.store.remove(retainedLease);
          lease = undefined;
        } catch (cleanupError) {
          const cleanupCode = compilerFailureCode(cleanupError);
          const code = cleanupCode === "COMPILER_WORKSPACE_OWNERSHIP_UNVERIFIED"
            ? cleanupCode
            : "COMPILER_WORKSPACE_HOST_FAILURE";
          await retainedLease.release().catch(() => {});
          lease = undefined;
          throw new CompilerFailure(
            code,
            "Evaluation commit failed and proposal-workspace cleanup could not complete.",
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
      }
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
      await expireIfNecessary(opened.record, lease, this.store);
      assertUsable(opened.record);
      const old = await SigilProposalWorkspace.restore(
        opened.record.proposalWorkspace,
      );
      let replacement: Awaited<
        ReturnType<typeof SigilProposalWorkspace.create>
      >;
      try {
        await old.close();
        replacement = await SigilProposalWorkspace.create(
          opened.record.workspacePath,
          this.sessionIdentity,
        );
      } catch (error) {
        const failedRecord: CompilationSessionRecord = {
          ...opened.record,
          lifecycle: compilerFailureCode(error) ===
              "COMPILER_WORKSPACE_OWNERSHIP_UNVERIFIED"
            ? "manual-recovery-required"
            : "cleanup-failed",
        };
        try {
          await this.store.commit(lease, failedRecord);
        } catch (commitError) {
          throw new CompilerFailure(
            "COMPILER_WORKSPACE_HOST_FAILURE",
            "Failed to persist refresh cleanup state.",
            { cause: new AggregateError([error, commitError]) },
          );
        }
        throw error;
      }
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
      try {
        await this.store.commit(lease, record);
      } catch (error) {
        try {
          await replacement.workspace.close();
          await this.store.remove(lease);
        } catch (cleanupError) {
          const cleanupCode = compilerFailureCode(cleanupError);
          const code = cleanupCode === "COMPILER_WORKSPACE_OWNERSHIP_UNVERIFIED"
            ? cleanupCode
            : "COMPILER_WORKSPACE_HOST_FAILURE";
          throw new CompilerFailure(
            code,
            "Refresh commit failed and proposal-workspace cleanup could not complete.",
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
        throw error;
      }
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
      if (record.lifecycle === "expired") {
        await lease.release();
        return;
      }
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

function sessionStageIdentities(): readonly string[] {
  return [
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
  if (record.lifecycle === "expired") {
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

async function expireIfNecessary(
  record: CompilationSessionRecord,
  lease: CompilationSessionLease,
  store: FileCompilationSessionStore,
): Promise<void> {
  if (Date.parse(record.expiresAt) > Date.now() || record.lifecycle === "expired") {
    return;
  }
  const workspace = await SigilProposalWorkspace.restore(record.proposalWorkspace);
  try {
    await workspace.close();
    await store.commit(lease, { ...record, lifecycle: "expired" });
    throw new CompilerFailure(
      "COMPILER_SESSION_EXPIRED",
      "Compilation session has expired.",
    );
  } catch (error) {
    if (error instanceof CompilerFailure && error.code === "COMPILER_SESSION_EXPIRED") {
      throw error;
    }
    const failedRecord: CompilationSessionRecord = {
      ...record,
      lifecycle: compilerFailureCode(error) ===
          "COMPILER_WORKSPACE_OWNERSHIP_UNVERIFIED"
        ? "manual-recovery-required"
        : "cleanup-failed",
    };
    await store.commit(lease, failedRecord).catch(() => {});
    throw error;
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
