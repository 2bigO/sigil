# Sigil: give the design a language

You search for `cat`. Then you change your mind and search for `capybara`.

The capybaras arrive. A moment later, the slower first request finishes and
replaces them with cats.

Every request succeeded. The screen is still wrong.

Somewhere, somebody knew the rule: **an old response must not replace the latest
results.** Perhaps they said it in a meeting. Perhaps it survived in a review
comment. Perhaps it was obvious to everyone until the person who found it
obvious left the team.

Sigil gives that rule somewhere to live:

```sigil
constraints {
  Search {
    A response from a replaced request must not overwrite current Results.
  }
}
```

That is not a comment asking politely to be remembered. It is an addressable
part of a design, connected to the search operation, its state, its failure
scenarios, and the reason this rule exists.

Let's build the rest of that picture.

## Give the idea a home

The central container in Sigil is a **Component**. It owns a responsibility:
searching records, displaying a screen, parsing a language, conducting a design
conversation. It does not have to correspond to one class, file, or process.

Inside a component, **Concepts** name the parts worth talking about. A search
panel might have Search, Selection, ResultOrdering, and SearchError. There is
no fixed limit and no one-Concept-per-component rule. Use as many as the design
needs.

Inside those Concepts, **Facets** say particular things about them.

```text
Component -> Concepts -> Facets
```

Think of zooming in: the search panel, its selection behavior, the promise that
clearing a selection leaves the results alone.

Here is the panel's public face:

```sigil
component SearchPanel {
  goal {
    Help someone find a record and choose the one they need.
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
```

One component. Two Concepts. Several Facets. Search and Selection are related,
but they are not the same thing, and neither needs a component of its own just
to get a name.

You may have noticed another layer in the source: `goal` and `interface`. Those
are **contracts**. They tell us what question a contribution answers.

## Ask seven good questions

A design gets easier to understand when it answers more than "what functions
are in this file?"

Sigil has seven contracts:

| Contract | Ask this | Write about |
| --- | --- | --- |
| `goal` | Why does this exist? | Purpose, responsibility, intended outcomes. |
| `interface` | What can someone use or observe? | Operations, inputs, results, events, errors, and public vocabulary. |
| `state` | What situations can it be in? | Data that matters, configurations, modes, lifecycle conditions. |
| `logic` | How does it behave? | Calculations, guards, flows, ordering, delegation, transitions. |
| `constraints` | What must remain true? | Invariants, prohibitions, bounds, ownership rules. |
| `decisions` | Why this approach? | Choices, alternatives, assumptions, trade-offs, reasons to reconsider. |
| `cases` | What happens in this situation? | Happy paths, sad paths, examples, edge conditions, recovery. |

These are seven views of a design, not seven unrelated documents. Each contract
can discuss several Concepts. Each Concept can appear in whichever contracts
have something useful to say about it.

There is no prize for filling every box. A Concept with one useful Facet is
better than seven paragraphs written to satisfy a template.

## Same Concept, next chapter

The public declaration tells a caller what the panel promises. An **expand**
tells more of the story about that same component:

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
      out of order.
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

Follow `Search` through those sections. It is **the same Concept every time**.
Interface describes its public operations. State describes its situations.
Logic describes its behavior. Constraint, Decision, and Case tell us what must
hold, why, and what that means when the network has other plans.

`Selection` has its own thread through Interface and Cases. Sharing a component
does not mix its Facets into Search's Facets.

This is why identifiers matter: they connect contributions without asking the
reader to guess whether five differently worded paragraphs concern the same
thing.

Names still have scope. Reusing an accessible Concept in its component and
matching expands preserves its identity. Two unrelated components independently
naming something `Search` do not accidentally become roommates. Imports make
cross-component sharing explicit; we will get to those shortly.

Concept blocks are flat: they contain Facets, not nested Concepts. If two
Concepts are related, give each its own name and describe the relationship.
`Selection` can refer to a `Result` without nesting a Result Concept inside it.

## The paragraphs have a job too

A **Facet** is an individual contribution to the design. Not the Concept heading;
the statement underneath it.

```sigil
constraints {
  Search {
    A cancelled request cannot publish Results.

    An older response cannot replace a newer result.
  }
}
```

`Search` is one Concept. Those are two Facets.

**One empty line ends an ordinary Facet.** A newline alone does not: you can wrap
a sentence over adjacent lines without breaking it into separate contributions.
A Facet can contain several related clauses; it is an authored unit, not a
requirement to put every verb in its own paragraph.

