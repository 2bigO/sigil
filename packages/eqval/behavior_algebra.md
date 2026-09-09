# Behavior algebra

## What this is for

Sigil gives us an organized design. Code gives us an implementation. Markdown
may give us the original requirement. They describe related things using very
different shapes of language.

The purpose of this algebra is to make their **behavior comparable**. A design
can describe a rule in a sentence, Python can implement it with early returns,
and Rust can implement it with a match. We want to calculate whether those
descriptions have the same meaning at an explicit boundary.

The algebra does not attempt to make source files look alike. It preserves the
differences that affect behavior and gives equivalent formulations a common
meaning. Equality is its destination; the units below exist to make that
calculation possible.

This is a proposed eqval design grounded in the canonical
[language description](../../language.md). It supplies definitions and an
implementation direction for the eqval proposal and its audit. The examples
are specifications of the proposed computation, not executed proofs or claims
about features already implemented.

This document owns the semantic definitions. The [README](README.md) gives the
refactor direction, [architecture](ARCHITECTURE.md) specifies how to carry the
calculation, [example](example.md) follows it end to end, and [audit](AUDIT.md)
maps the remaining implementation work. They describe the same target design.

## Start with the language we have

Sigil already supplies the organization:

```text
Component: the owner of a responsibility
Concept:   optional named grouping across contract contributions
Facet:     an individual contribution to the design
Contract:  the role of that contribution
Export:    public vocabulary established by Interface
Import:    access to another component's public meaning
Expand:    additional contributions to the same component
Module:    an explicit assembly of public component contracts
```

Component is the core container; contracts contain Facets. Concept IDs expose
and connect the several concepts commonly present in real components. Encourage
that cross-contract grouping and preserve it as an explicit input to reasoning.
Smaller components may need no additional identifier, and every contract may
freely mix ungrouped Facets and Concept blocks. Equality works with either form;
useful grouping is an advantage, not a validity prerequisite.

An ordinary Facet ends at one empty line. An Embedded Facet carries fenced
content in a chosen language or notation. Both contribute meaning under their
contract and optional Concept. Their representation does not change their owner
or make their contents automatically executable.

Component ownership and explicit operation/value relationships connect
ungrouped Facets. Where Concept IDs are useful, `Search` in Interface, State,
Logic, Constraints, and Cases is the same resolved Concept. Preserve that
additional grouping rather than reconstructing it from similar words later.
Do not synthesize a Concept merely because a Facet has no Concept heading.

Exported identifiers inside Interface Facets are connections too. An operation,
result type, event, or other defined term need not be a Concept block to be
public vocabulary. A consumer importing `Results` means the provider's Results,
not a new local type whose spelling happens to match.

These identities tell us **what a statement concerns**. They do not tell us
whether its behavior is correct, nor do they equate all statements about the
same Concept.

## What equality means here

Before comparing anything, name what can be observed and under which conditions.

For a pure calculation, that can be its returned value for every permitted
input. For a stateful operation, it can include its result, visible actions,
and the state relevant to subsequent interactions. For an architectural rule,
it can be a precisely defined property of the component relationships.

Call this the **comparison boundary**. It contains:

| Part | Definition |
| --- | --- |
| Subject | The Concept, Facets, or component behavior being compared. |
| Implementation target | The cooperating implementation sources intended to realize that subject. |
| Inputs | The operations, arguments, and starting conditions under consideration. |
| Assumptions | Explicit conditions under which the comparison applies. |
| Observations | The results, events, relationships, and relevant state that count. |
| Value meanings | The types, units, error distinctions, and numerical rules in force. |

The boundary is part of the requirement. It cannot be narrowed after seeing
an implementation mismatch. An implementation's extra logging may be irrelevant
to one boundary and forbidden disclosure at another. Neither “ignore all
effects” nor “compare every machine instruction” is an acceptable default.

For a boundary `q`, let `X_q` be its permitted inputs and starting conditions.
Let `B_q(M, x)` be the set of possible complete observations of description `M`
under `x`:

