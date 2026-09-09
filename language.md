# Sigil: structure for software design

Code gets modules, types, and symbols. Design often gets a Markdown heading and
an optimistic assumption that everyone read it.

Sigil gives design its own structure: named responsibilities, reusable Concepts,
individual Facets, and seven contracts that distinguish an API promise from an
invariant, an implementation choice from its rationale, and a scenario from a
test file.

The content stays close to how programmers describe software. The structure
makes it addressable, composable, and available for semantic comparison with
code. This is not another syntax for writing the implementation twice.

This document defines the intended language, including the author's
clarifications. It takes precedence over narrower descriptions in
`spec/sigil-language.md` and current tooling limitations. Examples explain the
language; they do not claim every described compiler capability is implemented.

## Components own contracts; Concepts group Facets

**Component is the core container. Contracts contain Facets.** A Facet can go
directly under any contract. No Concept identifier is required, including in
Interface.

**Use Concept IDs actively to organize a component's meaning.** Real components
often involve several concepts: a request, its lifecycle, result selection,
publication authority. Naming those groups lets Interface, State, Logic,
Constraints, and Cases refer to the same ideas without relying on paragraph
position or repeated explanations.

Look for those cross-contract connections when authoring. A good Concept ID
makes related Facets easier to find, reuse, and reason about. It is more than
a heading. Smaller components may describe one cohesive concept clearly enough
through their own boundary and need no additional grouping; individual Facets
can also remain ungrouped inside a larger component.

```text
Component
  Contract
    Facet
    Concept A { Facets }
    Another ungrouped Facet
    Concept B { Facets }
  Another contract
    Facet
    Concept A { More Facets about A }
```

This is optional grouping, not a mandatory `Component -> Concept -> Facet`
ladder. A contract can freely mix ungrouped and Concept-grouped Facets. A
component can use zero, one, or arbitrarily many Concept IDs. Prefer meaningful
grouping where it exposes the design's structure; do not manufacture wrappers
just to satisfy a template or a warning.

| Primitive | Meaning |
| --- | --- |
| **Component** | Ownership boundary for a responsibility. Not necessarily one class, file, or process. |
| **Concept** | Named grouping that connects an idea's Facets across contracts. Use it to organize the several concepts that real components commonly contain. |
| **Facet** | Individual authored contribution, grouped under a Concept or directly under a contract. |
| **Embedded Facet** | A contribution expressed through introducing prose and fenced content in a chosen notation. |
| **Contract** | The role of a contribution: Goal, Interface, State, Logic, Constraint, Decision, or Case. |
| **Expand** | Additional operational contributions to an existing component. |
| **Export** | Public vocabulary established by Interface definitions. |
| **Import** | Access to another component's public contract and exported vocabulary. |
| **Module index** | Explicit assembly of public component surfaces. |

Facets are the finest native authored units. A compiler can decompose their
meaning further for calculation without making authors write that intermediate
representation themselves.

## Seven contracts, seven different jobs

A signature, an invariant, and the reason you chose an algorithm are different
kinds of information. Putting all three in a paragraph does not make them the
same kind.

| Contract | Source spelling | What belongs here |
| --- | --- | --- |
| Goal | `goal` | Purpose, responsibility, intended outcomes. Why this component exists. |
| Interface | `interface` | Public operations, inputs, results, events, errors, and vocabulary. What dependents can use or observe. |
| State | `state` | Relevant data, configurations, modes, and lifecycle conditions. |
| Logic | `logic` | Calculations, guards, sequencing, delegation, flows, and transitions. |
| Constraint | `constraints` | Invariants, prohibitions, bounds, ownership rules, and binding restrictions. |
| Decision | `decisions` | Choices, alternatives, assumptions, trade-offs, consequences, and reasons to reconsider. |
| Case | `cases` | Scenarios: happy paths, sad paths, edge conditions, failure, and recovery. |

Each contract can discuss several Concepts. Each Concept can appear in whichever
contracts contribute useful meaning. There is no requirement to fill seven
sections for every Concept. Empty ceremony is still empty ceremony.

## A public surface, with more than one Concept

A component declaration contains Goal and Interface:

```sigil
component SearchPanel {
  goal {
    Let a caller search records and select a result.
  }

  interface {
    Results is the ordered collection of matching records.

    Search {
      submit(Query) starts a search and produces Results or SearchError.

      cancel() cancels the active search.
    }

    Selection {
      choose(Result) selects one result from the current Results.

      clear() removes the current selection without changing Results.
    }
  }
}
```

