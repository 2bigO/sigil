# Design conversation fixture

The user asks a coding agent to help shape a partially formed application idea.
Their description mixes product outcomes, implementation preferences, and
conflicting retention expectations. Several ownership, permission, lifecycle,
failure, and verification decisions are missing. During the conversation the
user is unsure about one architecture choice, intentionally defers a
non-blocking branding decision, and says that a long list of questions feels
overwhelming.

Related Sigil contains an existing coherent delivery contract and two possibly
overlapping state-ownership claims. Review must inspect matching expands,
imports, importers, boundary summaries, and repository evidence before deciding
whether the ownership concern is real. The evidence confirms one ownership
conflict, while current platform guidance reveals an optional material
improvement to the otherwise coherent delivery contract. One decision depends
on version-sensitive behavior, and authoritative sources disagree about an
operational recommendation.

Expected skill behavior:

1. Enter DesignConversation because the user explicitly requested design work.
2. Build DesignContext from the selected component, matching expands, imports,
   importers, relevant summaries, repository evidence, and reviewed findings.
3. Start in framing and identify the intended outcome, users or callers, and
   boundary before selecting implementation technology.
4. Maintain confirmed, provisionally assumed, intentionally deferred, and
   unresolved decisions in conversation context.
5. Classify unresolved decisions by their effect on purpose, boundary,
   ownership, behavior, lifecycle, architecture, risk, and verification.
6. Ask the unresolved question whose answer most strongly shapes later
   decisions.
7. Present one primary decision per turn unless the user requests grouped
   review.
8. Acknowledge each answer and state its effect on the emerging contract.
9. Explain why the next decision matters and what later choices depend on it.
10. Offer concrete alternatives, consequences, and a reasoned recommendation
    while allowing the user to replace every choice.
11. Complete purpose, users, boundary, external-surface, and risk framing before
    assessing external-guidance applicability.
12. Acquire required evidence for the version-sensitive decision using
    documentation that matches the confirmed environment.
13. Acquire recommended evidence when it could reveal a material improvement to
    the coherent written delivery contract.
14. Show relevant source identity with evidence-informed recommendations while
    preserving user decision authority.
15. Treat disagreement between authoritative sources as unresolved design
    evidence when no confirmed project decision exists.
16. Enter improvement mode for the compatible delivery improvement and keep it
    optional unless it affects a binding requirement.
17. Reopen a confirmed decision when evidence materially conflicts with it or
    indicates a material improvement opportunity.
18. When the user is unsure, state a conservative recommendation rather than
    silently choosing a default.
19. Allow only non-blocking uncertainty to be provisionally assumed or
    intentionally deferred with the user's knowledge.
20. Investigate the suspected ownership finding without automatically entering
    correction or blocking unrelated work.
21. Separate exact Sigil, repository evidence, guidance, and inference before
    confirming the ownership problem.
22. Enter correction mode only after evidence confirms the material ownership
    conflict.
23. Point to the exact conflicting ideas, explain lifecycle and consistency
    risk, offer concrete corrections, and ask one focused decision.
24. Do not label a subjective preference as a mistake or silently rewrite
    affected Sigil.
25. Keep the confirmed material problem blocking until it is resolved.
26. When the user feels overwhelmed, reduce the turn to the single most
    foundational decision and defer non-blocking topics.
27. Give compact checkpoints containing mode, confirmed decisions, assumptions,
    deferrals, blockers, evidence limitations, and the next decision.
28. Recheck affected related-Sigil coherence after material decisions and
    before synthesis.
29. Synthesize exact proposed Sigil only after no blocking decision or confirmed
    material problem remains.
30. Keep intentionally deferred decisions and material evidence limitations
    visible in synthesis.
31. Treat resolved correction and accepted improvements as evidence for
    `ReviewGate(action: sigil-change)` rather than edit authority.
