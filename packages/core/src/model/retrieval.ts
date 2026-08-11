import type { SigilDiagnostic } from "./diagnostics.ts";
import type { ImplementationSection } from "./ownership.ts";
import type { SigilSectionName, SourceRange } from "./language.ts";
export type { SigilDiagnostic } from "./diagnostics.ts";
export type { ImplementationSection } from "./ownership.ts";
export type { SigilSectionName, SourceRange } from "./language.ts";

export type RetrievalPurpose = "semantic" | "architecture" | "implementation";
export type PurposeRetrievalTarget =
  | {
    readonly kind: "component";
    readonly componentName: string;
    readonly path: string;
  }
  | { readonly kind: "file"; readonly path: string };

// @sigil implements packages/core/src/model/retrieval.sigil::SigilRetrievalModel::RetrievalModel interface
export interface RetrievalTargetIdentity {
  readonly kind: "component" | "file";
  readonly componentName?: string;
  readonly pathStatus: "accepted" | "rejected";
  readonly path: string;
}
export type RetrievalNodeKind =
  | "request-target"
  | "component-declaration"
  | "sigil-file"
  | "expansion"
  | "module-index"
  | "public-concept-origin"
  | "implementation-target"
  | "implementation-source";
export type RetrievalRelation =
  | "selected-declaration"
  | "matching-expansion"
  | "direct-dependency"
  | "direct-importer"
  | "containing-module-index"
  | "cycle-member"
  | "public-concept-origin"
  | "owned-implementation";
export type EvidenceKind =
  | "selected-contract"
  | "selected-expansion"
  | "dependency-contract"
  | "dependency-decision"
  | "importer-contract"
  | "cycle-contract"
  | "module-index-summary"
  | "public-concept-origin"
  | "glossary-definition"
  | "ownership-projection"
  | "implementation-source"
  | "diagnostic";
export interface RetrievalNode {
  readonly identity: string;
  readonly kind: RetrievalNodeKind;
  readonly path: string;
  readonly componentName?: string;
  readonly range?: SourceRange;
}
export interface RetrievalEdge {
  readonly identity: string;
  readonly relation: RetrievalRelation;
  readonly sourceIdentity: string;
  readonly targetIdentity: string;
  readonly originPath: string;
  readonly originRange?: SourceRange;
}
export interface SelectedRetrievalGraph {
  readonly nodes: readonly RetrievalNode[];
  readonly edges: readonly RetrievalEdge[];
}
export interface EvidenceUnit {
  readonly identity: string;
  readonly kind: EvidenceKind;
  readonly path?: string;
  readonly componentName?: string;
  readonly sectionName?: SigilSectionName | ImplementationSection;
  readonly conceptIdentity?: string;
  readonly range?: SourceRange;
  readonly text: string;
  readonly inclusionReasonIdentities: readonly string[];
}
export interface InclusionReason {
  readonly identity: string;
  readonly rule: string;
  readonly seedIdentity: string;
  readonly selectedIdentity: string;
  readonly edgeIdentities: readonly string[];
}
export interface ExcludedRelation {
  readonly identity: string;
  readonly rule: string;
  readonly edgeIdentity: string;
  readonly sourceIdentity: string;
  readonly targetIdentity: string;
}
export interface ContextSection {
  readonly kind: EvidenceKind;
  readonly text: string;
  readonly evidenceIdentity: string;
  readonly inclusionReasonIdentities: readonly string[];
}
export interface AggregatedRetrievalContext {
  readonly sections: readonly ContextSection[];
}
export interface PurposeRetrievalResult {
  readonly schema: "sigil-purpose-retrieval/v1";
  readonly policyVersion: 1;
  readonly workspaceSnapshotIdentity: string;
  readonly target: RetrievalTargetIdentity;
  readonly purpose: RetrievalPurpose;
  readonly graph: SelectedRetrievalGraph;
  readonly evidence: readonly EvidenceUnit[];
  readonly inclusionReasons: readonly InclusionReason[];
  readonly exclusions: readonly ExcludedRelation[];
  readonly context: AggregatedRetrievalContext;
  readonly diagnostics: readonly SigilDiagnostic[];
  readonly fingerprint: string;
}
