import type { SourceRange } from "@qoherent/sigil-core";

export const MANAGED_VIEW_RENDERER_VERSION = 1 as const;

export interface ManagedViewLocation {
  readonly factIds: readonly string[];
  readonly contractIds: readonly string[];
  readonly range: SourceRange;
}

export interface ManagedViewFile {
  readonly entity: string;
  readonly path: string;
  readonly componentName: string;
  readonly content: string;
  readonly contentHash: string;
  readonly locations: readonly ManagedViewLocation[];
}

export interface ManagedViewSet {
  readonly rendererVersion: typeof MANAGED_VIEW_RENDERER_VERSION;
  readonly worldFingerprint: string;
  readonly files: readonly ManagedViewFile[];
}

export interface ViewInspectionDifference {
  readonly path: string;
  readonly kind: "missing" | "changed" | "unexpected" | "metadata";
}

export interface ViewInspection {
  readonly version: 1;
  readonly state:
    | "not-installed"
    | "current"
    | "stale"
    | "edited"
    | "incomplete"
    | "unsupported-version";
  readonly worldRevision: string | null;
  readonly recordedWorldRevision: string | null;
  readonly transactions: readonly string[];
  readonly differences: readonly ViewInspectionDifference[];
}

export interface ViewReceiptAuthoredLocation {
  readonly path: string;
  readonly componentName: string;
  readonly range: SourceRange;
}

export interface ViewReceiptFile {
  readonly entity: string;
  readonly path: string;
  readonly componentName: string;
  readonly contentHash: string;
  readonly authoredLocations: readonly ViewReceiptAuthoredLocation[];
  readonly locations: readonly ManagedViewLocation[];
}

export interface ViewReceiptV1 {
  readonly version: 1;
  readonly rendererVersion: typeof MANAGED_VIEW_RENDERER_VERSION;
  readonly worldRevision: string;
  readonly worldFingerprint: string;
  readonly files: readonly ViewReceiptFile[];
}
