<!-- @sigil implements integrations/skills/sigil/design-compilation-review.sigil::SigilDesignCompilationReview interface,logic,constraints,cases -->

# Native Design review

Use [native compilation execution](compilation-execution.md) after an authored
change when semantic evidence is needed. Structural `sigil check` validates the
language; `sigilc compile design` derives the Design state from current captured
inputs and independently reconstructed assertions.

Use ordered native scope roots for the affected physical files, and inspect the
reported import/owner closure. Keep dependency additions and conservative widening
visible. Do not reproduce a component-ranking or nearest-module algorithm in the
host. Focused evidence covers only its effective membership.

Read `world.state`, `diagnostics`, source attribution and current identities.
Coherent is green; Loose is yellow with warnings; both exit 0. Disjoint is red
and exits 1. Preserve operational failures and absent reconstruction separately.
Inspect bounded diagnostic omissions before assuming the visible list is complete.

Investigate findings against the exact contract and assertion provenance. Correct
established defects within the user's authorization. Ask about a material decision
only when available evidence cannot resolve it. A Loose finding does not create
an automatic human approval gate. Retain explained uncertainty; never manufacture
facts, rewrite intent or narrow scope just to obtain Coherent.

Refresh affected reconstruction after edits. Catalog availability comes from
`sigilc entities`; it may be provisional for Loose Design. Neither an available
catalog nor a completed Design gate establishes implementation delivery, test
success, faithful reconstruction or permission for unrelated product actions.
