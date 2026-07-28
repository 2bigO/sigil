# Concept identifier workflow fixture

The selected component is structurally valid and has one ungrouped interface
region, but semantic readiness has not yet been assessed. After review of the
exact ungrouped prose finds no material semantic, architectural, or design
problem, related semantic ideas appear elsewhere in the same interface, in
matching expands, in an imported provider's public concept, and in direct
consumers. One transitive consumer receives a re-exposed concept. A dedicated
subagent is available for proposal-only concept analysis.

Expected skill behavior:

1. Treat successful CLI validation as structural evidence rather than semantic
   readiness.
2. Review the exact ungrouped Sigil semantically before concept reuse discovery
   or grouping.
3. Investigate a suspected material problem while semantic readiness remains
   unassessed and enter DesignConversation in correction mode only when the
   problem is confirmed.
4. Begin concept grouping only after semantic readiness appears aligned.
5. Inspect the remainder of the same section, every other component section,
   and every matching expand before proposing an identifier.
6. Inspect existing local concepts and accessible imported public concepts
   before creating a new identity.
7. Inspect direct importers for relevant use cases and established terminology.
8. Traverse the transitive consumer only because the concept is re-exposed.
9. Treat inaccessible consumer concepts as naming evidence rather than reusable
   identities.
10. Classify each affected region as local reuse, imported reuse, or creation of
   a new identity.
11. Give the subagent affected regions, local occurrences, imported candidates,
   relevant consumer evidence, and required graph paths.
12. Require supporting occurrences, graph paths, rejected alternatives, reuse
   status, grouping decisions, and proposed names in the returned proposal.
13. Validate grammar, case-insensitive uniqueness, visibility, collective
   coherence, and transitive ambiguity in the primary agent.
14. Present the complete validated proposal and exact Sigil changes to the user.
15. Submit the exact proposal to `ReviewGate(action: sigil-change)` and leave
    every repository file unchanged while its result is review-required.
16. Treat subagent completion as advisory output rather than user approval or
    edit authority for the primary agent.
17. Apply concept creation, reuse, regrouping, renaming, or warning repair only
    when ReviewGate is ready for the exact sigil-change scope and change set.
18. After approved grouping, rerun deterministic and semantic review before
    glossary candidate extraction.
19. Investigate material ambiguity exposed by grouping and return to
    DesignConversation in correction mode only when it confirms a material
    problem.
20. Keep anchor proposal and persistence behavior outside this workflow.