SearchPanel owns the component responsibility. Search and Selection are two
Concepts within it. The statements about submit, cancel, choose, and clear are
Facets. The Results definition is an ungrouped Facet in the same Interface.
Search and Selection justify named grouping because later contracts describe
their different behavior. Neither needs its own component merely to have an
identity.

A component can describe a parser, a screen, a data model, a workflow, or an
architectural boundary. A source file is a storage choice, not its definition.

## One Concept, several contracts

An `expand` contributes State, Logic, Constraints, Decisions, and Cases to the
same component:

```sigil
expand SearchPanel {
  state {
    Search {
      The search is Idle, Loading, Ready, or Failed.
    }
  }

  logic {
    Search {
      Submitting a Query starts Loading and replaces the active request.

      A successful active request enters Ready with its Results.
    }
  }

  constraints {
    Search {
      A response from a replaced request must not overwrite current Results.
    }
  }

  decisions {
    Search {
      Keep the latest request authoritative because responses can arrive
      out of submission order.
    }
  }

  cases {
    Search {
      A successful Query shows its Results and ends Loading.

      A failed Query shows SearchError and permits another submission.

      An older response arriving after a newer result leaves that result intact.
    }

    Selection {
      Choosing a current Result makes it the selected result.

      Clearing the selection leaves the current Results available.
    }
  }
}
```

Every `Search { ... }` refers to **the same resolved Concept**. State does not
create a state-shaped Search unrelated to the Interface's Search. The identifier
connects their contributions. Selection has its own identity and Facets even
though it shares the component.

Those connections are semantic structure, not proof of behavior. An operation
and a Constraint under Search still need to concern the same action or resource
for the Constraint to apply. Different Concepts can also connect through
explicit relationships, such as an operation returning a separately described
result.

### Identity has scope

Repeating an accessible Concept within its component and matching expands
preserves its identity. Imported Concepts retain their originating identity
when reused in the consumer's context. Two unrelated local declarations named
Search do not merge because the strings compare equal.

Concept blocks are flat: Facets inside, not nested Concepts. Describe
relationships between separate Concepts rather than encoding them as nesting.
A Concept name is a reusable identity, not a compressed paragraph.

## Facets: paragraphs with an address

**Facet is a native primitive.** The Concept heading names the subject; the
statements underneath it contribute the meaning.

```sigil
constraints {
  Search {
    A cancelled request cannot publish Results.

    An older response cannot replace a newer result.
  }
}
```

One Concept, two Facets.

**One empty line ends an ordinary Facet.** A newline alone does not. Adjacent
prose lines continue the same Facet, so wrapping a sentence does not change the
design's granularity. A Facet may contain several related clauses; it is an
authored unit, not a one-verb-per-paragraph rule.

Facets can also appear directly under a contract:

```sigil
constraints {
  Network access goes through the application transport boundary.
}
```

This still has a component owner, contract role, and source location. No
`NetworkAccessMustGoThroughTheTransportBoundary` Concept is required.

A Concept block is not itself a Facet. It optionally groups Facets; the eqval
does not introduce Facets by renaming whole blocks. Ungrouped and mixed
authoring is valid in every contract without grouping diagnostics.

## Embedded Facets: use the notation that fits

A transition diagram should not have to become five paragraphs just to qualify
as design.

````sigil
expand SearchPanel {
  logic {
    Search {
      The active request follows this lifecycle:
      ```mermaid
      stateDiagram-v2
        Idle --> Loading: submit
        Loading --> Ready: success
        Loading --> Failed: failure
        Loading --> Idle: cancel
        Ready --> Loading: submit
        Failed --> Loading: retry
      ```
    }
  }
}
````

The introducing prose and fenced body form **one Embedded Facet**. The opening
triple-backtick fence identifies the notation; the closing fence delimits the
embedded content. Blank lines inside the fence do not end the Facet. Braces,
arrows, and labels inside it are not new Sigil declarations.

The notation can be Mermaid, JSON, SQL, TypeScript, Rust, mathematics, or another
language suited to the contribution. Sigil preserves the representation rather
than pretending every useful design statement is ordinary prose.

The surrounding contract still determines its role:

