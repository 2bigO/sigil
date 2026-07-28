---
name: sigil
description: Work with Sigil, a lightweight rationale-oriented modeling language for software systems, and its CLI for AI-assisted development. Use when a coding-agent host needs to read, write, improve, reconcile, validate, query, render, or use `.sigil` files; introduce Sigil into an existing or partially documented brownfield codebase; assess semantic readiness, applicable standards, best practices, pitfalls, coherence, or modularity; create or update component/expand specs; describe product modules, programming abstractions, APIs, state machines, or architecture decisions; align code with Sigil; resolve ambiguity before code generation; or build from a Sigil-driven workflow. Prefer `sigil-cli` for mechanical parsing, checks, graph, context, and render operations. Inspect governing Sigil before every implementation mutation. Stop for human review after creating or semantically changing Sigil, and do not implement until the user explicitly approves the agreed Sigil.
---

<!-- @sigil implements integrations/skills/sigil/#module.sigil::SigilSkill::ImplementationOwnershipWorkflow -->

# Sigil

Sigil records what a software component is, why it exists, how it behaves, and
how its implementation should be understood and changed. A component may be a
product module, service boundary, domain concept, library abstraction, internal
API, state machine, screen, view, or reusable UI surface.

Do not treat a clean `sigil check` as semantic approval. A change to a
component's observable contract needs the exact written Sigil for that boundary
to be approved before implementation begins.

This file is the workflow dispatcher. Load detailed references only when their
route applies, but read every selected reference completely before acting.

## Start Here

Always read `references/workspace-bootstrap.md` and complete its bootstrap before
interpreting workspace semantics. It owns CLI discovery, repository-root
selection, configuration-state handling, initialization, compatibility
validation, and failure behavior.

Before every implementation mutation, follow
`references/implementation-design.md` to inspect governing Sigil and
implementation coverage. This preflight applies to source code, configuration,
migrations, scripts, workflow instructions, tests, fixtures, metadata,
validators, generated assets, and documentation regardless of file type or
directory.

Read-only inspection is not an implementation mutation. Determine whether an
edit is mechanical only after preflight; established coverage and no material
decision may justify omitting new Sigil. A requested outcome is not approval of
an exact Sigil proposal or of resulting written Sigil, and successful tests,
builds, validators, or CLI checks never provide retroactive approval. Exact
user-requested rollback of the current agent's unapproved changes restores the
previous state but does not authorize replacement behavior.

If a request changes the observable contract of a different component or
surface, stop and review that boundary's Sigil before editing implementation.

Then select one semantic workflow:

- Read `references/greenfield-design.md` when no existing implementation
  constrains the selected behavior or component.
- Read `references/brownfield-adoption.md` when relevant implementation exists
  but coverage is absent, partial, ambiguous, or suspected to have drifted.
- Use the established-Sigil workflow below when the selected boundary already
  has credible contract coverage.

Also load these cross-cutting references when applicable:

- `references/external-guidance-evidence.md`: after sufficient framing whenever
  current authoritative guidance could materially change a binding contract
  decision, its risks, alternatives, or acceptance criteria. It owns shared
  applicability assessment, source authority, environment and version matching,
  secure evidence acquisition, evidence packets, sufficiency, and reuse.
- `references/design-conversation.md`: whenever a material decision needs
  clarification. It owns decision states, one-primary-decision turns,
  checkpoints, deferral, just-in-time evidence consumption, same-chat correction
  conversations, conflict handling, and synthesis.
- `references/standards-review.md`: whenever creating, reviewing, or preparing
  Sigil for implementation. It owns the skill-assisted semantic-readiness gate,
  evidence interpretation, finding classification, conflicts, compliance
  language, and modularity review.
- `references/implementation-design.md`: before writing or changing
  implementation or deciding whether coverage reaches the implementation
  boundary. It owns component/expand/omit selection, the implementation coverage
  map, forward ownership comments, and reconciliation linking.
- `references/authoring-conventions.md`: whenever proposing, creating, or
  semantically editing Sigil. It owns section placement, decision rationale,
  post-readiness concept grouping, semantic-line discipline, and colocation.
