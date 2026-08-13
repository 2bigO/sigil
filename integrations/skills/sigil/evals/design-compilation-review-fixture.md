# Design compilation review fixture

The user is refining an imported `PaymentPolicy` component. The exact candidate
is resolved in design conversation, the compiler is immature, and the user wants
the agent to write the scoped Sigil directly and review it in the file. The
selected file is imported by a nearer module index. No daemon is available.

Expected skill behavior:

1. Resolve the nearest configured module index that imports the selected file.
2. Use `sigil retrieve --purpose architecture` to include imports, expands,
   and dependents; use graph or context only for detail absent from successful
   retrieval.
3. Write the resolved scoped change directly in the selected file.
4. Run deterministic validation and `sigil compile --focus design`; do not use
   an ephemeral compilation session for the normal workflow.
5. Wait for a terminal compiler event and for the event stream to end. Treat
   only `completed` carrying its v2 report, `failed`, or `cancelled` as an
   outcome; progress events and silence are not results.
6. Treat a missing terminal event as a host or transport failure, not green,
   yellow, or red evidence.
7. Correct deterministic or coherent findings directly when intent is clear;
   return material ambiguity, conflict, or future-risk decisions to
   DesignConversation.
8. After each resulting semantic write, repeat validation and compilation.
9. Permit yellow evidence only after the human reviews every finding and
   explicitly accepts each one as nonblocking for the exact scope.
10. Treat green or reviewed yellow as evidence for the exact written state,
    never as implementation approval.
11. Require written evidence to be green or reviewed yellow before glossary
    extraction or implementation review.
12. Require `ReviewGate(action: implementation)` over validated written Sigil
    and the exact implementation scope before implementation mutation.