```text
D = independently reconstructed design meaning
I = independently reconstructed implementation meaning

D equals I at q
    exactly when
for every x in X_q: B_q(D, x) = B_q(I, x)
```

A deterministic operation has one observation for each permitted input.
Nondeterministic behavior can have several. A missing description is not an
empty set of possible behaviors.

The practical first target is a finite domain and finite behavior descriptions
for which those sets can be constructed completely. Symbolic laws can prove
additional equalities without enumerating every input. Failed symbolic search
does not establish inequality.

### Do not ask a partial statement to specify a whole program

“A stale response never replaces current Results” specifies a restriction. It
does not say whether the implementation records a metric, returns an error,
or silently ignores that response.

We can compare its precise observation, such as whether a stale response
changes Results, against the required constant `false`. That proves equality
for that restriction. It does not prove equality of the entire operation.

A complete operation description can support a stronger comparison including
its return value, effects, and next state. The result must say which equality
was proved. Satisfying selected Facets is not automatically whole-component
equality.

Where a design permits a set of behaviors and an implementation chooses only
some of them, that may establish conformance. Set inclusion and set equality
are different relations. This document concentrates on equality and must not
report inclusion as equality.

## The small units underneath the contracts

The seven contracts are ways to contribute meaning. They are not seven
independent instruction sets. Much of their content can be expressed through
the same small units:

| Unit | Concrete meaning |
| --- | --- |
| **Value** | A Boolean, number, defined name, structured value, or resource identity. |
| **Expression** | A pure calculation of a value from inputs, state, or other values. |
| **Condition** | A Boolean expression restricting a situation or selecting behavior. |
| **State description** | Named quantities and conditions needed to describe ongoing behavior. |
| **Observable action** | An occurrence at the selected boundary, such as publishing, writing, or emitting an event. |
| **Outcome** | How an operation finishes or remains pending, including its result or failure. |
| **Step** | A guarded change relating a starting situation to actions, an outcome, and a next situation. |
| **Relationship** | A typed connection between identities, such as ownership, exposure, or invocation. |

These are proposed algebra units, not additional Sigil keywords. A source
semanticizer describes them using fixed, typed observations. The compiler
validates and composes those observations. It does not accept arbitrary laws
or a source-produced verdict that “the implementation is equivalent.”

### Values: preserve the distinctions that matter

Use a small collection of value forms:

```text
Boolean                  true | false
Number                   a value with explicit numerical meaning
Defined name             a resolved identifier, including an exported term
Sequence                 an ordered collection of values
Record                   named fields with values
Alternative              a named alternative with optional contents
Resource                 the identity of something acted upon
```

Examples of Alternatives are `Published`, `Ignored`, `Some(value)`, and
`Failed(NetworkError)`. They let a Python return convention, a Rust enum, and a
TypeScript object describe the same public result when their source observations
establish the correspondence.

Do not silently equate a missing field, a null value, an empty collection, and
an unknown observation. They can have different behavior. Unknown meaning is
not an ordinary value in the equality domain.

Numerical meaning must say what a number represents. Integer range, overflow,
rounding, units, and exceptional values matter when applicable. A fixed-width
integer operation and Python integer arithmetic can be equal on a restricted
range without being equal on every input. Floating-point reassociation is not
an unconditional mathematical law.

The first implementation should use Booleans, finite alternatives, and small
finite combinations of them. Add numerical operations only with a declared
meaning and sound laws.

### Expressions: calculate without changing the world

An expression reads a named input or state quantity, selects a field, constructs
a value, or applies an admitted pure operation:

```text
input(ResponseId)
state(ActiveRequest)
equal(input(ResponseId), state(ActiveRequest))
not(state(Cancelled))
and(equal(input(ResponseId), state(ActiveRequest)),
    not(state(Cancelled)))
```

These forms describe meaning; they are not source-language syntax. Each input
and state reference is bound to a resolved identity in the current context.

Operands have types. Operation meaning is fixed by the eqval's supported
vocabulary. An unknown call cannot be treated as a pure expression merely
because it returns a Boolean.

