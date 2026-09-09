# Sigil: give the design a language

Sigil gives a software design somewhere to live besides someone's memory.

It describes the things a system contains, the promises they make, the ways
they behave, and the reasons behind their boundaries. The writing stays close
to how people explain software. The structure makes those explanations
addressable, reusable, and connected.

The central container is the **Component**. A Component can contain arbitrarily
many Concepts; each Concept groups Facets about one identifiable part of that
component's design. The seven contracts give those Facets their roles. Another
contract can pick up any of the same Concepts and add another part of their
meaning. Another component can import the public vocabulary. A module can
assemble those components into a larger design.

This document records the intended language, including the author's
clarifications about native Facets and Interface exports. Those clarifications
take precedence over narrower descriptions in `spec/sigil-language.md` and
over current implementation limitations. Examples explain language semantics;
they are not a claim that every described capability is implemented today.

## Meet the pieces

| Piece | Its job |
| --- | --- |
| **Component** | Names a coherent responsibility and presents its public contract. |
| **Contract** | Gives a contribution its semantic role: Goal, Interface, State, Logic, Constraint, Decision, or Case. |
| **Concept** | Gives one semantic idea an identity shared across contracts. |
| **Facet** | States one part of the design, directly under a contract or grouped under a Concept. |
| **Embedded Facet** | Expresses a contribution in fenced content using a language or notation suited to it. |
| **Expand** | Adds operational detail to an existing component. |
| **Export** | Makes public vocabulary available across a component boundary. Interface definitions establish exports. |
| **Import** | Brings another component's public contract and exported vocabulary into scope. |
| **Module index** | Assembles an explicit public surface from locally declared and imported components. |

A Component is an ownership boundary. A Concept is a shared semantic identity.
A Facet is an actual contribution to the design. Keeping those roles distinct
lets one idea travel through a system without losing who said what about it.

## Component, Concepts, Facets: the levels of detail

The semantic granularity is **Component -> Concepts -> Facets**. Component is
the core container, not a wrapper around a single Concept. There is no
one-Concept-per-component rule or fixed limit on the number of Concepts a
component can contain. A search component might contain Search, Selection,
SearchError, and ResultOrdering, each with its own Facets and relationships.

Contracts cut across that organization. Interface can describe several
Concepts; State, Logic, Constraints, Decisions, and Cases can return to those
same Concepts as needed. Repeating Search in another contract adds Facets to
Search, not a second Search and not another component.

```text
Component SearchPanel
  Concept Search
    Interface Facets: submit and cancel promises
    State Facets: request lifecycle
    Logic Facets: response handling
    Constraint Facets: publication restrictions
    Case Facets: success, failure, cancellation
  Concept Selection
    Interface Facets: selecting and clearing a result
    Case Facets: selection behavior
  Other Concepts as the design needs them
  Ungrouped Facets contributed directly under contracts
```

This is a picture of semantic organization, not extra nesting syntax. In the
source, Concept blocks sit inside contracts. Facets may also sit directly
under a contract when no Concept grouping is useful. Facets are the finest
native authored contributions; breaking their meaning into smaller units for
calculation does not introduce another authored container level.

## Seven contracts, seven useful questions

Sigil has seven contract kinds. Their source spellings are `goal`, `interface`,
`state`, `logic`, `constraints`, `decisions`, and `cases`.

| Contract | The question it answers | What belongs here |
| --- | --- | --- |
| **Goal** | Why does this exist? | Purpose, responsibility, intended outcomes, the need being served. |
| **Interface** | What can others use or observe? | Operations, inputs, outputs, events, errors, public Concepts, and vocabulary dependents can reference. |
| **State** | What situations can it be in? | Meaningful data, configurations, modes, and lifecycle conditions. |
| **Logic** | How does it behave? | Flows, transformations, algorithms, guards, sequencing, and transitions. |
| **Constraint** | What must remain true? | Invariants, prohibitions, bounds, ownership, architectural rules, and binding choices. |
| **Decision** | Why was this approach chosen? | Context, alternatives, assumptions, trade-offs, consequences, and reasons to revisit. |
| **Case** | What happens in this situation? | Happy paths, sad paths, examples, edge conditions, recovery, and observable scenarios. |

