<!-- @sigil implements integrations/skills/sigil/design-compilation-review.sigil::SigilDesignCompilationReview::DesignCompilationReview interface,state,logic,constraints,cases -->

# Compiler-Driven Design Review

Use this procedure after design intent and applicable external guidance are
sufficiently resolved. It consumes compiler-owned semantic-readiness and
architecture-design evaluation as provisional evidence. It never approves a
Sigil mutation or implementation.

## Select The Scope

Select the nearest configured workspace that imports the affected Sigil file.
Use `sigil retrieve --purpose architecture` as the preferred source for imports,
expands, and consumers. Correct retrieval diagnostics before proceeding. Use
`sigil graph` or `sigil context` only for a required relationship or detail
absent from a successful retrieval.

Select one compile target in this order:

1. the nearest importing `_module.sigil` whose retrieval closure contains all
   affected files and semantic units; select it with `--file <module-index>`;
2. if no such module index exists, the exact-case component whose retrieval
   closure covers the greatest number of affected changed units, matching
   expands, and direct imports or consumers;
3. if no component covers the affected boundary, compile the selected workspace
   without `--component` rather than choosing an arbitrary partial target.

Break a coverage tie by choosing the target nearest to the edited declaration.
Record the target and any affected units outside its closure; do not claim a
partial target evaluates an uncovered unit.

## Compile-And-Resolve Loop

Write the scoped change directly to the target workspace. The target file is
the review artifact; do not reproduce complete proposed source in chat and do
not start a compiler session for ordinary authoring or review. Run this loop
after every semantic write:

```bash
sigil check <workspace-root> --format json --pretty
sigil compile <workspace-root> --focus design <target-selector>
```

Compiler sessions remain available only for an explicitly requested exceptional
diagnostic investigation. They are not a required pre-write proposal workflow.

Design compilation can take substantial time. Wait without cancelling it for its terminal outcome:
the JSONL event protocol emits `completed` with the authoritative version-2
CompilationReport, or emits `failed` or `cancelled` without a report. A stream
consumer also waits for source end after that terminal event.

Before starting the compile, reserve and record a durable, task-scoped output
path. Redirect both compiler stdout and stderr to it while preserving the
command exit status. The path must remain readable if the command tool returns
before a child evaluator exits; it is the source of record, not merely a copy of
the live terminal display. For a shell host, use a fresh directory from
`mktemp -d`, keep its path in the working record, and capture the command in a
named log inside it.

Stage-started events, partial progress, silence while an evaluator runs, or a
slow response are not results. Keep the agent working session open while the
compiler runs and report that it is waiting when progress is slow. Do not start
a replacement compile for the same scope, abandon the run, or make a design
decision from partial output. Treat a missing terminal outcome as a host or
transport problem, not as red, yellow, or green evidence. If the execution host
interrupts the live stream, retrieve the durable capture and continue waiting
from it. Poll appended log output and, if needed, the evaluator process state
until the log contains the terminal event and its writer has closed. Preserve
the final report or terminal diagnostics from that log in review evidence. Do
not retry solely because the live terminal event was lost. If the log cannot be
read or cannot establish source end, report a host or transport failure and retry
the same target only after durable capture is restored.

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