Short-circuit source code needs particular care. Reordering `a() && b()` is
unsafe if either call has an effect, can fail, or can fail to terminate. Pure
Boolean laws apply after those concerns have been excluded or represented in
the surrounding steps.

### Conditions: the same expression, used as a question

A Condition is a Boolean expression applied to a situation. It can describe:

- When an operation is permitted.
- Which branch executes.
- Whether a state has a named property.
- Which inputs a Case covers.
- Whether an observable behavior violates a Constraint.

These uses share Boolean meaning but retain their roles. An observed branch
condition is not automatically a Design precondition. A precondition can
restrict a comparison domain only if the design actually establishes it.

### State: enough memory to explain what happens next

A state description names the quantities or configurations relevant to the
selected behavior. It need not copy a database schema or object layout.

For search publication it might contain:

```text
ActiveRequest: request identity
Cancelled: Boolean
Results: current public result value
```

An implementation may store these in separate fields, one tagged value, a
reducer state, or several cooperating objects. It must independently describe
how its representation produces the comparison's state quantities.

A representation mapping is an explicit, attributable description, not a
rename inferred from similar labels. The eqval may evaluate a mapping expressed
with supported expressions; it must not accept a blanket assertion that two
state machines are equivalent.

The selected state must retain distinctions that can affect future observable
behavior. If two hidden configurations map to the same named state but respond
differently later, either the model must retain that difference or represent
the alternatives accurately. Hiding a relevant bit is not abstraction that
preserves equality.

### Observable actions: what happened, to what, with which value

Represent an observable action with a fixed kind, a target, and its contents:

```text
publish(Results, value)
write(Store, key, value)
emit(Topic, event)
invoke(Operation, arguments)
```

Only actions relevant to the declared boundary appear in its observation.
All source actions that might affect that boundary must nevertheless be
accounted for when deriving it. An unresolved call may conceal such an action.

Order and repetition are meaningful. Writing twice is not writing once.
Publishing before validation is not publishing after validation. The targets
of actions have identities: writing one store does not satisfy a requirement
about another merely because their names are similar.

An invocation can be an observable action when it crosses the boundary, or an
internal operation whose independently reconstructed behavior must be composed.
Its role must be explicit.

### Outcomes: how the interaction leaves its caller

At minimum, distinguish:

```text
Return(value)             completed normally
Fail(error)               completed with a defined failure
Pending(continuation)     waiting for an external event or later action
Diverge                  continues internally without completing
```

Cancellation can be a defined returned value, a failure, or a transition to a
pending/idle situation, depending on the contract. Do not normalize it into
success without an explicit public meaning.

An exception and a returned error can correspond at a public boundary if both
represent the same defined failure there. At a caller boundary that distinguishes
them, they are different outcomes. Capturing “it failed” alone may be too coarse.

Unknown or unsupported behavior is a gap in the description, not `Pending`,
`Diverge`, or `Fail`. Two gaps cannot prove equality to each other.

### Steps: put the pieces together

A Step relates a starting state and input to what follows:

```text
starting state + input
    when condition
    produces ordered observable actions
    and an outcome
    with next state
```

Its observable result is kept together:

```text
(actions, outcome, next relevant state)
```

Several guarded steps can describe alternatives. Conditions may overlap only
when the description intentionally admits several behaviors or the overlapping
steps agree. Conflicting deterministic results are an inconsistent model, not
something to merge away.

An internal step can update temporary quantities without producing an observable
action. Removing its presentation from a trace must still preserve its influence
on later values, effects, failure, and termination.

### Relationships: structure also has meaning

Some Facets describe ownership or architecture rather than a runtime step:

```text
owns(component, responsibility)
exposes(component, publicIdentifier)
invokes(operation, operation)
contributes(facet, concept)
```

Each relation has a particular meaning and permitted endpoint types. Source
imports, public exposure, and runtime invocation are separate relationships.
One cannot stand in for another.

Relational requirements can compare an explicit finite relation or a property
derived from it, such as whether an owner is unique. Absence of another observed
owner proves uniqueness only when the relevant ownership inventory is complete.

## How each contract contributes to the calculation