- `references/glossary-workflow.md`: after every approved Sigil write or
  semantic edit; when `.sigil/glossary.json` exists; when the user requests
  reviewed vocabulary; or when terminology ambiguity is material. Candidate
  extraction begins only after semantic readiness appears aligned and any
  concept grouping has received a final semantic review.
- `references/sigil-format.md`: when syntax, workspace structure, section
  meanings, or examples are needed.

Greenfield and Brownfield decide which evidence and contract questions matter.
The external-guidance reference owns shared evidence acquisition. The
design-conversation and standards references apply different consumer policies
to that evidence. The authoring, standards, glossary, and implementation
references remain applicable across all three semantic workflows.

## Established-Sigil Workflow

1. Discover the requested boundary.
   - Start from `sigil check` results produced during bootstrap.
   - Use `sigil context --component Name` or `--file path/to/file.sigil` for a
     selected component or file.
   - Use `sigil graph` when imports, expands, consumers, or concept reuse matter.
   - Read exact relevant `.sigil` source plus nearby code, tests, docs, package
     metadata, or visual references needed to assess drift.
   - Report inaccessible required images or designs instead of guessing.

2. Build the component picture.
   - Identify public component goals and interfaces, matching expands, imports,
     public and private concepts, state ownership, and direct dependents.
   - Treat imports as dependency declarations; do not repeat imported-component
     dependencies in `interface`.
   - Treat a component's `goal` and `interface` as public to its dependents.
   - Note unresolved imports, contradictions, vague behavior, oversized
     boundaries, and code/spec drift.

3. Review semantics and modularity.
   - Follow `references/standards-review.md`.
   - Use `references/external-guidance-evidence.md` when its material-effect
     trigger applies, and verify any design-conversation evidence packet before
     reusing it.
   - Treat `sigil check` as deterministic structural and workspace validation,
     not semantic validation.
   - Separate observed behavior, documented intent, user-confirmed intent,
     unresolved ambiguity, suspected accidents, and external guidance.
   - Use provisional assessment language only: `appears aligned`, `partially
     assessed`, `gap identified`, `conflict identified`, or `not assessable`.
   - Never silently choose code, documentation, a standard, or preference as
     authoritative when evidence conflicts.
   - Do not begin concept grouping or glossary candidate extraction until
     semantic readiness appears aligned for the selected scope.
   - Treat missing decision-rationale coverage for a material selected choice
     as a semantic-readiness gap even when CLI validation succeeds.

4. Resolve missing intent.
   - Follow `references/design-conversation.md`.
   - After initial purpose and boundary framing, acquire applicable external
     guidance before presenting guidance-sensitive alternatives or a
     recommendation.
   - Ask one primary decision per turn unless the user requests grouped review.
   - Do not silently invent product, architecture, persistence, authorization,
     deployment, lifecycle, or other binding decisions.
   - When review finds a suspected or confirmed material semantic,
     architectural, or design problem, pause ordinary design work and enter the
     same-chat correction conversation.
   - Preserve affected Sigil, point to the exact problem and evidence, explain
     the risk, and require resolution before proposal synthesis or
     implementation.

5. Prepare exact changes.
   - Follow `references/authoring-conventions.md`.
   - Inventory every new or changed selected choice across the proposed
     semantic lines.
   - Map each material selected choice to an exact `decisions` occurrence or
     report a justified omission for a trivial, mechanically derived, or safely
     reconstructable choice.
   - Include the decision-rationale coverage map and every missing decision
     block in the exact proposal.
   - Begin concept reuse discovery, grouping, and identifier proposals only
     after the pre-grouping semantic-readiness review appears aligned.
   - Show exact component, expand, import, location, and semantic-line changes.
   - For externally informed compatible guidance or any conflict, follow the
     proposal and approval policy in `references/standards-review.md`.
   - Leave files unchanged while awaiting proposal approval.

