import type {
  SigilDiagnostic,
  SigilDiagnosticCode,
  SourceRange,
} from "./model.ts";

// @sigil implements packages/core/src/diagnostics.sigil::SigilDiagnostics::DiagnosticConstruction
export function diagnostic(
  code: SigilDiagnosticCode,
  message: string,
  options: {
    readonly severity?: SigilDiagnostic["severity"];
    readonly filePath?: string;
    readonly range?: SourceRange;
  } = {},
): SigilDiagnostic {
  return {
    code,
    severity: options.severity ?? "error",
    message,
    filePath: options.filePath,
    range: options.range,
  };
}
