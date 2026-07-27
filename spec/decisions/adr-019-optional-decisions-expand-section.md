# ADR-019: Optional Decisions Expand Section

**Status:** Accepted

**Owner:** _TBD_

**Reviewers:** _TBD_

**Last updated:** 2026-07-24

## Context

Sigil is intended to preserve the reasoning behind implementation decisions,
but its current expand sections distribute that information across `logic` and
`constraints`.

`constraints` can record the binding outcome of an architecture or technology
choice, but it does not clearly distinguish that outcome from the context,
assumptions, alternatives, trade-offs, and consequences that led to it.
Maintainers and future agent sessions can therefore see what must remain true
without receiving enough durable context to understand why it was selected.

Full session transcripts, prompts, and hidden reasoning are not suitable
project records. They are noisy, may contain sensitive or irrelevant material,
and do not provide a concise decision that can be reviewed independently.

Sigil needs a lightweight place for durable decision rationale without turning
free-form authoring into a rigid decision-record schema.

## Decision

Sigil will add `decisions` as an optional section of `expand`.

```sigil
expand Payments {
  constraints {
    PersistenceChoice {
      Payment records are stored in PostgreSQL.
    }
  }

  decisions {
    PersistenceChoice {
      Decision: Use PostgreSQL for payment records.

      Scope: Governs payment persistence and transaction handling. Analytics storage is outside this decision.

      Assumptions: The deployment environment provides managed PostgreSQL.

      Trade-offs: Strong consistency is preferred over simpler local persistence.

      Design issues addressed: Prevents conflicting writes and ambiguous recovery.

      Discarded alternatives: SQLite was rejected because multi-writer operation is required.

      Consequences: Persistence changes must preserve transaction boundaries.

      Revisit when: Deployment or concurrency requirements change.
    }
  }
}
```

The `decisions` body remains free-form Sigil content:

- the section may be omitted;
- concept blocks are optional at the language level;
- labeled fields are optional at the language level;
- no fixed rationale schema is introduced;
- grouped and ungrouped semantic lines are preserved normally;
- ungrouped decision content does not produce a missing-concept-identifier
  diagnostic.

The conventional expand order becomes:

```text
state
logic
constraints
decisions
cases
```

The order remains a readability convention with no semantic effect.

### Relationship To Constraints

`constraints` remains the authority for a binding rule, policy, invariant,
architecture decision, ownership rule, or technology choice that an
implementation must obey.

`decisions` explains why a material outcome was selected. It does not weaken,
override, or replace a binding constraint.

When rationale and a binding outcome both matter, authors should reuse one
concept identity across `constraints` and `decisions`.

### Relationship To Contextual Concept Reuse

Concept identity answers whether separate semantic occurrences concern the same
architectural idea. `Scope` states where one decision occurrence applies.

An importer may reuse an accessible public concept in `decisions` to connect its
local rationale to the provider's public idea. That contextual reuse does not
extend the provider's decision, transfer ownership, or make either decision
transitively binding.

The provider's private `decisions` content is not exposed through an import.
An author or agent must select the provider and its matching expands explicitly
to inspect that rationale.

Each contextual decision occurrence states its local boundary through `Scope`.
The binding outcome remains in the constraints of the component that owns it.

### Sigil Skill Authoring Rules

The Sigil language remains permissive, while the Sigil skill applies a
consistent authoring discipline when it creates or materially edits a decision:

- use one concise PascalCase concept block for each material decision;
- record `Decision` and `Scope`;
- use `Scope` to identify the governed boundary and important exclusions
  without attempting to enumerate every current dependent;
- reuse an accessible concept identifier when decisions concern the same
  semantic idea;
- treat contextual concept reuse as a rationale link rather than transitive
  decision authority;
- record `Assumptions`, `Trade-offs`, `Design issues addressed`,
  `Discarded alternatives`, `Consequences`, and `Revisit when` when materially
  applicable;
- omit an inapplicable label instead of adding filler;
- keep the binding selected outcome in `constraints`;
- summarize durable rationale rather than prompts, raw session transcripts, or
  hidden reasoning.

The initial convention does not include `Responsibility`, `Accountability`,
`Approver`, or `Handoff` metadata. Approval and provenance remain separate from
the decision prose, and the decision record itself supplies future-session
context.

The skill does not require a `decisions` section for trivial, safely
reconstructable choices. Absence of the section does not make otherwise
complete Sigil invalid.

### Relationship To Receipts

This decision narrows one non-goal in proposed ADR-011. Sigil source may contain
concise, human-authored decision rationale, while generated receipts may still
capture attributed interpretations, evidence, checks, uncertainty, freshness,
and review state.

Receipts do not replace the durable selected decision, and `decisions` does not
store receipt data, prompts, private chain-of-thought, or unbounded evidence.
The remainder of ADR-011 is unaffected unless separately revised.

## Consequences

Benefits:

- maintainers and future agents can recover why a material choice was made;
- each material choice identifies the boundary where its rationale applies;
- assumptions and rejected alternatives are visible before the same options are
  investigated again;
- design risks and bottlenecks addressed by a choice remain connected to that
  choice;
- binding constraints stay concise while their rationale remains colocated;
- the language preserves free-form authoring and ordinary semantic-line
  behavior.

Costs:

- authors and agent workflows must keep rationale synchronized with binding
  constraints;
- permissive syntax cannot guarantee that every decision record is complete;
- repeated rationale can drift if authors duplicate a decision across
  components instead of assigning one clear owner;
- a scope statement can become misleading if authors use it as an exhaustive
  dependency inventory rather than a durable boundary;
- language support requires a new pre-production minor version because older
  tools treat `decisions` as an unknown section.

The implemented language version is `0.5.0`.

## Alternatives Considered

### Keep rationale only in `constraints`

Rejected because binding outcomes and explanatory history serve different
review needs. Combining them makes constraints longer while still providing no
consistent place for assumptions, trade-offs, and rejected alternatives.

### Add a rigid decision schema to the language

Rejected for the initial design because mandatory fields and nested decision
syntax would make the grammar heavier and force irrelevant metadata into simple
decisions.

### Require concept blocks and labels in deterministic core

Rejected because the language should accept lightweight free-form rationale.
The stricter convention belongs to the Sigil skill, where semantic
applicability can be assessed with human review.

### Store session transcripts or prompts

Rejected because raw sessions are noisy, potentially sensitive, and unsuitable
as durable engineering rationale. Decision records retain concise conclusions
and the context required to understand them.

### Use generated receipts only

Rejected because receipts describe interpretation, evidence, checking, and
review state, while the selected engineering decision should remain concise,
human-authored source beside the component it governs.

### Include responsibility and handoff metadata

Deferred because responsibility may refer to people, roles, teams, or component
ownership and needs a separate authority model. A dedicated handoff field is
unnecessary when the complete decision record already provides future-session
context.

### Enumerate every affected component

Rejected because dependency inventories change more often than the decision
boundary and can duplicate imports, graphs, and implementation evidence.
`Scope` records where the decision applies, while current impact analysis
discovers affected parts from current repository evidence.

## Revisit Conditions

Revisit this decision if:

- free-form decision records are too inconsistent for reliable agent use;
- authors cannot keep decisions and their binding constraints synchronized;
- responsibility or approval metadata gains a reviewed authority model;
- scope statements prove too broad or too weak for contextual decision reuse;
- generated receipts need a stable, explicit relationship to decision
  concepts;
- practical use requires decision status, supersession, or cross-component
  dependency semantics;
- the recommended rationale labels routinely fail to capture important
  decision context.