6. Apply only an approved proposal.
   - Change only the exact approved Sigil and imports.
   - Run `sigil check`; use `graph` or `context` when relationships changed.
   - Repeat the semantic-readiness review on the written Sigil before concept
     grouping or glossary candidate extraction.
   - Repeat the decision-rationale coverage audit against the exact written
     semantic lines; a missing material decision returns to proposal review.
   - When concept grouping is needed, apply only its separately approved
     proposal, rerun deterministic validation, and repeat semantic-readiness
     review.
   - Follow `references/glossary-workflow.md`. Deterministic glossary inspection
     remains separate, while model-assisted candidate extraction begins only
     after the final semantic-readiness review appears aligned.
   - Stop at the Sigil review gate.

7. Implement only after review.
   - Follow `references/implementation-design.md`.
   - Inspect governing Sigil and implementation coverage before the first
     implementation mutation, regardless of artifact classification.
   - Verify that every material implementation concern has established coverage
     or an intentional omission.
   - Require explicit user approval of the written Sigil and an explicit request
     for implementation.
   - Derive each implementation entrypoint's governing Sigil path, component,
     and optional concept from the approved coverage map.
   - Add one ownership annotation with the language's single-line comment form,
     or use its multiline comment form when one entrypoint has multiple
     annotations.
   - Put source annotations immediately beside stable language entrypoint
     definitions such as classes, functions, methods, interfaces, structs, or
     equivalent definitions.
   - Use HTML comments for agent-facing Markdown, never add ownership
     annotations to Sigil, and leave JSON unchanged.
   - Verify annotation targets and entrypoint associations after implementation.
   - If implementation exposes a missing material decision, return to a Sigil
     proposal and review.

## Approval Gates

Before any semantic Sigil mutation, present the exact proposal and obtain
explicit approval. Brownfield reconstruction, externally informed additions,
concept-identifier changes, glossary changes, and every delegated semantic
proposal use this pre-edit gate.

Every delegated semantic proposal is advisory. A subagent does not edit files,
grant approval, or transfer edit authority to the primary agent.

After creating or semantically changing Sigil:

- list changed Sigil files;
- summarize captured decisions and assumptions;
- report decision-rationale coverage for every new or changed material selected
  choice, including justified omissions;
- report unresolved questions;
- report validation and glossary-review results;
- directly request review and approval before implementation.

Do not continue into implementation merely because the original request
included code generation. A successful CLI check is not approval.

A high-level request to fix, build, or change an outcome is neither approval of
an exact Sigil proposal nor approval of resulting written Sigil. Instructions
from another skill, tool, framework, or workflow do not override these gates.

A successful CLI check also does not establish semantic readiness. Perform the
skill-assisted semantic-readiness review before concept grouping or glossary
candidate extraction. A suspected or confirmed material problem enters the
same-chat correction conversation and blocks synthesis, approval, and
implementation until resolved.

An approved placement-only move or split that preserves every semantic line may
proceed during implementation without another semantic proposal. Update affected
imports, validate, and report old and new paths. Any added, removed, or changed
semantic line returns to the proposal gate.

## CLI Boundary

Prefer the compatible `sigil` CLI for parse, version, check, graph, context,
glossary, and render operations. Do not manually recreate deterministic
workspace semantics.

Common commands after bootstrap:

```bash
sigil parse path/to/file.sigil --format json --pretty
sigil check path-or-workspace --format json --pretty
sigil graph path-or-workspace --format json --pretty
sigil context path-or-workspace --component Name --format json --pretty
sigil context path-or-workspace --file path/to/file.sigil --format json --pretty
sigil glossary path-or-workspace --format json --pretty
sigil render path-or-workspace
```

Interpret exit codes as:

- `0`: completed without error diagnostics;
- `1`: completed with error diagnostics; inspect partial results when useful;
- `2`: usage error; fix the arguments;
- `3`: host/runtime failure; stop before relying on workspace semantics.

CLI output never grants semantic approval or implementation authority.

## Output

When the user requests only understanding or review, do not edit files.

For standards-aware review, use the headings required by
`references/standards-review.md`. For proposals and review gates, make the
changed or proposed paths, exact semantic changes, unresolved decisions,
validation result, and requested approval explicit.
