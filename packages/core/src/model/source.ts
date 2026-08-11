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
  SourceRange,
} from "./language.ts";

export interface LiteralBlock {
  readonly type?: string;
  readonly body: string;
  readonly sourceLines: readonly string[];
  readonly range: SourceRange;
  readonly bodyRange: SourceRange;
  readonly fenceLength: number;
  readonly indentation: number;
}

export interface SemanticUnit {
  readonly filePath: string;
  readonly range: SourceRange;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly conceptIdentifier?: string;
  readonly prose: string;
  readonly sourceLines: readonly string[];
  readonly literalBlocks: readonly LiteralBlock[];
}

export interface ConceptBlock {
  readonly identifier: string;
  readonly range: SourceRange;
  readonly bodyRange: SourceRange;
  readonly units: readonly SemanticUnit[];
}

export interface Section {
  readonly name: SigilSectionName;
  readonly range: SourceRange;
  readonly bodyRange: SourceRange;
  readonly units: readonly SemanticUnit[];
  readonly concepts: readonly ConceptBlock[];
}

export interface ImportDeclaration {
  readonly path: string;
  readonly names: readonly string[];
  readonly nameRanges: readonly SourceRange[];
  readonly range: SourceRange;
}

export interface ComponentDeclaration {
  readonly kind: "component";
  readonly name: string;
  readonly range: SourceRange;
  readonly sections: readonly Section[];
}

export interface ExpandDeclaration {
  readonly kind: "expand";
  readonly name: string;
  readonly range: SourceRange;
  readonly sections: readonly Section[];
}

// @sigil implements packages/core/src/model/source.sigil::SigilSourceModel::SourceModel interface
export interface SigilDocument {
  readonly filePath: string;
  readonly imports: readonly ImportDeclaration[];
  readonly components: readonly ComponentDeclaration[];
  readonly expands: readonly ExpandDeclaration[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface ParseResult {
  readonly document: SigilDocument;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface FormatResult {
  readonly formattedSource?: string;
  readonly changed: boolean;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface ParseOptions {
  readonly sigilVersion: string;
}
