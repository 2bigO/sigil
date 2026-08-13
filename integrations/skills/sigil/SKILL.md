---
name: sigil
description: Work with Sigil, a rationale-oriented modeling language and CLI for software systems. Use when a coding agent needs to read, write, review, reconcile, validate, query, render, or use `.sigil` files; model or revise a component, API, state machine, UI surface, or architecture boundary; adopt Sigil in an existing codebase; assess design readiness, drift, terminology, ownership, or implementation coverage; or implement code governed by Sigil. Prefer the `sigil` CLI for deterministic workspace operations. Inspect governing Sigil before every implementation mutation.
---

<!-- @sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationOwnershipWorkflow interface,logic,constraints,cases -->

# Sigil

Sigil records what a software component is, why it exists, how it behaves, and
how its implementation should be understood and changed.

## Core Workflow

1. Read `references/workspace-bootstrap.md` before interpreting workspace
   semantics. It owns CLI discovery, root selection, compatibility, configured
   and unconfigured states, initialization, and failure handling.
2. Select the workflow:
   - Read `references/greenfield-design.md` when implementation does not yet
     constrain the boundary.
   - Read `references/brownfield-adoption.md` when implementation exists but
     coverage is absent, partial, ambiguous, or drifted.
   - Use the established workflow below for credible existing coverage.
3. Write scoped semantic Sigil changes directly to the target files. The files,
   not chat proposals or compiler sessions, are the review artifact.
4. After every semantic edit, follow
   `references/design-compilation-review.md`. It owns the one required
   check-and-design-compile loop, including target selection, waiting until the
   compiler emits a terminal outcome and its stream closes, and its report-driven
   correction path.
5. Report changed files, decisions, assumptions, unresolved questions,
   validation, and glossary status. Let the user review the written Sigil.
6. Before changing implementation, read
   `references/implementation-design.md` and obtain
   `ReviewGate(action: implementation)` readiness for the validated written
   Sigil and exact implementation scope.

Do not use compiler sessions for normal authoring or review. Keep them available
only for an explicitly requested exceptional diagnostic investigation.

## Established-Sigil Workflow

1. Discover the boundary with bootstrap results and `sigil retrieve`. Use it as
   the preferred source of purpose-specific Sigil context: `semantic` for
   contract review, `architecture` for boundaries and dependencies, and
   `implementation` before implementation work. Use an exact-case component
   target by default; use a file target when its colocated declarations or
   expands are the boundary. Read retrieval diagnostics first: correct a failed
   retrieval target or unavailable implementation discovery instead of masking
   it with another command. Use `sigil context` or `sigil graph` only to inspect
   a relationship or detail absent from an otherwise successful retrieval.
   Read the relevant Sigil plus sufficient code, tests, docs, metadata, and
   visual evidence to assess drift.
2. Identify public goals and interfaces, expands, imports, state ownership,
   dependents, unresolved contradictions, and module-index boundaries. Reuse
   matching public imported identities; imports are dependencies, not repeated
   interface content.
3. Read `references/standards-review.md` and assess external guidance through
   `references/external-guidance-evidence.md`. Treat `sigil check` as
   structural validation, not design approval.
4. Follow `references/design-compilation-review.md` for the written design
   compile loop and compiler-owned readiness and architecture evidence. Compile
   the nearest module index that covers the affected Sigil when one exists;
   otherwise select the component whose retrieval closure covers the most
   affected semantic units and their direct relationships. Do not cancel or
   replace that compile while it is running.
5. Use `references/design-conversation.md` only for explicit design or review
   work, or when a material unresolved choice needs user judgment. Elicit and
   resolve every material decision that could create future inconsistency,
   incoherence, or a costly implementation pitfall; ask one primary decision at
   a time unless the user requests a grouped review.
6. Read `references/authoring-conventions.md`, write the scoped components,
   expands, imports, and rationale directly, then rerun validation and design
   compilation. Keep `ModuleIndexFile` as a small boundary summary.
7. Follow `references/glossary-workflow.md` after semantic edits. Always state
   whether glossary extraction is required, deferred, or inspection-only.

## ReviewGate

Use `ReviewGate(action, scope, changeSet, evidence)` only for:

- `workspace-initialization` before creating a ConfigFile or seeded glossary;
- `glossary-change` for reviewed glossary mutations;
- `implementation` for implementation artifacts, including ownership comments.

Its result is `blocked`, `review-required`, or `ready`. Validation, compiler
evidence, coverage, delegated analysis, and tests are evidence, never approval.
A ready result applies only to its exact action, scope, change set, and material
evidence. Do not implement merely because the user requested an outcome or a
check passed.

## Required References

- `references/design-compilation-review.md`: after design intent is sufficiently
  resolved and after written semantic changes.
- `references/authoring-conventions.md`: when creating or semantically editing
  Sigil.
- `references/glossary-workflow.md`: after semantic Sigil edits, when a glossary
  exists, when reviewed vocabulary is requested, or when terminology is material.
- `references/sigil-format.md`: when syntax, workspace structure, or examples
  are needed.
- `references/implementation-design.md`: before every implementation mutation
  or coverage decision.

## CLI

Prefer the compatible `sigil` CLI; do not recreate its deterministic semantics.

```bash
sigil parse path/to/file.sigil --format json --pretty
sigil check path-or-workspace --format json --pretty
sigil fmt path-or-workspace --check
sigil compile path-or-workspace --focus design --component Name
sigil retrieve path-or-workspace --component Name --purpose semantic --format markdown
sigil retrieve path-or-workspace --file path/to/file.sigil --purpose architecture --format markdown
sigil retrieve path-or-workspace --component Name --purpose implementation --format markdown
sigil graph path-or-workspace --format json --pretty
sigil context path-or-workspace --component Name --format json --pretty
sigil context path-or-workspace --file path/to/file.sigil --format json --pretty
sigil glossary path-or-workspace --format json --pretty
sigil render path-or-workspace
```

Exit code `0` is clean; `1` has diagnostics; `2` is usage error; `3` is a host
or runtime failure that prevents reliance on workspace semantics. CLI output
never grants implementation approval.

For understanding or review-only requests, do not edit files. For
standards-aware review, use the headings in `references/standards-review.md`.