Facets are the finest native pieces you write. They can be discussed, connected,
and located individually. A compiler may break their meaning into smaller
calculations, but you do not have to write that machinery into your design.

A Facet does not need a Concept heading when grouping it would add nothing:

```sigil
constraints {
  Network access goes through the application transport boundary.
}
```

That is still a Facet, with its component owner and contract role. You do not
need to invent `NetworkAccessMustGoThroughTheTransportBoundary` just to give the
sentence permission to exist.

## Sometimes the right sentence is a diagram

Try describing a state machine entirely in prose. At some point, an arrow
starts looking very attractive.

An **Embedded Facet** lets you use the notation that fits:

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

The introducing prose and fenced content make one Embedded Facet. The opening
triple backticks name its language; the closing fence ends the embedded content.
Blank lines inside the fence do not end the Facet. Braces and arrows inside it
do not become new Sigil declarations.

Mermaid is one choice. A Facet can speak JSON, SQL, TypeScript, Rust, mathematics,
or another notation suited to the idea. You do not have to translate a clear
diagram into awkward prose just to keep it in the design.

The surrounding contract still supplies the role. JSON in Interface can define
a public shape. Code in Cases can illustrate a scenario. A diagram in Logic
can describe a flow. A language label is not an instruction to execute the
block, and code-shaped design is not automatically production code.

So there are two forms to reach for: an ordinary Facet, or an Embedded Facet.
Same design, different means of expression.

## A promise outside, the details nearby

A `component` declaration contains **Goal and Interface**: why it exists and
what it makes available. An `expand` contributes **State, Logic, Constraints,
Decisions, and Cases**.

They describe the same component. An expand is not a subclass, replacement, or
second owner. Several matching expands add their contributions collectively.
A later file cannot win an argument by overwriting an earlier Facet. Conflicting
promises remain a design conflict, not a file-order trick.

An expand can live beside the code whose behavior it explains. If it lives in
another file, it imports its component so the attachment is explicit:

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

The public promise can stay easy to find without requiring every operational
detail to live in the same long document.

## Give the vocabulary a passport

Eventually, another screen wants to use search. It should not have to invent
its own definition of Results and hope the two definitions stay friends.

**Interface definitions are exports.** That includes Concept identifiers, but
also operations, names, and domain keywords defined inside their Facets.

Suppose the reusable search provider says:

```sigil
component RecordSearch {
  goal {
    Find records matching a caller's search request.
  }

  interface {
    Search {
      Query is the caller's search text and selected filters.

      Result is one matching record.

      Results is the ordered collection of matching Result records.

      SearchError describes why a request could not complete.

      submit(Query) produces Results or SearchError.
    }
  }
}
```

`Search` is a public Concept. `Query`, `Result`, `Results`, `SearchError`, and
`submit` are public identifiers defined within its Facets. None needs a Concept
block of its own merely to be exported.

Definition is the important word. Interface does not export every English word
it contains. Nor does mentioning an imported identifier declare a second owner
for it. There is no extra `export` ceremony here: Interface establishes the
public vocabulary.

A consumer imports the component:

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

Now Query and Results mean the provider's Query and Results. They are connected
references, not fresh local definitions wearing familiar names. The component
import carries its public contract and exported vocabulary into scope.

`@path` resolves from the workspace root. An explicit `.sigil` path selects that
source; a directory path resolves through its `_module.sigil`.

### Share the name, keep the owner

A consumer can add Facets about an imported Concept in its own context. The
Concept keeps its originating identity; the contribution belongs to the
consumer.

For example, a page may add a presentation restriction about an imported Search
Concept. That does not rewrite the provider's search behavior upstream. The
page owns its presentation promise; the provider still owns producing results.

Imports bring public meaning, not a copy of every private State, Logic,
Constraint, Decision, and Case. Names introduced only in operational contracts
remain private unless they are also part of Interface. Exporting a Concept does
not expose all its private Facets.

And an import is not a runtime call. Knowing what another component offers and
actually invoking it are different relationships. Write the latter where the
behavior requires it.

## Let the neighborhood introduce itself

A feature often grows into several components. `_module.sigil` gives that group
an explicit public introduction:

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

A consumer can then address the directory:

```sigil
@search import { SearchFeature, RecordSearch }
```

The module exposes its locally declared components and component names resolved
through its explicit imports. It does not rummage through every file below the
directory and export whatever it finds. Explicit file imports remain available.

Modules can assemble other modules. A model module can gather several domains;
a package module can gather that model surface alongside parsers and workflows.
The picture gets larger without flattening everyone's responsibilities into
one giant component.