Each native Facet retains its source, owner, contract kind, and optional Concept.
Its interpretation can introduce several smaller units and their connections.
Those units remain attributable to that one Facet; splitting the calculation
does not split or rewrite the authored language.

| Contract | Contribution in the small units | Equality it can support |
| --- | --- | --- |
| Goal | An intended outcome or property of observable behavior, with its applicable conditions. | Equality of a precisely expressed outcome view. Qualitative purpose remains context until its observable meaning is specified. |
| Interface | Operation identities, input and result meanings, visible actions, public state observations, and promises. | Equality at the public interaction boundary, including result and failure distinctions. |
| State | Relevant quantities, named configurations, initial conditions, and state predicates. | Equality of configurations under an explicit representation mapping, preserving behavior needed by later interactions. |
| Logic | Expressions, guarded steps, sequencing, and explicit delegation. | Equality of calculations or composed operation behavior. |
| Constraint | Predicates restricting states, steps, traces, or relationships. | Equality of the required property over the declared domain, for example that a prohibited write never occurs. |
| Decision | Chosen alternatives, conditions of applicability, and rationale connecting a choice to other Facets. | Support for interpreting applicable choices. A binding restriction must be expressed as such; rejected alternatives never become implementation requirements. |
| Case | Initial conditions, actions, and expected outcomes or traces. | Equality on the specified scenario or family of scenarios. This does not silently cover inputs outside that family. |

Contract membership guides interpretation; it does not discharge a requirement.
An Interface Facet saying an operation returns Results still needs a represented
result behavior. A Logic Facet containing a call still needs the callee's
meaning when its effects are relevant.

Every selected Facet must have an interpretation or an explicit reason its
meaning is not yet represented. A parser's complete Facet inventory helps
detect omissions, but it cannot certify that every claim inside free prose
was faithfully understood.

### Concepts connect; explicit relationships finish the connection

Facets sharing a Concept are candidates for composition about that identity.
Their smaller units must also connect correctly: the same operation, result,
state quantity, resource, or scenario action needs a resolved relationship.

Suppose a Concept contains both `open` and `close`. A Constraint on `close`
must not be attached to `open` just because both belong to the same Concept.
Conversely, a result Concept can connect to an operation Concept through the
operation's explicitly described return value. Identical Concept headings are
not the only way to express a connection.

Public identifiers make those connections possible across imports. Ownership
and consumer context remain attached. A consumer's extra Facet about Results
does not rewrite the provider's behavior upstream.

### Compare related observations together

Separate equality of individual fields can lose their relationship. Consider
two descriptions with these possible returned pairs:

```text
Design:          (Ready, value) or (Failed, error)
Implementation:  (Ready, error) or (Failed, value)
```

Both have the same possible statuses and the same possible payloads. Their
joint behavior is different. The comparison must retain the pair, and more
generally the joint `(actions, outcome, next state)` observation.

Several per-Facet results justify a combined equality only when the comparison
also preserves the relationships that the combined boundary can observe.

## Composition laws

These are the kinds of fixed laws the eqval should own. Application sources
supply facts to which laws apply; they do not invent the laws themselves.

### Pure expression equality

For pure, total Boolean expressions, useful starting laws include:

```text
not(not(p))                 = p
and(p, true)                = p
and(p, false)               = false
and(p, p)                   = p
and(p, q)                   = and(q, p)
and(and(p, q), r)           = and(p, and(q, r))
if(p, true, false)          = p
if(p, q, false)             = and(p, q)
if(p, false, q)             = and(not(p), q)
if(p, q, q)                 = q
```

These laws are not licenses to reorder effects or remove a failing condition.
Typing and the pure, total-expression restriction are premises of the laws.
Numerical and collection laws need similarly explicit premises.

### Sequential behavior

To compose operation A followed by B, connect A's result and next state to B's
inputs and starting state. Preserve the order of observable actions. Run B
only on outcomes for which the source specifies that continuation.

This recovers behavior split among local helpers without asking the source
semanticizer to assert a terminal capability. A helper's name or signature is
not its body. If the helper's behavior is unavailable, the relevant composed
behavior remains unresolved.

