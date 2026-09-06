import type { ImplementationEvidence } from "./evidence.ts";
import type { ImplementationHandoff } from "./handoff.ts";
import type { ReceiptSubmission } from "./receipts.ts";
import { SemanticInputError } from "./turtle.ts";
import type { TypeScriptSymbol } from "./typescript7.ts";

export interface ReceiptLocationResult {
  readonly receipt: string;
  readonly location: number;
  readonly status:
    | "located"
    | "missing-file"
    | "stale-file"
    | "unbound-owner"
    | "unresolved-symbol"
    | "stale-range";
  readonly symbol?: TypeScriptSymbol;
  /** Matched existing Sigil anchors are documentary provenance, not authority. */
  readonly anchors?: ImplementationEvidence["anchors"];
}

/** Resolve pointers independently; the egglog witness rule still decides support. */
// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationHandoff::ReceiptSubmission interface
export function resolveReceiptLocations(
  handoff: ImplementationHandoff,
  submission: ReceiptSubmission,
  evidence: ImplementationEvidence,
): readonly ReceiptLocationResult[] {
  if (submission.handoff !== handoff.id) {
    throw new SemanticInputError(
      "INVALID_RECEIPTS",
      "Receipt assignment differs from the retained handoff.",
    );
  }
  const results: ReceiptLocationResult[] = [];
  for (const claim of submission.claims) {
    for (const [index, location] of claim.locations.entries()) {
      const base = { receipt: claim.id, location: index };
      const file = evidence.analysis.files.find((file) =>
        file.file === location.file
      );
      if (!file) {
        results.push({ ...base, status: "missing-file" });
        continue;
      }
      if (file.fingerprint !== location.fingerprint) {
        results.push({ ...base, status: "stale-file" });
        continue;
      }
      const owner = handoff.manifest.policy.components.find((c) =>
        c.entity === claim.subject
      );
      if (!owner?.files.includes(location.file)) {
        results.push({ ...base, status: "unbound-owner" });
        continue;
      }
      const matches = evidence.analysis.symbols.filter((symbol) =>
        symbol.file === location.file && symbol.selector === location.symbol
      );
      if (matches.length !== 1) {
        results.push({ ...base, status: "unresolved-symbol" });
        continue;
      }
      const symbol = matches[0];
      if (
        location.start !== undefined &&
        (location.start !== symbol.start || location.end !== symbol.end)
      ) {
        results.push({ ...base, status: "stale-range" });
        continue;
      }
      results.push({
        ...base,
        status: "located",
        symbol,
        anchors: evidence.anchors.filter((anchor) =>
          anchor.component === claim.subject &&
          anchor.target.filePath === symbol.file &&
          anchor.target.symbolIdentity === symbol.name &&
          anchor.target.location?.line === symbol.line
        ),
      });
    }
  }
  return results;
}
