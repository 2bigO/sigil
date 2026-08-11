import type { SigilDiagnostic } from "./diagnostics.ts";
import type { GlossaryProjection } from "./glossary.ts";
import type {
  SigilFormKind,
  SigilSectionName,
  SourceRange,
} from "./language.ts";
import type {
  ComponentDeclaration,
  ConceptBlock,
  ExpandDeclaration,
  ImportDeclaration,
  Section,
  SemanticUnit,
} from "./source.ts";
import type { SigilWorkspace } from "./workspace.ts";
import type { ImportedComponentEdge, SigilGraph } from "./graph.ts";
export type { SigilDiagnostic } from "./diagnostics.ts";
export type { GlossaryProjection } from "./glossary.ts";
export type {
  SigilFormKind,
  SigilSectionName,
  SourceRange,
} from "./language.ts";
export type {
  ComponentDeclaration,
  ConceptBlock,
  ExpandDeclaration,
  ImportDeclaration,
  Section,
  SemanticUnit,
} from "./source.ts";
export type { SigilWorkspace } from "./workspace.ts";
export type { ImportedComponentEdge, SigilGraph } from "./graph.ts";

export interface ResolvedImport {
  readonly declaration: ImportDeclaration;
  readonly sourceFile: string;
  readonly targetFile?: string;
  readonly names: readonly ResolvedImportName[];
}

export interface ResolvedImportName {
  readonly name: string;
  readonly component?: ComponentDeclaration;
  readonly componentFile?: string;
  readonly used: boolean;
  readonly uses: readonly ImportUse[];
}

export interface ImportUse {
  readonly kind:
    | "component-reference"
    | "public-concept-reference"
    | "structural-expand";
  readonly filePath: string;
  readonly ownerKind?: SigilFormKind;
  readonly ownerName?: string;
  readonly sectionName?: SigilSectionName;
  readonly range: SourceRange;
}

export interface CollectedExpansion {
  readonly componentName: string;
  readonly expands: readonly ResolvedExpansion[];
}

export interface ConceptBlockView {
  readonly identifier: string;
  readonly lines: readonly string[];
  readonly sourceRange: ConceptBlock["range"];
}

export interface ComponentContractView {
  readonly name: string;
  readonly filePath: string;
  readonly goalLines: readonly string[];
  readonly interfaceLines: readonly string[];
  readonly ungroupedInterfaceLines: readonly string[];
  readonly interfaceConcepts: readonly ConceptBlockView[];
}

export interface DependencyDecisionView {
  readonly componentName: string;
  readonly filePath: string;
  readonly section: Section;
}

export interface AgentDependencyContext {
  readonly selectedComponent: ResolvedComponent;
  readonly collectedExpansion: CollectedExpansion;
  readonly dependencyContracts: readonly ComponentContractView[];
  readonly dependencyDecisions: readonly DependencyDecisionView[];
  readonly relatedFilePaths: readonly string[];
}

export interface AgentDependentContext {
  readonly selectedComponent: ResolvedComponent;
  readonly importingFiles: readonly DependentImportingFileContext[];
  readonly relatedFilePaths: readonly string[];
}

export interface DependentImportingFileContext {
  readonly filePath: string;
  readonly importedComponent: ImportedComponentReference;
  readonly importEdges: readonly ImportedComponentEdge[];
  readonly contextualContracts: readonly ComponentContractView[];
}

export interface ImportedComponentReference {
  readonly name: string;
  readonly filePath: string;
}

export interface ResolvedExpansion {
  readonly filePath: string;
  readonly declaration: ExpandDeclaration;
}

export interface ResolvedComponent {
  readonly name: string;
  readonly declaration: ComponentDeclaration;
  readonly filePath: string;
  readonly expansions: CollectedExpansion;
  readonly conceptNamespace: ResolvedConceptNamespace;
}

export interface ConceptIdentity {
  readonly identifier: string;
  readonly normalizedIdentifier: string;
  readonly componentName: string;
  readonly filePath: string;
}

export interface ResolvedConceptOccurrence {
  readonly componentName: string;
  readonly filePath: string;
  readonly ownerKind: SigilFormKind;
  readonly sectionName: SigilSectionName;
  readonly block: ConceptBlock;
}

export interface ResolvedConcept {
  readonly identity: ConceptIdentity;
  readonly identifier: string;
  readonly isPublic: boolean;
  readonly isImported: boolean;
  readonly occurrences: readonly ResolvedConceptOccurrence[];
}

export interface ResolvedConceptReference {
  readonly conceptIdentity: ConceptIdentity;
  readonly componentName: string;
  readonly filePath: string;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly range: SourceRange;
}

export interface ResolvedConceptNamespace {
  readonly componentName: string;
  readonly concepts: readonly ResolvedConcept[];
  readonly accessibleConcepts: readonly ResolvedConcept[];
  readonly publicConcepts: readonly ResolvedConcept[];
  readonly references: readonly ResolvedConceptReference[];
}

// @sigil implements packages/core/src/model/resolution.sigil::SigilResolutionModel::ResolutionModel interface
export interface SigilResolution {
  readonly workspace: SigilWorkspace;
  readonly imports: readonly ResolvedImport[];
  readonly components: readonly ResolvedComponent[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

// @sigil implements packages/core/src/model/resolution.sigil::SigilResolutionModel::ResolutionModel interface
export interface ResolvedSigilWorkspace {
  readonly workspace: SigilWorkspace;
  readonly imports: readonly ResolvedImport[];
  readonly components: readonly ResolvedComponent[];
  readonly graph: SigilGraph;
  readonly glossary: GlossaryProjection;
  readonly diagnostics: readonly SigilDiagnostic[];
}
