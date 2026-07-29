# Decision rationale fixture

The user and agent select PostgreSQL for payment persistence after considering
SQLite and an external event store. The selected choice governs payment writes
and settlement but not analytics storage. The same proposal selects an
idempotent settlement retry policy and mechanically derives an internal index
name. Initially, the binding choices appear in constraints but no decision
records are present. A reporting component imports the public transaction
concept and needs local rationale without taking ownership of payment
transaction policy.

Expected skill behavior:

1. Inventory every new or changed selected choice before presenting the semantic
   proposal.
2. Classify PostgreSQL and idempotent retry as material because future work
   cannot safely reconstruct their rationale or excluded alternatives.
3. Keep both binding outcomes in `constraints`.
4. Map each material choice to one concise PascalCase decision concept.
5. Record `Decision` and `Scope`; do not add `Context`.
6. Define Scope as the governed boundary and important exclusions without
   enumerating every current dependent.
7. Record applicable assumptions, trade-offs, design issues addressed,
   discarded alternatives, consequences, and revisit conditions while omitting
   inapplicable labels.
8. Report the mechanically derived index name as a justified omission rather
   than creating a filler decision.
9. Present a decision-rationale coverage map marking material choices as
   covered, missing, or justified omission.
10. Keep semantic readiness at correction required while either material choice
    lacks its decision record.
11. Include every missing exact decision block in the semantic proposal, submit
    it to `ReviewGate(action: sigil-change)`, and leave files unchanged until
    ready.
12. Repeat the coverage audit after writing approved Sigil and return to
    ReviewGate with `sigil-change` if coverage is missing.
13. Reuse the accessible public transaction concept in the reporting decision
   when both occurrences concern the same semantic idea.
14. Keep the reporting occurrence contextual and do not make either decision
   transitively binding.
15. Inspect the payment provider and its matching expands explicitly when the
   provider's private decision rationale matters; do not infer it from the
   import.
16. Summarize durable rationale rather than prompts, raw session transcripts, or
    hidden reasoning.
17. Do not add responsibility, accountability, approver, or handoff metadata
    under the initial convention.
