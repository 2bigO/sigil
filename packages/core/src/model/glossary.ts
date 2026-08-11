import type { SigilDiagnostic } from "./diagnostics.ts";
import type {
  SigilFormKind,
  SigilSectionName,
  SourceRange,
} from "./language.ts";
export type { SigilDiagnostic } from "./diagnostics.ts";
export type {
  SigilFormKind,
  SigilSectionName,
  SourceLocation,
  SourceRange,
} from "./language.ts";
export type { SemanticUnit, SigilDocument } from "./source.ts";
export type { SigilWorkspace } from "./workspace.ts";

export type GlossaryScope =
  | { readonly kind: "workspace" }
  | { readonly kind: "context"; readonly id: string };

export interface GlossaryTerm {
  readonly term: string;
  readonly definition: string;
  readonly aliases: readonly string[];
  readonly agentContext: boolean;
  readonly scope: GlossaryScope;
  readonly declarationRange: SourceRange;
}

export interface GlossaryContext {
  readonly id: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly terms: readonly GlossaryTerm[];
}

// @sigil implements packages/core/src/model/glossary.sigil::SigilGlossaryModel::GlossaryModel interface
export interface WorkspaceGlossary {
  readonly schemaVersion: 1;
  readonly filePath: string;
  readonly terms: readonly GlossaryTerm[];
  readonly contexts: readonly GlossaryContext[];
}

export interface GlossaryParseResult {
  readonly glossary?: WorkspaceGlossary;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface ResolvedGlossaryContext {
  readonly filePath: string;
  readonly contextId?: string;
  readonly entries: readonly GlossaryTerm[];
}

export interface GlossaryOccurrence {
  readonly term: GlossaryTerm;
  readonly matchedSpelling: string;
  readonly filePath: string;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly range: SourceRange;
}

export interface GlossaryProjection {
  readonly workspaceSnapshotIdentity: string;
  readonly glossaryPath?: string;
  readonly schemaVersion?: 1;
  readonly terms: readonly GlossaryTerm[];
  readonly contexts: readonly GlossaryContext[];
  readonly resolvedContexts: readonly ResolvedGlossaryContext[];
  readonly occurrences: readonly GlossaryOccurrence[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface GlossaryContextProjection {
  readonly glossaryPath?: string;
  readonly terms: readonly GlossaryTerm[];
  readonly resolvedContexts: readonly ResolvedGlossaryContext[];
  readonly occurrences: readonly GlossaryOccurrence[];
  readonly diagnostics: readonly SigilDiagnostic[];
}
