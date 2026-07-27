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
4. After sufficient framing, assess whether authoritative guidance could
   materially affect the public API, retry, delivery, or platform decisions.
5. Acquire applicable evidence before presenting guidance-sensitive
   alternatives and match official documentation to the confirmed environment.
6. Surface weak assumptions, conflicting goals, and missing failure behavior
   constructively.
7. Present concrete synchronous, queued, and event-driven choices with
   consequences and tradeoffs, plus a reasoned recommendation.
8. Let the user combine, reject, revise, or replace every presented choice.
9. Maintain decision states and continue until no unresolved decision can
   materially change the contract.
10. Establish the smallest coherent component boundaries from agreed intent.
11. Apply semantic-readiness, standards, coherence, and modularity review,
    verifying the currency and applicability of evidence created during
    conversation.
12. Synthesize conversation and review findings into exact proposed Sigil and
    request confirmation.
13. Write only approved Sigil, validate it, and stop at the semantic review
    gate.
14. Treat the missing Sigil coverage as a reason to collaborate with the user on
    the affected Sigil before adding implementation.
15. Implement only after the written Sigil is approved and implementation is
    explicitly requested.
