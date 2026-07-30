import type { SourceRange } from "@qoherent/sigil-core";

export const COMPILATION_PROTOCOL_VERSION = 1;
export const COMPILATION_REPORT_VERSION = 1;

export type CompilationColor = "red" | "yellow" | "green";
export type DiagnosticSeverity =
  | "error"
  | "warning"
  | "optimization"
  | "information";
export type DiagnosticLifecycle =
  | "new"
  | "unchanged"
  | "resolved"
  | "regressed";
export type StageState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped-by-dependency"
  | "disabled"
  | "cancelled";

export interface CompilationTarget {
  readonly kind: "workspace" | "file" | "component";
  readonly value?: string;
}

export interface CompilerDiagnostic {
  readonly code: string;
  readonly fingerprint: string;
  readonly severity: DiagnosticSeverity;
  readonly stage: string;
  readonly skill: string;
  readonly message: string;
  readonly filePath?: string;
  readonly range?: SourceRange;
  readonly evidence: string;
  readonly impact: string;
  readonly correction: string;
  readonly evaluator: string;
  readonly lifecycle: DiagnosticLifecycle;
}

export interface StageReport {
  readonly id: string;
  readonly required: boolean;
  readonly state: StageState;
  readonly evaluator: string;
  readonly diagnosticCount: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface EffectiveProfile {
  readonly name: string;
  readonly contextBudgetChars: number;
  readonly stages: readonly {
    readonly id: string;
    readonly required: boolean;
    readonly enabled: boolean;
    readonly agentic: boolean;
    readonly dependencies: readonly string[];
  }[];
  readonly adapter?: {
    readonly provider: "codex" | "claude" | "mock";
    readonly model?: string;
  };
  readonly fingerprint: string;
}

export interface CompilationReport {
  readonly reportVersion: 1;
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly target: CompilationTarget;
  readonly componentNames: readonly string[];
  readonly status: CompilationColor;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly sourceFingerprint: string;
  readonly profile: EffectiveProfile;
  readonly stages: readonly StageReport[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export type CompilationEventType =
  | "started"
  | "stage-started"
  | "stage-completed"
  | "diagnostic"
  | "completed"
  | "failed"
  | "cancelled";

export interface CompilationEvent {
  readonly protocolVersion: 1;
  readonly runId: string;
  readonly sequence: number;
  readonly type: CompilationEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface CompileOptions {
  readonly profile?: string;
  readonly noHistory?: boolean;
  readonly output?: string;
  readonly signal?: AbortSignal;
  readonly adapter?: AgentAdapter;
  readonly onEvent?: (event: CompilationEvent) => void | Promise<void>;
}

export interface AgentFinding {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly filePath?: string;
  readonly line?: number;
  readonly column?: number;
  readonly evidence: string;
  readonly impact: string;
  readonly correction: string;
}

export interface AgentEvaluationRequest {
  readonly stage: string;
  readonly skill: string;
  readonly context: string;
  readonly signal?: AbortSignal;
}

export interface AgentAdapter {
  readonly id: string;
  readonly provider: "codex" | "claude" | "mock";
  readonly model?: string;
  readonly capabilities: {
    readonly readOnlyWorkspace: true;
    readonly network: false;
  };
  evaluate(request: AgentEvaluationRequest): Promise<readonly AgentFinding[]>;
}

export interface CompileConfiguration {
  readonly defaultProfile?: string;
  readonly adapter?: {
    readonly provider: "codex" | "claude";
    readonly model?: string;
  };
  readonly profiles?: Readonly<
    Record<string, {
      readonly extends?: "standard" | "critical-system";
      readonly disabledStages?: readonly string[];
    }>
  >;
}
