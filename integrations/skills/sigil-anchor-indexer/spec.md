# Historical Anchor Proposal Workflow

**Status:** Historical and inactive **Owner:** Sigil maintainers **Last
updated:** 2026-07-22

This document records an earlier model-assisted anchor-host proposal for
ADR-011. It has no active skill or Sigil contract.

The proposed skill would have used deterministic `sigil anchors candidates`
output, delegated only bounded component-local batches, required structured
proposal outcomes, validated targets, and stopped for explicit approval before
applying any anchor.

Subagents would have been proposal workers. They would not have modified Sigil,
source code, proposal artifacts, or `.sigil/anchors.json`. The primary agent
would have reconciled overlapping results and owned the user review gate.

The proposal schema remains host-neutral so another agent host can produce the
same input for deterministic validation and persistence.

No implementation is currently approved.
