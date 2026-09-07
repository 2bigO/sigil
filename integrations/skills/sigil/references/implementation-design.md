<!--
@sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationOwnershipWorkflow interface,logic,constraints,cases
@sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationCoverage interface,logic,constraints,cases
@sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationAlignment interface,logic,constraints,cases
-->

# Implementation design and alignment

Inspect governing Sigil before every implementation mutation. Retrieve the
component and matching expands with `sigil retrieve . --component Name --purpose
implementation --format markdown`, then inspect owning source, direct dependents,
tests and gaps in retrieval. Resolve missing context from actual files rather
than treating an empty ownership map as complete coverage.

The user's task authorization remains effective across routine contract/code
changes. Ask about a material unresolved choice when necessary; do not add a
second compiler-driven approval lifecycle.

## Cohesive ownership

Classify material responsibilities as independent components, expands of an
existing owner, or trivial mechanics needing no separate Sigil. Public entrypoint
files assemble the namespace; place state, lifecycle and behavior with their
cohesive owners. A high-level product summary is insufficient when material
internal APIs, persistence, concurrency or error behavior remain unspecified.
Use [frontend surface review](frontend-surface-review.md) for presentation owners.

Inspect useful existing primitives first. For a refactor, delete obsolete
implementations and their dedicated UI/config/tests. Retain required capabilities
through their new actual infrastructure; do not preserve a legacy API facade.
A missing native capability observed in the running workflow requires authored
Design and implementation in its responsible owner, followed by real use.

## Navigation annotations

Ownership comments are optional navigation/context evidence. Use supported
`@sigil implements` targets with normalized repository-relative Sigil paths,
component, optional concept, and `interface`, `state`, `logic`, `constraints`
or `cases` sections. `goal` and `decisions` are not implementation targets.

Place comments beside stable source entrypoints; use HTML comments for
agent-facing Markdown. Do not annotate JSON or authored Sigil. Inspect both
component and matching expands; concept selectors address only sections with
that concept occurrence. Reconcile stale links against actual source and
contract evidence. Never infer semantic discharge from annotation presence.

## Verify the current result

Run checks appropriate to the changed behavior and its dependents. Keep actual
check outcomes, required unrun checks and known missing behavior visible.
Follow [native compilation execution](compilation-execution.md) with the intended
complete selection or a clearly identified focused increment.

After the coding round, prepare current inputs for independent external workers.
Each Implementation worker sees only captured source, fixed ontology and frozen
identity catalog, with no Design relationships or neighboring code. Ingest its
returned Turtle; do not write self-confirming assertions as verification.

`sigilc compile implementation` and `sigilc compare` return Closed or Converged
with exit 0, Drift with exit 1. Unavailable comparison remains unset with its
prerequisite reason. Preserve bounded diagnostic omissions and explained warnings.
Return concrete defects to implementation and unresolved material intent to
Design; refresh affected captures/reconstructions after edits.

Completion requires actual delivery, required checks, removals and current
semantic evidence at the requested scope. A focused success does not prove the
whole task. Converged may contain evidence limitations; it cannot excuse known
unimplemented behavior. A test fixture exercises the protocol, not faithful
independent reconstruction of the application.
