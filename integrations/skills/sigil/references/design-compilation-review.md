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

1. derive one affected directory from every affected semantic unit's source-file
   parent, including expand-only or declarationless files; for each candidate,
   count normalized relative-path segments from every affected directory to its
   directory, sort counts greatest to least, and choose the lexically smallest
   vector; select the eligible importing `_module.sigil` with the best vector,
   resolving equal vectors by normalized repository-relative module-index path,
   then select it with `--file <module-index>`;
2. if no such module index exists, the exact-case component whose retrieval
   closure covers the greatest number of affected changed units, matching
   expands, and direct imports or consumers; resolve equal coverage with the same
   distance vector against every candidate declaration and matching expand directory,
   then by normalized repository-relative source path and exact-case component name;
3. if no component covers the affected boundary, compile the selected workspace
   without `--component` rather than choosing an arbitrary partial target.

Break a coverage tie by choosing the target nearest to the edited declaration.
Record the target and any affected units outside its closure; do not claim a
partial target evaluates an uncovered unit.

## Compile-And-Resolve Loop

Accept the exact scoped change already written to the target workspace. The target
file is the review artifact; do not reproduce complete proposed source in chat and do
not start a compiler session for ordinary authoring or review. Run this loop
after every semantic write:

```bash
sigil check <workspace-root> --format json --pretty
sigil compile <workspace-root> --agent --focus design <target-selector> --format markdown --output <fresh-report-path>
```

Follow `references/compilation-execution.md` with `focus: design`. Its fresh-output,
process-exit, report-validation, and one-retry rules apply before interpreting the
report. If the first run ends without usable completed-report evidence, rerun the
identical frozen target once with a new attempt output path and interpret only a
valid completed Markdown report. Preserve operational evidence from both attempts.
Completed green, yellow, and red reports proceed to design review interpretation
without automatic retry.

1. Return a deterministic, structural, or coherence correction requirement to the
   authoring workflow when the report and established intent determine one safe
   correction; that workflow writes it and invokes this review again.
2. Enter `references/design-conversation.md` when a finding exposes an
   unresolved material decision, conflicting intent, or future-facing pitfall.
3. Write the resulting scoped correction and compile again.

Repeat until the report is green or every yellow finding is explicitly reviewed
and accepted as nonblocking. Do not synthesize follow-on Sigil, extract glossary
candidates, or begin implementation from red, unresolved-yellow, unavailable,
or incomplete design evidence. If progress requires user judgment, keep the
affected scope in DesignConversation rather than guessing.

Compilation itself is a mandatory gate. No written-file review, concept grouping,
glossary extraction, implementation ReviewGate, or implementation may proceed
until the required compiler process exits with a readable completed Markdown
report. A running, unavailable, incomplete, failed, or cancelled compile cannot
be waived by the user or treated as a skipped check; use the one-retry rule and
then remain blocked.

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

An unavailable, incomplete, failed, cancelled, or red compiler result blocks
implementation review. An unresolved yellow finding also blocks it. Report target
ambiguity or other compilation failure explicitly; never bypass it with an
untracked source copy or an omitted compilation.