These contracts describe different aspects of the same design. They are not
seven unrelated documents, and a Concept does not need an appearance in every
one to be useful.

A Constraint can say that retries are bounded. A Decision can explain why the
bound was chosen. A Case can describe what happens when it is reached. Together
they tell a much better story than three disconnected sentences.

## One Concept, several views

Consider a search screen:

```sigil
component SearchPanel {
  goal {
    Help the user find a record without losing their place in the application.
  }

  interface {
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
      Keep the latest request authoritative so slow responses cannot rewind
      the user's search.
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

Every `Search { ... }` above refers to **the same Concept**. Interface does not
create an interface-shaped Search while State creates an unrelated state-shaped
Search. The identifier connects their Facets.

`Selection` is another Concept in the same SearchPanel component, with its own
Interface and Case Facets. Search and Selection do not become the same Concept
because they share a component, and neither must appear in every contract.

Those contributions accumulate. A later block does not replace an earlier
one. The cancellation operation, loading condition, response-order restriction,
and failure scenario remain individually attributable parts of one design.

Concept identity follows the language's resolved scope. Repeating an accessible
Concept across the contracts of its component and matching expands preserves
that identity. Imported Concepts retain their originating identity when reused
in the appropriate consumer context. Coincidentally spelling two unrelated
local declarations the same way does not silently merge their owners.

Concept blocks are flat. Their identifiers provide the shared identity; their
bodies contain Facets. Nesting another Concept inside a Concept is not how
Sigil expresses relationships. Use separate Concepts and describe the
relationship between them.

Names should be recognizable and reusable. `Search` is usually more useful
than a name that attempts to squeeze the entire paragraph into one identifier.

## Facets are the statements, not just the headings

**Facet is a native language primitive.** The statements under a contract are
Facets, whether or not a Concept groups them.

In this fragment, `Search` is the Concept and the two statements are two Facets:

```sigil
constraints {
  Search {
    A cancelled request cannot publish Results.

    An older response cannot replace a newer result.
  }
}
```

A Facet can also appear directly under its contract:

```sigil
constraints {
  Network access goes through the application transport boundary.
}
```

That statement still has meaning, ownership, a contract kind, and a source
location. A Concept block gives related Facets a reusable shared identity; it
is not what makes their contents Facets in the first place.

One empty line ends an ordinary Facet. Adjacent prose lines continue the same
Facet; a newline alone does not end it. Use one empty line to
separate contributions that should be discussed, compared, and located
independently.

An Embedded Facet uses fenced content instead. These are the two forms: a
Facet and an Embedded Facet.

The existing parser and frontend use terms such as `SemanticUnit` and
`LiteralBlock`. Those implementation terms do not make Facet an invented
kernel-only abstraction. The kernel consumes the language's Facets and their
structure; it does not introduce Facets by naming an entire Concept block.

### A Facet can draw, calculate, or speak another language

Prose is convenient, but some ideas are better expressed as a diagram, a
formula, a data shape, or a piece of code. An Embedded Facet uses a
triple-backtick block with a language label:

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

The introducing statement and diagram express one Embedded Facet. Blank lines
inside its fenced body do not end it; its closing fence delimits the embedded
content. The diagram does not become a collection of new Sigil declarations
because it contains arrows, labels, or braces.

The embedded language may be Mermaid, TypeScript, Rust, SQL, JSON, mathematics,
or another notation suited to the idea. Sigil preserves that representation;
the label tells its reader how to interpret it. A fenced body is not
automatically executed by the compiler.

A Facet's **contract** still determines its role. A TypeScript snippet in Cases
can illustrate a scenario. A JSON shape in Interface can define a public
representation. A Mermaid diagram in Logic can describe a flow. The notation
does not turn all three into implementation code.

## Interface gives the vocabulary a passport

Interface publishes more than a list of callable functions.

**Identifiers defined in Interface are exported vocabulary.** This includes
Concept identifiers and meaningful identifiers or domain keywords defined
inside their Facets. Those names are available for other Sigils to import and
use in their own descriptions.

For example:

```sigil
component RecordSearch {
  goal {
    Find records matching a caller's search request.
  }

  interface {
    Search {
      Query is the caller's search text and selected filters.

      Results is the ordered collection of matching records.

      SearchError describes why a request could not complete.

      submit(Query) produces Results or SearchError.
    }
  }
}
```

`Search` is a public Concept. `Query`, `Results`, `SearchError`, and `submit`
are identifiers defined in its public Facets. They are not required to have
their own Concept blocks merely to become part of the exported vocabulary.
An exported identifier and a Concept are therefore related notions, but not
synonyms.

Definition matters. Every English word in an Interface does not become an
export. The vocabulary consists of identifiers the Interface establishes and
references whose existing identity is already known. Merely mentioning an
imported name does not declare a second owner for it.

This is the language's export mechanism at the semantic level. The examples
use Interface declarations and named imports; they do not invent a separate
`export` statement or a second declaration language inside prose.

### Imports bring the public meaning into scope

```sigil
@search/record-search.sigil import { RecordSearch }

