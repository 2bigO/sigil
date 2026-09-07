---
name: sigil
description: Author and inspect Sigil contracts, use native sigilc scope and semantic gates, and prepare or ingest independent per-source reconstructions.
---

<!--
@sigil implements integrations/skills/sigil/_module.sigil::SigilSkill::SkillWorkflow interface
@sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationOwnershipWorkflow interface,logic,constraints,cases
-->

# Sigil

`sigil` owns language inspection and structural Design export. Use `sigilc`
directly for scope, freshness, preparation, ingestion, catalogs and semantic
gates. The native compiler never starts models or owns the coding loop.

Inspect governing Sigil before every implementation mutation. Read the component,
matching expands, imports and relevant implementation before changing its
contract. Existing user authorization remains effective; a compiler report is
evidence, not a separate permission system.

## Select the work

Use [workspace bootstrap](references/workspace-bootstrap.md) to locate and check
the selected workspace and tools. Inspect authored files with:

```sh
sigil check . --format json
sigil retrieve . --component Name --purpose implementation --format markdown
sigil context . --component Name --format markdown
sigil graph . --format json
sigil glossary . --format json
```

Use [greenfield design](references/greenfield-design.md) for new boundaries and
[brownfield adoption](references/brownfield-adoption.md) for existing behavior.
For unresolved intent, read [design conversation](references/design-conversation.md)
and ask about the material decision that available evidence cannot resolve.
Read [authoring conventions](references/authoring-conventions.md) and
[language syntax](references/sigil-format.md) when writing contracts. Reuse
accessible identities and keep each responsibility with its owner.

## Use the native flow

Read [compilation execution](references/compilation-execution.md) for the exact
protocol, ordered scope, per-source worker inputs and command-specific exits.
Capture current authored input with `sigil export design .`; use that JSON with
native `--frontend`. Refresh it after authored/config/glossary changes.

1. Inspect `sigilc scope` and `sigilc stale` with the intended selection.
2. Prepare each stale Design source. An external Design worker reconstructs it;
   ingest its returned Turtle with the original caller-held job descriptor.
3. Run `sigilc compile design` and inspect the named state and diagnostics.
   `sigilc entities` exports the current identity catalog when available.
4. Prepare each selected Implementation source. Its independent external worker
   receives exactly captured source bytes, fixed ontology and frozen catalog.
   Keep Design prose, neighboring code, job descriptors and repair feedback out
   of that worker's input. Ingest each returned Turtle.
5. Run `sigilc compile implementation` or `sigilc compare`. Preserve unavailable
   prerequisites and warnings. Reconstruct changed inputs before comparing again.

See [Design review](references/design-compilation-review.md) and
[implementation design](references/implementation-design.md) for interpretation.
These operations derive meaning from independently supplied assertions; passing
fixtures, ownership comments or tests do not establish reconstruction fidelity.
Delivery, tests, removals and full task completion need their own actual evidence.

Keep `.sigil/worlds/` ignored: it is disposable generated state. Keep preparation
and report files outside selected source scope. Human decisions, model calls,
isolation, scheduling and the convergence loop belong to the external host.
Use existing native functions before inventing temporary mechanisms. An observed
missing capability belongs in authored Design and its responsible implementation;
use it on real work before removing the duplicate mechanism.

## Conditional references

- [Frontend surface review](references/frontend-surface-review.md): routing,
  client-state ownership, async modes, accessibility and UI contracts.
- [Glossary workflow](references/glossary-workflow.md): reviewed vocabulary.
  State whether extraction is required, deferred or inspection-only when relevant;
  ordinary inspection does not require a glossary rewrite.
- [Design intake](references/design-intake.md): ambiguous task boundaries.
- [External guidance](references/external-guidance-evidence.md) and
  [standards review](references/standards-review.md): evidence needed by the task.

Update this repository-owned skill, metadata and evals together. Do not modify
an installed global copy to compensate for obsolete repository guidance.
