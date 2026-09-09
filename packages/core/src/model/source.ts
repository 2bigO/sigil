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

/** Fenced payload; the introducing prose belongs to its enclosing Facet. */
export interface EmbeddedContent {
  readonly type?: string;
  readonly body: string;
  readonly sourceLines: readonly string[];
  readonly range: SourceRange;
  readonly bodyRange: SourceRange;
  readonly fenceLength: number;
  readonly indentation: number;
}

/** A native contribution, optionally grouped under a cross-contract Concept. */
export interface Facet {
  readonly filePath: string;
  readonly range: SourceRange;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly conceptIdentifier?: string;
  readonly prose: string;
  readonly sourceLines: readonly string[];
  /** Legacy serialized field name; nonempty content makes this an EmbeddedFacet. */
  readonly literalBlocks: readonly EmbeddedContent[];
}

/** Introducing prose and fenced content together form one Embedded Facet. */
export interface EmbeddedFacet extends Facet {
  readonly literalBlocks: readonly [EmbeddedContent, ...EmbeddedContent[]];
}

export function isEmbeddedFacet(facet: Facet): facet is EmbeddedFacet {
  return facet.literalBlocks.length > 0;
}

export interface ConceptBlock {
  readonly identifier: string;
  readonly range: SourceRange;
  readonly bodyRange: SourceRange;
  readonly units: readonly Facet[];
}

export interface Section {
  readonly name: SigilSectionName;
  readonly range: SourceRange;
  readonly bodyRange: SourceRange;
  /** Facets in source order, including both ungrouped and Concept-grouped ones. */
  readonly units: readonly Facet[];
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