component SearchPage {
  goal {
    Make record search available from the main application screen.
  }

  interface {
    SearchScreen {
      Accept a Query and display Results returned by RecordSearch.

      Present SearchError with a way to try again.
    }
  }
}
```

The import makes RecordSearch's public contract and exported vocabulary
available to SearchPage. `Query` and `Results` are connected references, not
two new local terms guessed from similar spelling.

Imports resolve from the workspace root through `@path`. An explicit `.sigil`
path selects that source. A directory path resolves through its `_module.sigil`.
The examples use component imports to carry their public vocabulary; this
document does not prescribe additional fine-grained import syntax.

An import establishes access to public meaning. It does not copy a provider's
private State, Logic, Constraints, Decisions, or Cases into the consumer's own
contract. Nor does it prove that the consumer calls a particular implementation
function at runtime. Those relationships need their own Facets or observations.

### Public identity, local contribution

A consumer can contribute Facets about an imported Concept in its own context.
The Concept keeps its identity, while the new contribution keeps its consumer
ownership. For example, a consumer's display restriction on Results does not
silently rewrite the search provider's result-production contract.

This distinction keeps dependency direction understandable: consumers learn the
provider's public meaning; providers do not change whenever a consumer adds
local detail.

Names introduced only in operational contracts remain private unless they are
also part of the public Interface. Exporting a Concept does not export every
private Facet that happens to describe it.

## Components and expands: the promise and the detail

A component declares a coherent system part. It can describe an API, a screen,
a parser, a data model, a workflow, a library, or an architectural boundary.
It need not correspond to one class, source file, or running process.

The public declaration contains Goal and Interface:

```sigil
component Name {
  goal {
    The responsibility this component exists to fulfill.
  }

  interface {
    PublicConcept {
      The promise available to a dependent.
    }
  }
}
```

An `expand Name` contributes State, Logic, Constraints, Decisions, and Cases.
It describes the same component in more detail. It can sit next to the code it
explains even when the public declaration lives elsewhere.

Multiple matching expands contribute collectively. They do not select a
winner, overwrite one another, or create subclasses. A cross-file expand
imports its owning component so that the attachment is explicit.

Conflicting Facets remain a design conflict. File order cannot make an
invariant disappear.

Some Facets are ungrouped, some Concepts span several contracts, and others
appear only once. The structure should express the design that exists, without
requiring authors to fill seven boxes for every idea.

## Cases are where the design meets a situation

A Case describes a scenario. It may establish an initial situation, an action
or sequence of actions, and an expected result or observable trace.

Happy paths belong here. So do rejection, cancellation, retry, empty results,
partial failure, and awkward timing:

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

These are design Facets even before a test suite exists. A reader can use them
to understand the component, and a semantic compiler can compare them against
reconstructed behavior.

Tests can exercise Cases. Their setup, actions, and assertions can be matched
to the scenario's initial conditions, stimulus, and expected outcome. That
opens useful questions: is this Case exercised, does the test assert the right
result, and does the implementation permit the described behavior?

Those questions are distinct from whether a test was executed and passed.
Cases are not test files, test names are not semantic matches, and representative
scenarios do not automatically specify every possible execution.

## Decisions remember why; Constraints keep the rule

Suppose a component uses a single authority for publishing results:

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

The shared `ResultAuthority` Concept connects the binding rule to its rationale.
Removing the rationale would lose understanding. Removing the Constraint would
lose the explicit requirement. They serve different purposes.

Decision Facets can describe assumptions, alternatives, trade-offs, scope,
consequences, and revisit conditions. They do not need a rigid form with every
field completed. A discarded alternative is not an instruction to implement it.

## `_module.sigil`: assemble the neighborhood

A directory often contains several cohesive components. `_module.sigil` gives
that directory an explicit assembly surface:

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

A consumer can address that assembly through a directory import:

```sigil
@search import { SearchFeature, RecordSearch }
```

The module index contributes its local components and the component names
resolved by its explicit imports. It does not automatically sweep every file
below the directory into the public surface. An explicit file import can still
address a public component in its own source.

Module assembly can be layered. One module can assemble several domain modules,
and a package module can assemble that model surface alongside operational
components. This gives the design a higher-level composition structure while
each imported component keeps its own Concepts, Facets, and responsibilities.

A module's own Facets explain the assembly boundary and any responsibilities
it actually owns. They do not replace the imported contracts with a vague
summary. A summary saying “provide search” does not discharge every promise
inside RecordSearch.

Keep namespace assembly and runtime composition distinct. A module can expose
a parser and a formatter without claiming that parsing calls formatting. A
pipeline can explicitly own calling stages in order. Both are compositions,
but they mean different things.

## The repository already tells this story

These are concrete examples of the language in use:

| Example | What to notice |
| --- | --- |
| [Parser](packages/core/src/parser.sigil) | `LiteralBlock` connects Logic, Constraints, and Cases. `ParseResult` connects the public result to successful parsing and recovery scenarios. |
| [Workspace pipeline](packages/core/src/pipeline.sigil) | Imported resolver, graph, and glossary components retain their behavior; the pipeline owns ordering, assembly, and diagnostic deduplication. |
| [Core model module](packages/core/src/model/_module.sigil) | A public model namespace is assembled from independently owned domain contracts. |
| [Core package module](packages/core/_module.sigil) | The package assembles both that model module and operational components without absorbing their responsibilities. |
| [Design conversation](integrations/skills/sigil/design-conversation.sigil) | `DesignConversation` spans Interface, State, Logic, Constraints, and Cases, showing that the structure also describes a workflow. |
| [Skill module](integrations/skills/sigil/_module.sigil) | Imported workflow components form a portable public surface while operational policy remains with each owner. |

These files are examples of existing authoring, not substitutes for the language
semantics clarified here. In particular, a tool that currently recognizes only
Concept headings as public vocabulary has not captured the full Interface
export model described above.

## What this gives a semantic compiler

Sigil hands the compiler a design that is already organized:

```text
Component is the core container and owns the responsibility.
Its arbitrarily many Concepts organize finer-grained parts of that design.
Each Concept connects its contributions across contracts.
Facet carries an individual statement or structured representation.
Contract tells the compiler what role that Facet plays.
Interface exports reusable public meaning.
Imports connect the public contracts.
Module indexes assemble larger public surfaces.
```

The compiler should use that structure before inventing another organizing
system. A Search Concept's Interface operation, State configurations, Logic
transitions, Constraint, and Cases are connected inputs for reasoning.

For example, a reconstructed implementation might let an old response publish.
A useful explanation can connect that behavior to the affected Search Concept,
the response-authority Constraint, and the out-of-order Case, while pointing
to the individual Facets and code observations that establish the disagreement.

Sharing a Concept identity makes those checks possible; it does not assert
that all its Facets are equivalent. The compiler must derive their relationships
under explicit semantic laws. Likewise, public exports establish shared
vocabulary, not evidence that code implements its promises.

This is the foundation for a behavior algebra: preserve the language's native
identities, contributions, ownership, and visibility, then give each contract
kind appropriate primitives and laws for composing them.

## Write it so someone can pick up the thread

Choose one coherent responsibility per component. Name Concepts when their
identity helps connect or reuse meaning. Give separate Facets to statements
that deserve separate discussion. Put public definitions in Interface, behavior
in Logic, binding restrictions in Constraints, and their reasons in Decisions.

Use Cases to walk through what happens, including when things go wrong. Use a
diagram or another embedded language when it expresses the idea more clearly
than another paragraph. Let imports carry established vocabulary instead of
renaming the same idea at every boundary.

A good Sigil lets the next reader continue the design without first having to
reconstruct the conversation that created it.
