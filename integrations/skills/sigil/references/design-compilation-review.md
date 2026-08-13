<!-- @sigil implements integrations/skills/sigil/design-compilation-review.sigil::SigilDesignCompilationReview::DesignCompilationReview interface,state,logic,constraints,cases -->

# Compiler-Driven Design Review

Use this procedure after design intent and applicable external guidance are
sufficiently resolved. It consumes compiler-owned semantic-readiness and
architecture-design evaluation as provisional evidence. It never approves a
Sigil mutation or implementation.

## Select The Scope

Select the nearest configured workspace that imports the affected Sigil file.
Use `sigil retrieve --purpose architecture` as the preferred source for imports,
expands, and consumers. Prefer an exact-case component target; use a file target
when colocated declarations or expands are the scope. Correct retrieval
diagnostics before proceeding. Use `sigil graph` or `sigil context` only for a
required relationship or detail absent from a successful retrieval.

## Compile-And-Resolve Loop

Write the scoped change directly to the target workspace. The target file is
the review artifact; do not reproduce complete proposed source in chat and do
not start a compiler session for ordinary authoring or review. Run this loop
after every semantic write:

```bash
sigil check <workspace-root> --format json --pretty
sigil compile <workspace-root> --focus design --component <name>
```

Compiler sessions remain available only for an explicitly requested exceptional
diagnostic investigation. They are not a required pre-write proposal workflow.

Design compilation can take substantial time. Wait for its terminal outcome:
the JSONL event protocol emits `completed` with the authoritative version-2
CompilationReport, or emits `failed` or `cancelled` without a report. A stream
consumer also waits for source end after that terminal event. Stage-started
events, partial progress, silence while an evaluator runs, or a slow response
are not results. Keep the agent working session open while the compiler runs
and report that it is waiting when progress is slow. Treat a missing terminal
outcome as a host or transport problem, not as red, yellow, or green evidence.

1. Fix a deterministic, structural, or coherence issue directly when the report
   and established intent determine one safe correction.
2. Enter `references/design-conversation.md` when a finding exposes an
   unresolved material decision, conflicting intent, or future-facing pitfall.
3. Write the resulting scoped correction and compile again.

Repeat until the report is green or every yellow finding is explicitly reviewed
and accepted as nonblocking. Do not synthesize follow-on Sigil, extract glossary
candidates, or begin implementation from red, unresolved-yellow, unavailable,
or incomplete design evidence. If progress requires user judgment, keep the
affected scope in DesignConversation rather than guessing.

## Interpret The Final Report

- Red is not reviewable for implementation.
- Yellow requires explicit human acceptance of every finding as nonblocking for
  the exact scope.
- Green is evidence for user review and implementation approval, not approval.

Do not duplicate the compiler's semantic-readiness or architecture-design
judgment in a second host-generated status. The host still owns external-
guidance applicability, finding disposition, design decisions, concept grouping,
glossary extraction, and ReviewGate.

Evidence for written-file review identifies the selected workspace root, changed
paths, semantic units, target, profile, focus, report status, and every yellow
disposition. Submit this evidence with the validated written Sigil to
`ReviewGate(action: implementation)` only when implementation is requested.

Written evidence must be green or explicitly reviewed yellow before concept
grouping, glossary extraction, or implementation review. Any semantic edit or
grouping change restarts the compile-and-resolve loop.

An unavailable, incomplete, or red compiler result blocks implementation
review. An unresolved yellow finding also blocks it. Report target ambiguity or
other compilation failure explicitly; never bypass it with an untracked source
copy.
