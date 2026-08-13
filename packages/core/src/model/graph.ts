import type { SourceRange } from "./language.ts";
import type { ComponentIdentity } from "./ownership.ts";
export type { SourceRange } from "./language.ts";
export type { ComponentIdentity } from "./ownership.ts";
export type { ResolvedImportName, SigilResolution } from "./resolution.ts";

// @sigil implements packages/core/src/model/graph.sigil::SigilGraphModel::GraphModel interface
export interface SigilGraph {
  readonly componentNodes: readonly ComponentNode[];
  readonly fileEdges: readonly FileDependencyEdge[];
  readonly importedComponentEdges: readonly ImportedComponentEdge[];
  readonly componentExpansionEdges: readonly ComponentExpansionEdge[];
}

export interface ComponentNode {
  readonly name: string;
  readonly filePath: string;
}

export interface ImportedComponentEdge {
  readonly sourceFile: string;
  readonly targetFile: string;
  readonly componentName: string;
  readonly importPath: string;
  readonly sourceComponents: readonly ComponentIdentity[];
  readonly originRange: SourceRange;
}

export interface FileDependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly importPath: string;
}

export interface ComponentExpansionEdge {
  readonly componentName: string;
  readonly componentFile: string;
  readonly expandFile: string;
}