### Alternatives

To compose a branch, derive the Condition selecting each alternative and the
behavior of each arm. For a complete deterministic operation, every permitted
input must select exactly one observable result, allowing identical overlapping
results where the model explicitly supports them.

Missing an arm is not equivalent to an empty arm. An explicitly described
no-op preserves state and produces its stated outcome. Missing information
produces no completed equality claim.

### State transitions and repeated interactions

An operation can be compared by its complete transition behavior for every
permitted starting state and input. Equal results must include matching next
states under the established state correspondence, so the next interaction
starts from related situations as well.

This can support equality across repeated interactions when the state model
captures all relevant history and the correspondence is preserved by every
step. Equal outputs for one call alone do not establish it.

Loops, recursion, concurrent interleavings, and internal nontermination need
explicit treatment. The first supported fragment below excludes unrepresented
instances. Running a loop for a fixed number of steps proves only a bounded
claim unless another law establishes that the bound covers all behavior.

### Component and module composition

An operation in one component can use another's public operation. Composition
requires compatible inputs, results, assumptions, and effects. A replacement
that is equal at a boundary preserves the larger behavior only when that
boundary includes what the surrounding composition can observe.

A module index instead assembles public surfaces and preserves their owners.
That supports calculating whether the intended public surface is present and
consistent. It does not establish runtime sequencing, nor does an assembly
summary prove its imported components' behavior.

Each implementation target is separate. Several cooperating files may form
one target, but a correct Rust backend cannot supply the missing behavior of
a separately required Python backend. Equality is calculated for the declared
target, not for an accidental union of all code that mentions the Concept.

## A complete example across design and code

Use the search publication rule from the language description. This component
describes one concept, so its Facets sit directly under the contracts without a
repeated Concept identifier. The design says an incoming response may replace
Results only when it belongs to the active request and that request is not
cancelled.

Here is a complete version of that operation's selected behavior:

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

A Markdown requirement can express the same operation without Sigil syntax:

> Publish a response only if its request is still active and has not been
> cancelled. Return Published after replacing Results. Otherwise leave Results
> unchanged and return Ignored.

The semanticizer supplies its explicit Concept/identifier correspondences and
the same kinds of conditions, updates, and outcomes. It must not invent
missing requirements merely to make the Markdown as complete as the Sigil.

Python could implement the behavior with early exits:

```python
def publish(state, response_id, incoming):
    if response_id != state.active_request:
        return Ignored
    if state.cancelled:
        return Ignored
    state.results = incoming
    return Published
```

TypeScript could use a positive branch:

```typescript
function publish(state, responseId, incoming) {
  if (responseId === state.activeRequest && !state.cancelled) {
    state.results = incoming;
    return Published;
  }
  return Ignored;
}
```

These snippets illustrate control flow; their source-language value and object
semantics are not implicitly identical. For the example, assume established
request-identity equality, ordinary infallible result assignment, no getters or
setters with hidden effects, and no concurrent state mutation during this
operation. Different languages must establish the corresponding assumptions
from their own source observations before the comparison applies.

### First calculate the admission condition

Let:

```text
m = ResponseId equals ActiveRequest
c = Cancelled
```

The Design condition is:

```text
and(m, not(c))
```

The Python branch structure reconstructs:

```text
if(not(m), false, if(c, false, true))
```

The TypeScript condition reconstructs the same Boolean function in its positive
form. Fixed Boolean laws can equate these expressions. Exhaustive evaluation
of the complete four-input Boolean domain gives an independent complete
decision method for this small comparison:

| Matches active request | Cancelled | Admission |
| --- | --- | --- |
| false | false | false |
| false | true | false |
| true | false | true |
| true | true | false |

This proves equality of the admission decision. It does not yet prove what
either branch writes or returns.

### Then compare the full selected operation

Compose each branch with its observations:

```text
Admission true:
  actions:    publish(Results, IncomingResults)
  outcome:    Return(Published)
  next state: Results = IncomingResults;
              ActiveRequest and Cancelled unchanged

Admission false:
  actions:    none
  outcome:    Return(Ignored)
  next state: unchanged
```

