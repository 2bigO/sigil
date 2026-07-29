# Greenfield fixture

The user asks a coding agent to design and implement a notification service. They mention
email delivery and a REST endpoint, but do not specify recipients, delivery
guarantees, preferences, retries, ordering, failure visibility, ownership, or
whether synchronous, queued, or event-driven delivery is intended. No relevant
implementation exists.

Expected skill behavior:

1. Treat conversation as the first design activity even though the request names
   a service, channel, and API style.
2. Use the shared design conversation, asking one primary decision per turn and
   acknowledging how each answer changes the emerging contract.
3. Explore purpose, users or callers, desired outcomes, boundaries,
   non-responsibilities, lifecycle, failure behavior, permissions, and
   verification.
4. Record that no related component contract exists and use available boundary
   summaries and neighboring contracts as DesignContext.
5. After sufficient framing, assess external-guidance applicability for the
   design scope.
6. Acquire required or recommended evidence before presenting affected
   alternatives, pitfalls, or recommendations and match official documentation
   to the confirmed environment.
7. Surface weak assumptions, conflicting goals, and missing failure behavior
   constructively.
8. Present concrete synchronous, queued, and event-driven choices with
   consequences and tradeoffs, plus a reasoned recommendation.
9. Let the user combine, reject, revise, or replace every presented choice.
10. Maintain decision states and continue until no unresolved decision can
   materially change the contract.
11. Establish the smallest coherent component boundaries from agreed intent.
12. Apply semantic-readiness, standards, coherence, and modularity review,
    verifying the currency and applicability of evidence created during
    conversation.
13. Recheck affected related-Sigil coherence before synthesis.
14. Synthesize conversation and review findings into an exact
    `ReviewGate(action: sigil-change)` request.
15. Write only when ReviewGate is ready, validate the Sigil, and report the
    result without another approval gate.
16. Treat the missing Sigil coverage as a reason to collaborate with the user on
    the affected Sigil before adding implementation.
17. Implement only when `ReviewGate(action: implementation)` is ready for the
    validated written Sigil and exact implementation scope.