| Embedded content | Possible role |
| --- | --- |
| JSON in Interface | Define a public value shape. |
| Mermaid in Logic | Describe transitions or control flow. |
| Code in Cases | Express a scenario and its expected observations. |

A fence is not `eval`. Its language label does not make the content executable,
and code-shaped Design does not automatically become production evidence.
There are two authored forms: an ordinary Facet and an Embedded Facet.

## Expands are additive, not overrides

The public declaration contains Goal and Interface. Expands contribute the
operational contracts: State, Logic, Constraints, Decisions, and Cases.

An expand describes the same component. It is not a subclass, replacement, or
second owner. Multiple matching expands contribute collectively. Conflicting
Facets remain a design conflict; requirements do not have last-write-wins
semantics.

A cross-file expand imports its owning component:

```sigil
@search/panel.sigil import { SearchPanel }

expand SearchPanel {
  logic {
    Selection {
      Choosing a different Result replaces the previous selection.
    }
  }
}
```

This lets operational detail live beside the code it describes while the public
contract remains independently accessible.

## Interface definitions are exports

Interface publishes more than Concept headings and callable signatures.
**Identifiers defined within its Facets are public vocabulary too.**

```sigil
component RecordSearch {
  goal {
    Find records matching a caller's search request.
  }

  interface {
    Query is the caller's search text and selected filters.

    Result is one matching record.

    Results is the ordered collection of matching Result records.

    SearchError describes why a request could not complete.

    submit(Query) produces Results or SearchError.
  }
}
```

This small RecordSearch example describes one cohesive concept without needing
another grouping identifier. Query, Result, Results, SearchError, and submit are public identifiers
defined by its ungrouped Interface Facets. If an Interface also uses named
Concepts, those identifiers are public too. Concept and exported identifier
are related notions, not synonyms; export does not depend on grouping.

Definition matters. Every English word in Interface is not an export. Mentioning
an imported identifier does not declare another owner for it. Interface is the
export mechanism; these examples do not introduce a separate `export` statement
or a second declaration language inside prose.

### Imports carry the public vocabulary

```sigil
@search/record-search.sigil import { RecordSearch }

component SearchPage {
  goal {
    Make record search available from the application screen.
  }

  interface {
    SearchScreen {
      Accept a Query and display Results returned by RecordSearch.

      Present SearchError with a way to try again.
    }
  }
}
```

The component import brings RecordSearch's public contract and exported
vocabulary into scope. Query and Results refer to the provider's identities,
not new local definitions with conveniently matching spellings.

`@path` resolves from the workspace root. An explicit `.sigil` path selects that
source. A directory path resolves through `_module.sigil`. These component
imports carry public vocabulary; no additional fine-grained import syntax is
prescribed here.

### Shared identity does not transfer ownership

A consumer can contribute Facets about an imported Concept. The Concept keeps
its origin; the new Facets keep their consumer context. A page's presentation
restriction does not rewrite the provider's result-production behavior upstream.

Imports do not copy private State, Logic, Constraints, Decisions, or Cases into
the consumer's contract. Names introduced only in operational contracts remain
private unless they are also part of Interface. Exporting a Concept does not
export every private Facet describing it.

An import also does not establish a runtime invocation. Access to an operation
and calling that operation are different relationships.

## `_module.sigil`: an assembly, not a recursive glob

A module index assembles an explicit public surface:

```sigil
@search/record-search.sigil import { RecordSearch }
@search/search-page.sigil import { SearchPage }

component SearchFeature {
  goal {
    Assemble record search and its application-facing presentation.
  }

  interface {
    SearchFeatureSurface {
      Provide RecordSearch and SearchPage through their owning contracts.
    }
  }
}
```

A consumer can address the directory:

```sigil
@search import { SearchFeature, RecordSearch }
```

The index exposes locally declared components and component names resolved
through its explicit imports. It does not automatically export every file under
the directory. Explicit file imports remain available.

Assembly can be layered: domain modules form a model module; a package module
assembles that model surface alongside operational components. Each imported
component retains its own Concepts, Facets, and responsibilities. The larger
surface does not flatten the design into one component.

The module owns its assembly and any additional responsibility its Facets state.
A summary saying "provide search" does not replace the imported search contract
or establish that its behavior is implemented.

Keep namespace assembly separate from runtime composition. Exposing a parser
and a formatter does not mean parsing invokes formatting. A pipeline can
explicitly own calling stages in order. Same components, different relationship.

