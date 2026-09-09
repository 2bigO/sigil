# From a publication promise to a distinguishing scenario

This is the end-to-end example for the current refactor design. It applies the
[behavior algebra](behavior_algebra.md#a-complete-example-across-design-and-code)
through the [architecture](ARCHITECTURE.md). It specifies a proposed calculation;
it is not an executed proof or a claim about today's compiler.

The useful result is small and concrete: differently written publication logic
has the same selected behavior, and removing cancellation produces an exact
situation in which code disagrees with design.

## 1. Start with the authored contributions

Component is the core container; contracts contain Facets. This component
describes one concept, so its Facets need no additional Concept wrapper.
Concept IDs are encouraged for distinguishing and connecting the several
concepts in larger components. This deliberately small example shows that
equality also works without a redundant grouping identifier.

```sigil
component SearchPublication {
  goal {
    Keep displayed Results aligned with the active uncancelled request.
  }

  interface {
    publish(ResponseId, IncomingResults) returns Published or Ignored.

    Published means IncomingResults became the current Results.

    Ignored means the current Results remain unchanged.
  }
}

expand SearchPublication {
  state {
    ActiveRequest identifies the request whose response is current.

    Cancelled records whether that request was cancelled.

    Results holds the currently published result.
  }

  logic {
    When ResponseId equals ActiveRequest and Cancelled is false, replace
    Results with IncomingResults and return Published.

    Otherwise preserve Results and return Ignored.
  }

  constraints {
    Stale or cancelled responses never replace Results.
  }

  decisions {
    Use the active request as authority because responses can arrive out
    of submission order.
  }

  cases {
    An active uncancelled response publishes its IncomingResults.

    A response for an older request is ignored.

    A response for the active request after cancellation is ignored.
  }
}
```

Each blank-line-delimited statement is a native Facet directly under its
contract. Component ownership, contract role, and the explicit publication
operation/value relationships connect the contributions. No Concept identifier
is needed to preserve attribution or calculate their joint meaning.

Interface defines public vocabulary including `publish`, `ResponseId`,
`IncomingResults`, `Published`, `Ignored`, and `Results`. Those definitions can
be imported without giving each a Concept block. State and Logic connect the
same resolved operation, values, and resource. A consumer's additional Facets
about this public operation keep their consumer context; they do not rewrite
the provider.

The interpretation supplies smaller units and their connections. It does not
emit a pre-proved claim that Publication is safe. Goal and Decision guide the
interpretation; the explicit Interface, Logic, Constraint, and Case meanings
establish the behavior to compare.

## 2. A different source can say the same thing

An independently interpreted Markdown requirement might say:

> Publish a response only if its request is still active and has not been
> cancelled. Return Published after replacing Results. Otherwise leave Results
> unchanged and return Ignored.

The Markdown source has its own anchors and source occurrences. Accepted
correspondence connects its operation and values to the selected public
vocabulary without merging source identities. Compare Markdown meaning and
Sigil meaning at an explicit common boundary if fidelity between those design
sources is required. Do not combine their assertions and call the combined
model evidence that they agree.

A shorter requirement saying only "ignore stale responses" does not establish
all the outcomes above. It can support its property view; missing meaning must
not be filled from the desired Sigil or code answer.

## 3. Declare what the comparison observes

Use two boundaries rather than letting a guard proof impersonate an operation
proof:

| Part | Admission boundary | Operation boundary |
| --- | --- | --- |
| Subject | SearchPublication's admission condition | Its selected public operation and contributing Facets |
| Target | One implementation target at a time | The same target, with its complete supported operation meaning |
| Inputs | Request-match and cancellation conditions | ResponseId, IncomingResults, and starting ActiveRequest, Cancelled, Results |
| Observations | Whether publication is admitted | Ordered publication actions, returned alternative, and next relevant state |
| Assumptions | Corresponding pure, total Boolean meanings | Corresponding request equality, ordinary infallible assignment, no hidden getter/setter effects, no concurrent state mutation |
| Value meanings | Boolean | Explicit request identities, result payloads, and Published/Ignored alternatives |

For a first fully finite operation fixture, choose request identities
`{r0, r1}`, result payloads `{v0, v1}`, and Boolean cancellation. ResponseId and
ActiveRequest independently range over the two request identities; IncomingResults
and existing Results independently range over the two payloads. This defines
32 input/starting-state combinations, not a sample of an unstated larger domain.

These are declared fixture domains and assumptions. Equality on them is not
unrestricted equality for every real request or payload. Extending the claim
requires supported value semantics and a proof, for example of identity testing
and unchanged payload forwarding over the larger domain. The kernel must not
infer that extension from the four admission rows below.

## 4. Reconstruct code without the expected answer

Python can use early returns:

```python
def publish(state, response_id, incoming):
    if response_id != state.active_request:
        return Ignored
    if state.cancelled:
        return Ignored
    state.results = incoming
    return Published
```

TypeScript can use a positive branch:

```typescript
function publish(state, responseId, incoming) {
  if (responseId === state.activeRequest && !state.cancelled) {
    state.results = incoming;
    return Published;
  }
  return Ignored;
}
```

These snippets illustrate control flow, not complete executable fixtures. Their
language-specific equality and object operations are not assumed identical
merely because they look alike. Each independent reconstruction must establish
its supported mapping and state the assumptions needed by the comparison.

The implementation semanticizer receives its captured source, fixed observation
vocabulary, and authorized identity/type descriptors. It does not receive the
Sigil prose, expected guard, Cases, tables, or verdict. It emits source-local
inputs, reads, checks, branches, assignments, and outcomes with source support.
No direct `provides(CancellationSafety)` or equality assertion is accepted as
the operation's proof.

The accepted local mapping must identify the assignment's target as the public
Results resource and its assigned value as IncomingResults. The compiler does
not label every assignment `publish`. Unknown correspondence or hidden effects
leave the relevant comparison Unresolved.

Python and TypeScript are separate targets here. Neither supplies the other's
missing branch or behavior. Within one target, cooperating files may compose
only through explicit supported links.

## 5. Calculate admission

Let `m` mean the response matches the active request and `c` mean Cancelled.
Independent lowering yields:

```text
Design:              and(m, not(c))
Python early exits:  if(not(m), false, if(c, false, true))
TypeScript branch:   and(m, not(c))
```

For pure, total Boolean expressions, fixed laws reduce the Python structure:

```text
if(c, false, true) = not(c)
if(not(m), false, not(c)) = and(not(not(m)), not(c))
not(not(m)) = m
```

Egglog congruence carries the inner equalities into the larger term. None of
these unions merges source anchors or imports Design requirements into the
Implementation closure.

The complete admission table is:

| Matches active request | Cancelled | Design admission | Python admission | TypeScript admission |
| --- | --- | --- | --- | --- |
| false | false | false | false | false |
| false | true | false | false | false |
| true | false | true | true | true |
| true | true | false | false | false |

A completed calculation of these tables establishes equality of the Boolean
admission function. Symbolic proof supplies an explanation of the different
formulations. This establishes neither the written payload nor the returned
alternative; those belong to the next comparison.

## 6. Compose the complete selected operation

For each permitted input and starting state, reconstruct the joint result:

| Guard | Ordered actions | Outcome | Next relevant state |
| --- | --- | --- | --- |
| `m AND NOT c` | `publish(Results, IncomingResults)` | `Return(Published)` | Results = IncomingResults; ActiveRequest and Cancelled unchanged |
| Otherwise | None | `Return(Ignored)` | Unchanged |

Each independent model must cover the whole declared finite domain with its
complete behavior. A missing branch is not an empty branch. An explicit no-op
still supplies an outcome and unchanged state. Overlapping deterministic
branches with conflicting results are a model conflict, not alternatives to
merge away.

The comparator compares complete joint observations, not independent sets of
writes, outcomes, and states. It must preserve that Published goes with
publication of the incoming payload, and Ignored goes with no publication and
unchanged state. For the finite fixture, the proposed proof obligation covers
all 32 combinations; this document has not run that proof.

A larger rule can now recognize the publication behavior from the equivalent
guard, its mapped action, outcome, and state update. This is the higher-level
structure the kernel computes. It was not supplied as a terminal capability.

Correct admission with a wrong payload, a swapped return alternative, or an
extra visible write is still Different at this operation boundary. That is
why the operation milestone is separate from the Boolean milestone.

## 7. Remove cancellation and calculate the disagreement

After removing Python's cancellation branch, fresh implementation meaning has
admission `m`, rather than `and(m, not(c))`.

A distinguishing situation inside the declared fixture domain is:

```text
ResponseId = r0
ActiveRequest = r0
Cancelled = true
Results = v0
IncomingResults = v1

Design:
  actions: none
  outcome: Return(Ignored)
  next Results: v0

Changed Python:
  actions: publish(Results, v1)
  outcome: Return(Published)
  next Results: v1
```

The fresh comparison is Different. It does not depend on a textual diff, the
old projection, or asking the model whether cancellation was required.

The report retains the boundary, target, finite domain, assumptions, current
source bindings, laws, and premise support. Its explanation connects the
current publishing path to the relevant native contributions:

| Contribution | What the witness disagrees with |
| --- | --- |
| Interface Facet defining Ignored | The rejected case does not preserve Results and return the required alternative. |
| Logic Facets | The changed branch admits a situation that belongs to the otherwise-preserve path. |
| Constraint Facet | A cancelled response replaces Results. |
| Cancelled-response Case | This represented scenario publishes instead of being ignored. |

These are supported links through the operation, guard, resource, value, and
outcome. Do not mark every Facet in SearchPublication wrong merely because it
shares the component. The unaffected target may still be Equal; an aggregate
requiring both targets reports Drift because Python differs.

The removed check has no current span. Its historical location may help explain
the edit, but the fresh witness points to the current admitting/publishing path
and the authored Facets. Exact support need not identify a unique minimal fix.

## 8. Cases and tests ask related but different questions

The cancelled-response Case becomes:

```text
given:   ResponseId = ActiveRequest AND Cancelled
actions: publish(ResponseId, IncomingResults)
expect:  Return(Ignored), no publication, unchanged relevant state
```

This is a family of scenarios, including the witness above. A concrete Case
would instead select a particular input/starting state. Keep required and
permitted outcomes distinct; ambiguity is not permission to invent a universal
requirement.

A test can independently describe the same setup, invocation, and assertions.
The compiler can compare those expectations with the Case. A test that asserts
Ignored but mocks the real publication operation does not establish production
behavior, and no static comparison says the test was executed. Happy and sad
Cases remain meaningful even when no test file exists.

## 9. Follow a change through freshness and impact

```text
Before edit:
  accepted source bindings -> complete supported comparison -> Equal

Source edit detected:
  old Python projection excluded from current truth
  last-known mapping may identify SearchPublication and origin material
  affected current comparison is Unresolved until sufficient fresh meaning exists

Fresh changed projection accepted:
  recompute independent Python meaning
  derive distinguishing situation -> Different
```

Impact is available before fresh semantic understanding. It says which surfaces
may be affected, not that the design must change or its source bytes are stale.
Historical paths require compatible binding/generation support. They cannot
retain Equal or prove the fresh discrepancy.

Results name captured manifests. Currentness is checked at validation; Snapdir
hashing does not freeze the source tree. Changes to accepted content or laws
invalidate dependent proofs even if the source bytes remain unchanged.

## 10. Carry the capability outward without overstating it

A module may expose SearchPublication alongside other components. That permits
a public-surface comparison, not an assumption that every exposed behavior is
implemented. A consumer can use its public identifiers and add contextual
Facets without changing this provider's requirements. No Concept wrapper is
required for those ungrouped Interface definitions to be public.

Delegating publication to a helper requires the helper's independently
reconstructed behavior, an explicit call link, argument/state mapping, and
compatible assumptions. Its name or signature cannot supply that behavior.

PreparedBinding's source-match, incoming-anchor, and expected-generation guards
can later use the same pure-decision laws. Its actual publication safety also
requires ordering, failure, locking, and concurrent-publication semantics.
Finding a check before a write is not proof of atomic compare-and-swap.

The completion criterion is the algebra's
[first useful implementation](behavior_algebra.md#the-first-useful-implementation):
compute the supported behavior, compare it under a declared boundary, and
explain exactly which observation differs and which current source contributions
establish that difference. Missing semantics remains Unresolved.
