import type {
  SigilDiagnostic,
  SigilDiagnosticCode,
} from "./model/diagnostics.ts";
import type { SourceRange } from "./model/language.ts";

// @sigil implements packages/core/src/diagnostics.sigil::SigilDiagnostics::DiagnosticConstruction interface,constraints,cases
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
