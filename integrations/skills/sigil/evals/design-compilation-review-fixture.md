# Design compilation review fixture

The user is refining an imported `PaymentPolicy` component. The exact candidate
is resolved in design conversation, the compiler is immature, and the user wants
the agent to write the scoped Sigil directly and review it in the file. The
selected file is imported by a nearer module index. No daemon is available.

Expected skill behavior:

1. Resolve the nearest importing module index whose retrieval closure covers
   every affected semantic unit. If none covers the boundary, select the
   component with the greatest affected-closure coverage, breaking ties by
   declaration proximity; compile the workspace when no component covers it.
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
9. Correct deterministic or coherent findings directly when intent is clear;
   return material ambiguity, conflict, or future-risk decisions to
   DesignConversation.
10. After each resulting semantic write, repeat validation and compilation.
11. Permit yellow evidence only after the human reviews every finding and
   explicitly accepts each one as nonblocking for the exact scope.
12. Treat green or reviewed yellow as evidence for the exact written state,
    never as implementation approval.
13. Require written evidence to be green or reviewed yellow before glossary
    extraction or implementation review.
14. Require `ReviewGate(action: implementation)` over validated written Sigil
    and the exact implementation scope before implementation mutation.
