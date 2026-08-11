import type { SigilDiagnostic } from "./diagnostics.ts";
export type { SigilDiagnostic } from "./diagnostics.ts";

export interface SigilWorkspaceConfig {
  readonly name: string;
  readonly members: readonly string[];
}

export interface SigilFileDiscoveryConfig {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

export interface SigilConfig {
  readonly sigilVersion: string;
  readonly workspace: SigilWorkspaceConfig;
  readonly files: SigilFileDiscoveryConfig;
  readonly tools: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface SigilConfigParseResult {
  readonly config?: SigilConfig;
  readonly diagnostics: readonly SigilDiagnostic[];
}