## Cases are scenarios; tests can exercise them

A Case describes a starting situation, an action or sequence of actions, and
expected observations. It can describe a concrete example or a family of
scenarios. Happy paths are useful. So are rejection, cancellation, empty data,
partial failure, retry, and inconvenient event ordering.

```sigil
cases {
  Search {
    Submitting a matching Query displays its Results.

    Submitting a Query with no matches displays an empty result state.

    A network failure displays SearchError and permits retry.

    Cancelling during Loading prevents the response from updating the screen.

    Two requests completing out of order leave the latest request authoritative.
  }
}
```

These are Design Facets before a test suite exists. A Case does not need a test
filename to become meaningful.

Tests can describe corresponding setup, actions, and assertions. That supports
several distinct questions:

- Does the test exercise the Case's situation?
- Do its assertions agree with the Case's expected observations?
- Does production behavior satisfy the Case?
- Was the test actually executed, and did it pass?

A matching test name answers none of those by itself. Test expectations are
not production behavior; a mocked helper is not the real helper. Static
interpretation of a test is not test execution.

Quantification also matters. One example is not silently a requirement for all
inputs. An outcome that must occur differs from one that may occur. Keep that
distinction in the authored meaning rather than letting the compiler guess.

## Decisions explain; Constraints require

A binding rule and its rationale should be connected without being confused.

```sigil
constraints {
  ResultAuthority {
    Only the active request may publish Results.
  }
}

decisions {
  ResultAuthority {
    Keep one active request authoritative because completion order is not
    submission order.

    Allowing every response to publish was rejected because the screen could
    revert to an older Query.
  }
}
```

ResultAuthority connects the contributions. The Constraint states the rule.
The Decision explains the choice and records the alternative that was rejected.
A rejected alternative is not a backlog item.

Decision Facets can include scope, assumptions, trade-offs, consequences, and
revisit conditions. No fixed form requires every field. Preserve enough context
to evaluate the choice later; express binding restrictions as such rather than
burying them in the rationale.

## What the structure lets a compiler ask

A Concept name connects contributions. It does not prove they are equivalent,
or that code implements them. Interface exports establish shared vocabulary,
not implementation evidence.

The structure does make sharper questions possible: which operation does this
Constraint restrict? Which State quantity controls that branch? Which Case
exposes the difference? Which native Facets and code observations support the
answer?

For example, a reconstructed implementation might allow an older response to
publish. A useful diagnostic connects that current path to Search's
response-authority Constraint and out-of-order Case, with the source locations
and distinguishing situation that establish the disagreement. It does not mark
every Facet under Search as wrong.

The [behavior algebra](packages/eqval/behavior_algebra.md) defines the proposed
calculation: independently reconstruct design and code meaning, preserve their
relevant distinctions, and compare at an explicit boundary. Several Concepts
can participate in that boundary. A property proof is not automatically a
whole-component proof, and missing or unsupported meaning remains unresolved.
The calculation is conditional on faithful source interpretation.

Sigil supplies the organization. The eqval still has to do the mathematics.

## Examples in this repository

| Source | What to inspect |
| --- | --- |
| [Parser](packages/core/src/parser.sigil) | Multiple Concepts; EmbeddedFacet across Logic, Constraints, and Cases; ParseResult connecting public results to parsing and recovery scenarios. |
| [Source model](packages/core/src/model/source.ts) | Facet and EmbeddedFacet represent complete authored contributions; EmbeddedContent holds the fenced payload. Legacy serialized field names remain transport details. |
| [Workspace pipeline](packages/core/src/pipeline.sigil) | Explicit stage ordering, result assembly, and diagnostic deduplication, with stage behavior retained by separate owners. |
| [Model module](packages/core/src/model/_module.sigil) | Public assembly of independently owned model domains. |
| [Core package module](packages/core/_module.sigil) | Nested assembly of model and operational surfaces without taking over their responsibilities. |
| [Design conversation](integrations/skills/sigil/design-conversation.sigil) | Several Concepts, including DesignConversation across Interface, State, Logic, Constraints, and Cases. Components can describe workflows, not just APIs. |
| [Skill module](integrations/skills/sigil/_module.sigil) | Workflow components assembled into a public surface while retaining their own contracts. |

These are examples of authoring, not substitutes for the canonical definitions
above. Tooling that recognizes only Concept headings as public vocabulary has
not yet implemented the full Interface export model.
