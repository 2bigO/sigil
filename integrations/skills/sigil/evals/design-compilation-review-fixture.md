# Design compilation review fixture

The user is refining an imported `PaymentPolicy` component. The exact candidate
is resolved in design conversation, the compiler is immature, and the user wants
the agent to write the scoped Sigil directly and review it in the file. The
selected file is imported by a nearer module index. No daemon is available.

Expected skill behavior:

1. Derive a directory from every affected semantic unit's source-file parent,
   including expand-only or declarationless files. Resolve the importing module
   index whose closure covers every affected unit by the lexically smallest
   greatest-to-least vector of normalized relative-path segment counts. Break exact
   vector ties by normalized repository-relative path. If none covers the boundary,
   select the component with the greatest affected-closure coverage, then the same
   vector across its declarations and matching expands, then normalized source path
   and exact-case component name; compile the workspace when no component covers it.
2. Use `sigil retrieve --purpose architecture` to establish that coverage and
   include imports, expands, and dependents; use graph or context only for
   detail absent from successful retrieval.
3. Write the resolved scoped change directly in the selected file.
4. Run deterministic validation and `sigil compile --focus design`; do not use
   an ephemeral compilation session for the normal workflow.
5. Before compiling, record a durable task-scoped stdout/stderr capture path
   that remains readable when a child evaluator outlives the command-tool event.
6. Wait without cancelling or replacing the run for a terminal compiler event
   and for the event stream to end. Treat
   only `completed` carrying its v2 report, `failed`, or `cancelled` as an
   outcome; progress events and silence are not results.
7. If the command tool returns only partial progress while its evaluator is
   still active, retrieve and poll the durable capture until its writer closes;
   preserve its final report or terminal diagnostics. Do not issue a replacement
   compile merely because the original terminal event is absent.
8. Treat an unreadable capture or one that cannot establish source end as a host
   or transport failure, not green, yellow, or red evidence. Retry the same
   target only after durable output capture is restored.
9. Treat `failed` and `cancelled` terminal events as blocked states. Preserve their
   evidence and exit status; retry a failed run only after its host or evaluator
   cause is resolved, and retry a cancelled run only after its cause is resolved
   or the user explicitly requests it.
10. Correct deterministic or coherent findings directly when intent is clear;
   return material ambiguity, conflict, or future-risk decisions to
   DesignConversation.
11. After each resulting semantic write, repeat validation and compilation.
12. Permit yellow evidence only after the human reviews every finding and
   explicitly accepts each one as nonblocking for the exact scope.
13. Treat green or reviewed yellow as evidence for the exact written state,
    never as implementation approval.
14. Require written evidence to be green or reviewed yellow before glossary
    extraction or implementation review.
15. Require `ReviewGate(action: implementation)` over validated written Sigil
    and the exact implementation scope before implementation mutation.