The mapping from a local assignment to the public Results observation is
explicit and source-supported. It is not obtained by labeling every assignment
`publish`.

Joint equality now includes the condition, the published value, the result
alternative, and the state update. If request identifiers and result payloads
have larger domains, the Boolean table alone is insufficient for the full
claim. Either restrict those domains explicitly or prove that identity testing
and unchanged payload forwarding preserve their values for all admitted inputs.

### A disagreeing edit has a small witness

Remove Python's cancellation check. Its new admission expression is `m`.

```text
Starting situation:
  response matches the active request
  the active request is cancelled
  IncomingResults differs from current Results

Design:
  no publication, Return(Ignored), Results unchanged

Changed implementation:
  publish IncomingResults, Return(Published), Results replaced
```

The disagreement connects the component's Interface meaning of Ignored, Logic
branch, stale/cancelled Constraint, and cancelled-response Case. Those links
come from the same represented operation, values, and behavior, not guesses
about a method name or a synthetic Concept wrapper.

The diagnostic can locate the current publishing step and the affected authored
Facets. A deleted check has no current source span; its old span may appear as
historical context, not as a premise of the fresh disagreement.

## Cases and tests use the same smaller units

A Case breaks down into:

```text
given:   a Condition on starting state and arguments
actions: an operation or sequence of operations
expect:  an observation or predicate over the resulting trace
```

A concrete Case selects one situation. A statement such as “any stale response
is ignored” selects a family. Interpretation must distinguish an outcome that
must occur from one that may occur. Ambiguous quantification remains unresolved;
the compiler must not turn an example into an unintended universal requirement.

Tests can independently describe the same setup, actions, and expected result.
That supports checking scenario coverage and whether the test's assertion
agrees with the Case. Test execution remains a separate activity.

Production behavior, test expectations, and mocked behavior must retain distinct
roles. A test asserting `Ignored` cannot prove that the production operation
returns it. A mocked helper cannot fill a missing production helper summary.
Neither source selection nor shared Concept identity permits that substitution.

## Keep the two reconstructions independent

The semanticizer for an implementation receives its captured source, the fixed
observation vocabulary, and the applicable identity/type descriptors. It does
not receive the Design's expected branch condition, result table, Cases, or
comparison verdict.

It creates local descriptions and explicit correspondences to supplied public
identifiers or other authorized anchors. Display labels help interpretation but
are not native equality evidence. Unknown or ambiguous mappings remain gaps.

The computation stays:

```text
Design observations -> independent Design meaning
Code observations   -> independent Implementation meaning

selected Design meaning + selected Implementation meaning
    -> equality calculation at the declared boundary
```

Different source languages can use different local structures. The shared units
describe meaning rather than a Rust, Python, TypeScript, Markdown, or Mermaid
syntax tree. A construct outside the supported units remains explicitly
uninterpreted; language neutrality is not a promise that every construct is
already supported.

Source interpretation still matters. A valid equality calculation proves a
relationship between accepted descriptions. It is conditional on those
descriptions faithfully representing their sources. The smaller units make
that interpretation more inspectable and move composition into the eqval;
they do not make arbitrary source interpretation infallible.

## How Egglog should carry the calculation

Keep source and language identities separate from behavioral equality:

```text
Never union:
  source occurrences, component identities, Concept identities,
  Facet identities, or local-to-public correspondence anchors

May equate under fixed laws:
  expressions and supported descriptions of behavior
```

Relations associate a Facet or source occurrence with a behavioral expression.
Expression equality can then help a larger pattern match without erasing the
different source descriptions that justified it.

For example, after the eqval equates an early-exit admission expression with
`and(m, not(c))`, a larger publication rule can match that condition and its
associated state update and outcome. The high-level behavior is composed from
observations; it was not supplied as `provides(CancellationSafety)` by the model.

