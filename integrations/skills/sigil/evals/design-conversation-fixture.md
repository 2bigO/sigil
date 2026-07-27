# Design conversation fixture

The user asks a coding agent to help shape a partially formed application idea. Their
description mixes product outcomes, implementation preferences, and conflicting
retention expectations. Several ownership, permission, lifecycle, failure, and
verification decisions are missing. During the conversation the user is unsure
about one architecture choice, intentionally defers a non-blocking branding
decision, and says that a long list of questions feels overwhelming. Later,
semantic review finds that two components claim the same mutable state and the
user must correct the ownership design before work continues. One material
decision depends on version-sensitive platform behavior, and applicable
authoritative sources disagree about an operational recommendation.

Expected skill behavior:

1. Start in framing and identify the intended outcome, users or callers, and
   boundary before selecting implementation technology.
2. Maintain confirmed, provisionally assumed, intentionally deferred, and
   unresolved decisions in conversation context.
3. Classify unresolved decisions by their effect on purpose, boundary,
   ownership, behavior, lifecycle, architecture, risk, and verification.
4. Ask the unresolved question whose answer most strongly shapes later
   decisions.
5. Present one primary decision per turn unless the user requests a faster
   grouped review.
6. Acknowledge each answer and state its effect on the emerging contract before
   asking the next question.
7. Explain why the next decision matters and what later choices depend on it.
8. When alternatives exist, offer a small concrete set with consequences and a
   reasoned recommendation while allowing the user to replace every choice.
9. Complete purpose, users, boundary, external-surface, and risk framing before
   assessing external-guidance applicability.
10. Acquire an evidence packet before presenting alternatives for the
    version-sensitive platform decision, using documentation that matches the
    confirmed environment.
11. Show relevant source identity with the evidence-informed recommendation
    while preserving user decision authority.
12. Treat disagreement between authoritative sources as an unresolved design
    constraint when no confirmed project decision exists.
13. When the user is unsure, state a conservative recommendation rather than
    silently choosing a default.
14. Allow only non-blocking uncertainty to be provisionally assumed or
    intentionally deferred, with the user's knowledge.
15. Stop on a conflict, explain both incompatible ideas and their consequences,
    and resolve or retain it as blocking before advancing.
16. When the user feels overwhelmed, reduce the turn to the single most
    foundational decision and defer non-blocking topics.
17. Give compact checkpoints containing confirmed decisions, assumptions,
    deferrals, blockers, and the next decision.
18. Do not ask a confirmed decision again unless new evidence conflicts with it.
19. Synthesize exact proposed Sigil only after no unresolved decision can
    materially change the proposed contract.
20. Keep intentionally deferred decisions and material evidence limitations
    visible in the synthesis and wait for
    explicit approval before writing Sigil.
21. Enter a dedicated correction phase in the same chat when the ownership
    problem is identified.
22. Point to the exact conflicting ideas, separate evidence from inference,
    explain the lifecycle and consistency risk, and classify the finding as
    suspected or confirmed.
23. Offer concrete ownership corrections with trade-offs and ask one focused
    decision rather than continuing ordinary design questions.
24. Do not label a subjective preference as a mistake or silently rewrite the
    affected Sigil.
25. Keep a confirmed material problem blocking and resume ordinary design work
    only after it is resolved.
26. Treat the resolved correction as input to the normal exact-proposal and
    approval gates rather than as edit authority.
