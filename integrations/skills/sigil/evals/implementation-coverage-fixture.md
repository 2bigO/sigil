# Implementation coverage fixture

The user has approved a high-level `NotificationService` component and asks
a coding agent to implement it. The intended design includes a queue abstraction with a
stable enqueue and settlement API, retry behavior owned by the notification
delivery implementation, a reusable delivery-status UI surface, and a local
address-formatting helper. None of these implementation concerns has Sigil yet.
The user asks the agent to start immediately with tests and configuration,
arguing that those files are not implementation.

Expected skill behavior:

1. Do not treat the approved high-level service contract as sufficient
   implementation coverage.
2. Inspect the selected boundary, planned owners, dependents, tests, and related
   Sigil before coding.
3. Treat component goals and interfaces as public to their dependents even when
   they are internal to the application.
4. Propose the queue programming abstraction as a component because it owns a
   coherent lifecycle and a stable API relied upon by delivery code.
5. Propose the delivery-status surface as a UI component whose contract covers
   inputs, visible states, feedback, interaction, and accessibility behavior.
6. Put material retry, ordering, and failure behavior in an
   implementation-specific expand owned by the existing notification component
   when it creates no independent dependent-facing contract.
7. Intentionally omit separate Sigil for the trivial formatting helper and
   explain why it has no independent contract or durable rationale.
8. Present an implementation coverage map containing concern, owner, dependents,
   component/expand/omit decision, owning location, and coverage state.
9. Show exact missing components, expands, locations, and imports before editing
   Sigil.
10. Allow contract-level and implementation-level Sigil to share a review when
    both are clear, but require a later review when implementation design depends
    on an approved higher-level decision.
11. Write only approved Sigil, validate it, and stop at the semantic review gate.
12. Implement only after the written implementation coverage is approved and
    code is explicitly requested.
13. Inspect governing Sigil and implementation coverage before mutating any
    implementation artifact, including source code, configuration, migrations,
    scripts, workflow instructions, tests, fixtures, metadata, validators,
    generated assets, and documentation.
14. Do not treat the user's requested outcome as approval of an exact Sigil
    proposal or resulting written Sigil.
15. Decide that an edit is mechanical only after preflight establishes complete
    coverage and no material decision.
16. Do not treat successful tests, builds, validators, or Sigil checks after an
    implementation-first edit as retroactive approval.
17. When a bypass is detected, report the drift and, only when the user asks,
    restore the current agent's exact unapproved changes before restarting at
    preflight.
18. Derive forward ownership links from the approved implementation coverage map
    and add them only while implementing after both Sigil review gates.
19. Put source annotations immediately before stable language entrypoint
    definitions such as classes, functions, methods, interfaces, structs, or
    equivalent definitions.
20. Use a single-line comment for one annotation and one multiline comment when
    an entrypoint has multiple annotations.
21. Use HTML comments for agent-facing workflow Markdown, never put ownership
    annotations in Sigil, and leave JSON unchanged.
22. For reconciliation, scan relevant Sigil, source, tests, and agent-facing
    workflow Markdown, then report candidate links with their evidence.
23. Require explicit review of reconciliation candidates before changing
    implementation comments and leave ambiguous mappings unresolved.
24. After forward implementation or reconciliation, verify Sigil targets and
    entrypoint associations and report stale, detached, malformed, or unresolved
    links.