Design and Implementation closures use separate graphs. Their internal e-class
IDs are not portable comparison keys. Use either complete finite behavior tables
or a third equality query over their selected expression descriptions and the
fixed laws. That query may contain both expressions as subjects of comparison;
it must not assert their equality or use Design requirements to manufacture
Implementation facts.

Use relational rules for reachability, support, ownership, public surfaces, and
other typed connections. Use term equality where actual substitutable meaning
has been established. A broad `correspondsTo` edge never supplies a semantic
rewrite rule.

Extract a convenient expression only for presentation or subsequent supported
calculation. Different extracted expressions can still be equivalent, and a
cheap expression is not more true than an expensive one.

## Complete calculations, honest results

Return one of three results for each declared comparison:

| Result | Required evidence |
| --- | --- |
| **Equal** | A proof covering the full stated boundary and domain, including the required state/result/effect relationships. |
| **Different** | A valid distinguishing input, situation, or trace, or another supported refutation. |
| **Unresolved** | Missing meaning, ambiguous correspondence, unsupported operations, incomplete scope, or exhausted computation prevents either conclusion. |

For finite exhaustive comparison, the eqval must establish that every input
in the declared domain was considered and that each description supplies its
complete behavior there. It must check this after completing the relevant
computation, not infer it from missing rows while facts are still being derived.

An empty observation set, two equal-looking unknown nodes, a missing branch,
or a resource limit cannot prove equality. An empty domain must be exposed as
intentional and vacuous, not counted as evidence that an operation is covered.

A concrete behavior contradicting an explicit prohibition can establish a
local disagreement even when unrelated parts remain unresolved. Conversely,
not finding an implementation behavior or an equality derivation is not a
refutation unless the method establishes that the relevant search is complete.

An exact calculation on a supplied finite model establishes the completeness
of that calculation. It does not independently establish completeness of an
LLM's reconstruction of source code or prose.

### What the result must retain

Every result names its subject, target, boundary, domain, assumptions, source
bindings, and laws. A proof retains the input observations and rule applications
needed to explain it. A disagreement retains the distinguishing situation and
the support for the differing behavior.

Derived support points back to native Facets and source occurrences. Several
occurrences may support the same fact; several proofs may support the same
equality. Keep those identities outside the e-class so explanation survives
normalization.

Only current accepted observations enter a current result. Snapdir's captured
content identity and Sigil's complete semantic binding determine which
observations may be reused. A changed law invalidates dependent proof results;
changed source or incompatible observation inputs invalidate the reconstruction
as appropriate. Historical observations may explain impact but cannot prove a
fresh equality or disagreement.

## The first useful implementation

Begin with two deliberately small calculations:

1. **Finite pure decisions.** Typed, acyclic expressions over Booleans and finite
   alternatives. Support field selection, equality, Boolean operators, and
   conditional expressions. Calculate exact behavior for the declared finite
   input domain and retain symbolic equality proofs where supported.
2. **Finite guarded operations.** Acyclic steps with explicit conditions,
   ordered observable actions, defined return/failure outcomes, and finite
   relevant state. Compare the full joint result for every permitted starting
   state and input. Delegation requires an available compatible description.

These already support meaningful differences between a direct guard, early
returns, a match, and a small helper composition. They can detect a removed
condition, wrong branch outcome, wrong value, extra visible write, or changed
ordering without comparing source syntax.

For these calculations, unsupported recursion, loops, effects, concurrency,
representation mappings, or external calls produce Unresolved. Broader support
requires extending the value and behavior meanings with sound rules. A bounded
exploration must name its bound rather than claim unrestricted equality.

Keep generation finite by construction in the first implementation. A small
set of constructor names does not prevent rules from generating indefinitely
larger terms. Prefer the simple finite decision procedure where it is complete;
use equality saturation to recognize and explain alternate formulations, not
to create endless permutations for their own sake.

The initial success criterion is concrete: Sigil and Markdown descriptions of
publication, and differently structured code implementations, yield the same
selected behavior; removing cancellation changes that behavior and produces
the exact distinguishing scenario with source support.

That gives later audit and implementation work a precise question to ask:
**what observation changed, under which input, and which Facets required it to
be otherwise?**
