import type { SemanticEngineOptions } from "./engine.ts";
import type { ImplementationEvidence } from "./evidence.ts";
import type { ImplementationHandoff } from "./handoff.ts";
import {
  type ReceiptLocationResult,
  resolveReceiptLocations,
} from "./receipt-locations.ts";
import type { ReceiptSubmission } from "./receipts.ts";

export interface ReceiptWitnessInputs {
  readonly mechanical: SemanticEngineOptions;
  readonly locations: readonly ReceiptLocationResult[];
}

/** Host joins source identities; only fixed egglog rules decide receipt support. */
// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationHandoff::ReceiptVerification interface
export function receiptWitnessInputs(
  handoff: ImplementationHandoff,
  submission: ReceiptSubmission,
  evidence: ImplementationEvidence,
): ReceiptWitnessInputs {
  const locations = resolveReceiptLocations(handoff, submission, evidence);
  const receiptClaims = submission.claims.flatMap((claim) =>
    claim.obligations.map((id) => {
      const obligation = handoff.manifest.obligations.find((o) => o.id === id)!;
      return {
        receipt: claim.id,
        obligation: obligation.kernelId,
        subject: claim.subject,
        predicate: claim.relation,
        object: claim.target,
        expected: claim.expected,
      };
    })
  );
  const symbolOwners: [string, string][] = [];
  for (const symbol of evidence.analysis.symbols) {
    for (const owner of handoff.manifest.policy.components) {
      if (owner.files.includes(symbol.file)) {
        symbolOwners.push([symbol.id, owner.entity]);
      }
    }
  }
  const scopedObservations: [string, string, string, string][] = [];
  for (const observation of evidence.observations) {
    const receipt = evidence.receipts[observation.evidence];
    const location = receipt?.locations[0];
    if (!location) continue;
    const candidates = receipt.kind === "call"
      ? evidence.analysis.calls
      : receipt.kind === "dependency"
      ? evidence.analysis.dependencies
      : [];
    const observed = candidates.find((candidate) =>
      candidate.file === location.file && candidate.start === location.start &&
      candidate.end === location.end
    );
    if (observed) {
      scopedObservations.push([
        observed.caller,
        observation.predicate,
        observation.object,
        observation.evidence,
      ]);
    }
  }
  return {
    locations,
    mechanical: {
      receiptClaims,
      receiptLocations: locations.flatMap((location) =>
        location.status === "located"
          ? [[location.receipt, location.symbol!.id] as const]
          : []
      ),
      symbolOwners,
      scopedObservations,
    },
  };
}
