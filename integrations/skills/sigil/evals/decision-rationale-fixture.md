# Decision rationale fixture

The user and agent select PostgreSQL for payment persistence after considering
SQLite and an external event store. The selected choice governs payment writes
and settlement but not analytics storage. A reporting component imports the
public transaction concept and needs local rationale without taking ownership
of payment transaction policy.

Expected skill behavior:

1. Keep the binding PostgreSQL outcome in `constraints`.
2. Add `decisions` only because the material rationale benefits future review,
   maintenance, and agent sessions.
3. Use one concise PascalCase concept block for the material decision.
4. Record `Decision`, `Context`, and `Scope`.
5. Define Scope as the governed boundary and important exclusions without
   enumerating every current dependent.
6. Record applicable assumptions, trade-offs, design issues addressed,
   discarded alternatives, consequences, and revisit conditions while omitting
   inapplicable labels.
7. Reuse the accessible public transaction concept in the reporting decision
   when both occurrences concern the same semantic idea.
8. Keep the reporting occurrence contextual and do not make either decision
   transitively binding.
9. Inspect the payment provider and its matching expands explicitly when the
   provider's private decision rationale matters; do not infer it from the
   import.
10. Summarize durable rationale rather than prompts, raw session transcripts, or
    hidden reasoning.
11. Do not add responsibility, accountability, approver, or handoff metadata
    under the initial convention.
