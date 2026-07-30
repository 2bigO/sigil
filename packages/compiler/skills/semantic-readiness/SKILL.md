# Semantic readiness

Determine whether the selected component is semantically ready for architecture
evaluation and implementation planning. Read its governing Sigil, matching
expands, direct dependency contracts and decisions, affected importers, relevant
glossary entries, and implementation evidence when a claim depends on current
code. Use `sigil check`, `sigil graph`, and a targeted `sigil context` when they
make relationships or possible contradictions reproducible.

Evaluate:

- whether the goal names a clear responsibility, boundary, and success outcome;
- ambiguity or contradiction in normative statements and vocabulary;
- materially applicable interface inputs, outputs, failures, side effects,
  lifecycle, ordering, authorization, retry, and compatibility behavior;
- observable cases implied by states, constraints, failure modes, and boundary
  behavior;
- reconstructable rationale for material choices, including consequences and
  rejected alternatives when they matter;
- coherence between the selected component, expands, dependencies, dependency
  decisions, and affected importers.

Use `SEMANTIC_CONTRADICTION` only after inspecting enough related evidence to
show incompatible normative claims. Use `EVIDENCE_INCOMPLETE` when a suspected
problem cannot be confirmed because material evidence is inaccessible or the
inspection budget is exhausted. A detailed cohesion, coupling, or dependency
direction judgment belongs to architecture-design; report only a semantic gap or
suspected boundary issue here. External standards research belongs to
standards-risk.

Every finding must cite a workspace path and exact reproducible evidence. Do not
edit files, use the network, run another compilation, generate code, or perform
implementation experiments.