RecordSearch still owns search. SearchPage still owns presentation. The module
owns the assembly and whatever additional responsibility its own Facets state.
Saying "provide search" in the module is not a replacement for the actual search
contract.

Nor is it a secret execution plan. Exposing a parser and formatter does not
mean parsing calls formatting. A pipeline can explicitly say which operations
run in which order. Namespace assembly and runtime composition both matter;
they just answer different questions.

## Tell the story when things go wrong

Back to our cats and capybaras.

The ordinary search demo probably worked. The interesting Case was the one
where requests finished in the wrong order.

A **Case** describes a scenario: a starting situation, an action or sequence of
actions, and an expected result or observable trace. Happy paths belong here.
So do cancellation, empty results, partial failure, recovery, and awkward timing.

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

Cases exist before a test suite does. They help a reader walk through the design
and give a semantic compiler situations to compare with reconstructed behavior.

Tests can exercise Cases. Their setup, actions, and assertions offer useful
connections: does this test cover that scenario? Does it expect the right
result? What happens in production?

Those are separate questions. A matching test name proves nothing. A test's
assertion is not proof that production behaves that way, and reading a test is
not running it. A concrete example also does not silently become a requirement
about every possible input. Say "every stale response" when that is the rule;
say what happened in one situation when that is the example.

## Remember why, without making yesterday's bad idea a requirement

Someone will eventually ask why the latest request gets to be authoritative.
It may even be you, six months from now, looking at a tempting simplification.

Keep the rule and the reason close, but give them their proper roles:

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

The shared ResultAuthority Concept connects the two. The Constraint says what
must hold. The Decision remembers why it was chosen and which alternative lost.

A Decision can record assumptions, trade-offs, consequences, scope, and reasons
to revisit. It does not need a form with every field filled in. Most importantly,
a discarded alternative is not an instruction to implement it.

The useful future conversation is "does this reason still hold?", not "who put
this annoying check here?"

## Now the compiler has a better question

A pile of prose can say what a system should do. Sigil also gives those
statements identities, roles, owners, and connections.

That lets us ask more than whether the code mentions Search or exposes a method
called `submit`. We can ask whether an old response is allowed to replace
Results, and connect the answer to the exact Facets that say otherwise.

A useful explanation might read:

> An older response can reach this publishing step. That disagrees with Search's
> response-order Constraint and its out-of-order Case. Here are the design
> statements and the code observations that establish the difference.

That is the direction of Sigil's [behavior algebra](packages/kernel/behavior_algebra.md):
compare independently reconstructed design and code meaning at a declared
boundary, rather than equating names or counting matching promises. The
calculation depends on faithful source interpretation; a shared identifier is
a connection, not a proof of correctness. Unsupported or missing meaning must
stay unresolved.

One Concept's Facets are not all equivalent merely because they share its name.
They contribute different parts of a behavior. Several Concepts can participate
in the same operation. The point of the structure is to make those connections
available for reasoning without losing the individual statements behind them.

## Take a look around

Sigil also describes itself. These are good places to follow a Concept through
more than one contract:

| Visit | Follow the thread |
| --- | --- |
| [The parser](packages/core/src/parser.sigil) | `LiteralBlock` appears in Logic, Constraints, and Cases. `ParseResult` connects the public result to parsing and recovery. |
| [The workspace pipeline](packages/core/src/pipeline.sigil) | Separate owners supply resolution, graph, and glossary behavior; the pipeline owns ordering and assembly. |
| [The model module](packages/core/src/model/_module.sigil) and [core package module](packages/core/_module.sigil) | Watch modules assemble other surfaces without taking over their responsibilities. |
| [The design conversation](integrations/skills/sigil/design-conversation.sigil) | `DesignConversation` connects Interface, State, Logic, Constraints, and Cases. A component can describe a workflow, not just an API. |
| [The skill module](integrations/skills/sigil/_module.sigil) | Several workflows become one public assembly while keeping their own contracts. |

## Leave a thread someone can pick up

Start with a responsibility. Give it a Component. Name the Concepts that help
people talk about it, and write their Facets where the right question is being
asked.

You do not need seven sections of filler. You need the promise, the behavior,
the rule people might accidentally break, the situation that makes it matter,
and, when it helps, the reason you chose it.

Let a diagram do a diagram's job. Let imports carry established vocabulary.
Let a Case admit that the network sometimes delivers yesterday's answer last.

The next person should not have to reconstruct your meeting to understand your
design.

They should be able to pick up the thread.
