# Publication, from source bytes to an equality result

This is a worked specification of the Eqval refactor, not an executed proof or
an example accepted by today's compiler. The [behavior algebra](behavior_algebra.md)
owns the meanings; [architecture](ARCHITECTURE.md) owns the boundaries. This
file follows one calculation all the way through:

```text
capture Sigil and Rust independently
  -> attributable, typed observation triples
  -> typed expressions and control flow
  -> independently composed behavior
  -> complete comparison under one declared boundary
  -> Equal, or a distinguishing situation with two-sided source support
```

The operation publishes incoming search results only for the active,
uncancelled request. We first calculate equality, then remove the Rust
cancellation check and calculate exactly what disagrees.

## 1. The two sources

The Sigil uses two Concepts, Admission and Publication, alongside direct Facets.
Those identities stay in the support records; the operation's explicit values
and conditions connect their contributions.

### Design

```sigil
component SearchPublication {
  goal {
    Keep displayed Results aligned with the active uncancelled request.
  }

  interface {
    publish(ResponseId, IncomingResults) returns Published or Ignored.

    Admission {
      Eligibility is the Boolean decision controlling whether publish may
      replace Results.
    }

    Publication {
      Published means IncomingResults became the current Results.

      Ignored means the current Results remain unchanged.
    }
  }
}

expand SearchPublication {
  state {
    Admission {
      ActiveRequest identifies the request whose response is current.

      Cancelled records whether that request was cancelled.
    }

    Publication {
      Results holds the currently published result.
    }
  }

  logic {
    publish evaluates Eligibility against the starting state.

    Admission {
      Eligibility is true exactly when ResponseId equals ActiveRequest and
      Cancelled is false.
    }

    Publication {
      When Eligibility is true, replace Results with IncomingResults and
      return Published.

      Otherwise preserve Results and return Ignored.
    }
  }

  constraints {
    publish leaves ActiveRequest and Cancelled unchanged.

    Admission {
      Stale or cancelled responses never replace Results.
    }

    Publication {
      Ignored performs no publication and leaves Results unchanged.
    }
  }

  decisions {
    Use the active request as authority because responses can arrive out
    of submission order.
  }

  cases {
    A response for an older request is ignored.

    Admission {
      A response for the active request after cancellation is ignored.
    }

    Publication {
      An active uncancelled response publishes its IncomingResults and
      returns Published.
    }
  }
}
```

For this trace, `F0` through `F18` name the native Facet occurrences:

| Occurrence | Contract / Concept | Contribution |
| --- | --- | --- |
| F0 | Goal / direct | Desired alignment of displayed results. |
| F1 | Interface / direct | Operation, arguments, and result alternatives. |
| F2 | Interface / Admission | Eligibility decision identity. |
| F3, F4 | Interface / Publication | Published and Ignored meanings, respectively. |
| F5, F6 | State / Admission | ActiveRequest and Cancelled. |
| F7 | State / Publication | Results. |
| F8 | Logic / direct | Eligibility reads the starting state. |
| F9 | Logic / Admission | Exact eligibility expression. |
| F10, F11 | Logic / Publication | Successful and ignored branches, respectively. |
| F12 | Constraint / direct | ActiveRequest and Cancelled remain unchanged. |
| F13 | Constraint / Admission | No publication for stale or cancelled responses. |
| F14 | Constraint / Publication | Ignored has no publication and preserves Results. |
| F15 | Decision / direct | Rationale for active-request authority. |
| F16 | Case / direct | Stale-response scenario family. |
| F17 | Case / Admission | Active cancelled-response scenario family. |
| F18 | Case / Publication | Active uncancelled-response scenario family. |

These are display aliases for source-bound identities, not proposed Sigil
syntax. The frontend supplies actual ranges and the two resolved Concept
identities. It does not invent a Concept for the direct Facets.

### Implementation

Use this Rust source as one complete implementation target. The occurrence
comments label the source regions used later; they are not proof annotations.

```rust
// R0: finite value and state representations
#[derive(Clone, Copy, PartialEq, Eq)]
enum RequestId { R0, R1 }

#[derive(Clone, Copy, PartialEq, Eq)]
enum Payload { V0, V1 }

#[derive(Clone, Copy, PartialEq, Eq)]
enum PublishResult { Published, Ignored }

struct State {
    active_request: RequestId,
    cancelled: bool,
    results: Payload,
}

// R1: operation and arguments
fn publish(
    state: &mut State,
    response_id: RequestId,
    incoming: Payload,
) -> PublishResult {
    // R2: first branch
    if response_id != state.active_request {
        return PublishResult::Ignored; // R3
    }
    // R4: second branch
    if state.cancelled {
        return PublishResult::Ignored; // R5
    }
    state.results = incoming; // R6
    PublishResult::Published // R7
}
```

This deliberately uses finite Copy values, derived equality on fieldless enums,
ordinary fields, and an exclusive mutable state reference. There is no helper,
custom equality, destructor, unsafe block, loop, or hidden call to summarize.
Rust syntax is interpreted externally; Eqval receives the observations below,
not a Rust AST. Unsupported source semantics would leave a gap rather than be
silently replaced with these observations.

## 2. Fix the question before examining the answer

Use two comparisons. `q_admit` observes whether the publication write is reached.
`q_publish` observes the whole selected operation. Neither boundary can be
narrowed after discovering a mismatch.

```text
subject:          SearchPublication.publish
implementation:   the Rust source above, production role
arguments:        ResponseId, IncomingResults
starting state:   ActiveRequest, Cancelled, Results

RequestId domain: {r0, r1}
Payload domain:   {v0, v1}
Cancelled domain: {false, true}
Result domain:    {Published, Ignored}

q_admit observes: Boolean publication admission
q_publish observes:
  (ordered publication actions, returned outcome,
   next ActiveRequest, next Cancelled, next Results)
```

The full input key is `(ResponseId, ActiveRequest, Cancelled, IncomingResults,
Results)`. All five quantities range independently: `2 * 2 * 2 * 2 * 2 = 32`
keys. This is the complete declared domain, not 32 tests sampled from an
unspecified production domain.

The boundary's value correspondence maps the two Rust request variants to
`r0/r1`, the payload variants to `v0/v1`, and the result variants to the public
alternatives. The ordering used to print the variants has no behavioral meaning.
The state correspondence maps the three fields to the three public quantities.
Those mappings need accepted source support; equal-looking names are not proof.

For this boundary, writing the mapped Results field is observed as
`publish(Results, value)`, including a write of its existing value. Local reads,
branch selection, and return mechanics are internal. The return alternative
and next state remain observable. Assignment is infallible here, request
equality is pure and total, and there is no concurrent state mutation during
the call. Memory layout and elapsed execution time are outside this boundary.
These are explicit restrictions, not permissions to discard unknown effects.

This applies [the algebra's equality definition](behavior_algebra.md#what-equality-means-here):

```text
Equal(q_publish) iff
  for every x among the 32 keys:
    Bq(Design, x) = Bq(Rust, x)
```

## 3. Capture and interpret independently

`sigilc` captures both sources and the selected path-aware membership. Each
interpretation is bound to the exact bytes, role, vocabulary version, and
consumed context. The immutable Implementation descriptors contain authorized
identities and types, not F9's guard, Case expectations, or Design outcomes.

```text
Design capture + native inventory -> external reading -> projection D
Rust capture + identity/type descriptors -> independent reading -> projection R

accept D -> validate and close D alone
accept R -> validate and close R alone
```

The driver checks bindings before publication, including expected generation.
It keeps accepted observation content identity separate from source identity:
two reconstructions of identical bytes can produce different accepted models.

The next sections specify one concrete data-only observation profile for this
fixture. It is a proposed realization of the eight algebra units, not a claim
that its predicate names are already implemented. The current
[Turtle validator](../sigilc/src/turtle.rs) and [kernel.egg](../sigilc/src/kernel.egg)
need the refactor described in [the audit](AUDIT.md#remaining-implementation-gaps).
No source may submit the compiler laws or assert an `Equal` verdict.

## 4. Give the triples precise meanings

All blocks below use these prefixes. `d:` and `r:` are separate source-local
namespaces; `p:` contains authorized public identities; `t:` and `a:` are fixed
vocabulary. In persisted data, local keys are scoped by the source namespace.

```turtle
@prefix a: <urn:sigil:example:algebra:> .
@prefix t: <urn:sigil:example:type:> .
@prefix p: <urn:sigil:example:public:SearchPublication:> .
@prefix d: <urn:sigil:example:design:> .
@prefix r: <urn:sigil:example:rust:> .
```

Turtle `;` repeats a subject and `,` repeats a subject/predicate. Thus this:

```turtle
r:mismatch a:kind a:NotEqual; a:arg0 r:response; a:arg1 r:readActive .
```

means exactly these three triples:

```text
(r:mismatch, a:kind, a:NotEqual)
(r:mismatch, a:arg0, r:response)
(r:mismatch, a:arg1, r:readActive)
```

There are no blank nodes, executable expressions in string literals, or
source-supplied rewrite rules. The restricted profile is:

| Kind | Required fields and meaning |
| --- | --- |
| Operation | `input0`, `input1`, `entry`, `denotes`: ordered arguments, entry Step, public operation correspondence. |
| Input | `valueType`, `denotes`: typed argument reference. |
| StateSlot | `valueType`, `denotes`: typed relevant state quantity/resource. |
| Alternative | `valueType`, `denotes`: a local result value mapped to a public alternative. |
| ReadState | `slot`: pure expression reading that slot in the current symbolic state. |
| Equal, NotEqual | `arg0`, `arg1`: same-typed finite-value operands; Boolean result. |
| Not | `arg0`: Boolean operand; Boolean result. |
| And | `arg0`, `arg1`: pure total Boolean operands; Boolean result. |
| Branch | `test`, `onTrue`, `onFalse`: Boolean expression and both successor Steps. |
| Assign | `target`, `value`, `next`: slot, matching typed expression, successor Step. |
| Return | `value`: result expression; no successor. |

Inputs and Alternatives are also usable as expressions. Slot references are
not reads until wrapped in ReadState. Branch, Assign, and Return describe
internal control steps; their composed guarded behavior supplies the algebra's
complete Step, with actions, outcome, and next state together.

`denotes` is an attributable correspondence, not an equality axiom. In this
fixture the allowed mappings are direct typed argument, slot, result-variant,
and operation correspondences. More complex representation mappings need
supported expressions of their own; an opaque mapping is Unresolved.

Design-only `preserves` identifies a required frame condition on an Operation.
It comes from a Design Facet, never from a compiler inference that unspecified
Design state must remain unchanged. Rust receives no such promise from Design.

The descriptor table shared as identity/type information is:

| Identity | Kind / value meaning |
| --- | --- |
| p:publish | Operation with two ordered arguments and result type t:Result. |
| p:ResponseId | Input, t:RequestId. |
| p:IncomingResults | Input, t:Payload. |
| p:ActiveRequest | State quantity, t:RequestId. |
| p:Cancelled | State quantity, t:Bool. |
| p:Results | State quantity and observed resource, t:Payload. |
| p:Published, p:Ignored | Alternatives of t:Result. |

The finite domain and observation policy belong to the declared comparison;
the descriptor table does not state when an alternative must occur.

## 5. Design prose becomes this observation graph

The Design reader emits the following operation slice. It represents inputs,
state reads, a condition, branching, assignment, and returns, not a terminal
claim such as `provides(CancellationSafety)`.

```turtle
d:response a:kind a:Input;
    a:valueType t:RequestId; a:denotes p:ResponseId .
d:incoming a:kind a:Input;
    a:valueType t:Payload; a:denotes p:IncomingResults .
d:active a:kind a:StateSlot;
    a:valueType t:RequestId; a:denotes p:ActiveRequest .
d:cancelled a:kind a:StateSlot;
    a:valueType t:Bool; a:denotes p:Cancelled .
d:results a:kind a:StateSlot;
    a:valueType t:Payload; a:denotes p:Results .
d:published a:kind a:Alternative;
    a:valueType t:Result; a:denotes p:Published .
d:ignored a:kind a:Alternative;
    a:valueType t:Result; a:denotes p:Ignored .

d:readActive a:kind a:ReadState; a:slot d:active .
d:readCancelled a:kind a:ReadState; a:slot d:cancelled .
d:matches a:kind a:Equal; a:arg0 d:response; a:arg1 d:readActive .
d:notCancelled a:kind a:Not; a:arg0 d:readCancelled .
d:eligible a:kind a:And; a:arg0 d:matches; a:arg1 d:notCancelled .

d:op a:kind a:Operation; a:denotes p:publish;
    a:input0 d:response; a:input1 d:incoming; a:entry d:choose;
    a:preserves d:active, d:cancelled .
d:choose a:kind a:Branch; a:test d:eligible;
    a:onTrue d:store; a:onFalse d:returnIgnored .
d:store a:kind a:Assign; a:target d:results;
    a:value d:incoming; a:next d:returnPublished .
d:returnPublished a:kind a:Return; a:value d:published .
d:returnIgnored a:kind a:Return; a:value d:ignored .
```

The occurrence ledger attributes the facts rather than putting source identity
inside an e-class:

| Triples concerning | Direct Design support |
| --- | --- |
| d:op signature, d:response, d:incoming | F1. |
| d:active, d:cancelled, d:results | F5, F6, F7, respectively. |
| d:published, d:ignored | F1 and the respective F3/F4 meaning. |
| Reads and the eligibility expression | F8/F9, with F2 for its public decision identity. |
| d:choose and its two successor references | F10/F11 using the F9 condition. |
| d:store and d:returnPublished | F10. |
| d:returnIgnored | F11. |
| d:op preserves facts | F12. |

F11 explicitly preserves Results on the ignored branch. The branch descriptions
and F12 jointly describe the entire next state: nothing is filled from Rust.
The profile interprets a complete described branch as its listed actions and
outcome; if the prose does not support that completeness, record a gap instead
of using this graph.

The other Facets are not discarded. F13/F14 become property requirements and
F16-F18 become scenario requirements in section 10. F0/F15 remain interpretive
context here; they are not extra instructions or a qualitative-purpose theorem.
This accounts for every selected Facet without manufacturing runtime behavior.

## 6. Rust becomes a different observation graph

The Rust reader describes what the captured function does. It does not receive
section 5's graph. Its result retains both early returns:

```turtle
r:response a:kind a:Input;
    a:valueType t:RequestId; a:denotes p:ResponseId .
r:incoming a:kind a:Input;
    a:valueType t:Payload; a:denotes p:IncomingResults .
r:active a:kind a:StateSlot;
    a:valueType t:RequestId; a:denotes p:ActiveRequest .
r:cancelled a:kind a:StateSlot;
    a:valueType t:Bool; a:denotes p:Cancelled .
r:results a:kind a:StateSlot;
    a:valueType t:Payload; a:denotes p:Results .
r:published a:kind a:Alternative;
    a:valueType t:Result; a:denotes p:Published .
r:ignored a:kind a:Alternative;
    a:valueType t:Result; a:denotes p:Ignored .

r:readActive a:kind a:ReadState; a:slot r:active .
r:readCancelled a:kind a:ReadState; a:slot r:cancelled .
r:mismatch a:kind a:NotEqual; a:arg0 r:response; a:arg1 r:readActive .

r:op a:kind a:Operation; a:denotes p:publish;
    a:input0 r:response; a:input1 r:incoming; a:entry r:checkRequest .
r:checkRequest a:kind a:Branch; a:test r:mismatch;
    a:onTrue r:returnStale; a:onFalse r:checkCancelled .
r:returnStale a:kind a:Return; a:value r:ignored .
r:checkCancelled a:kind a:Branch; a:test r:readCancelled;
    a:onTrue r:returnCancelled; a:onFalse r:store .
r:returnCancelled a:kind a:Return; a:value r:ignored .
r:store a:kind a:Assign; a:target r:results;
    a:value r:incoming; a:next r:returnPublished .
r:returnPublished a:kind a:Return; a:value r:published .
```

Here is the exact source-to-record breakdown:

| Source | Emitted subjects / facts |
| --- | --- |
| R0 enums and fields | Slot types, finite value meanings, result Alternatives, and supported representation correspondences. |
| R1 signature | r:op, r:response, r:incoming and their typed argument mappings. |
| R2 field read and `!=` | r:readActive and r:mismatch. |
| R2 `if` plus the following statement | r:checkRequest and its true/false successor edges. |
| R3 return | r:returnStale. |
| R4 field read and `if` | r:readCancelled, r:checkCancelled and its successor edges. |
| R5 return | r:returnCancelled. |
| R6 assignment | r:store, its exact field target, RHS value, and successor. |
| R7 tail expression | r:returnPublished; Rust's tail-expression return becomes the same Outcome form as an explicit return. |

A successor edge carries support for the enclosing control-flow region as well
as the statement: R3 returning means it does not fall through into R4. An
assignment target comes from the actual field access, not the function name.

For example, ingestion can retain this occurrence record outside the term DAG:

```text
fact:       (r:store, a:value, r:incoming)
factId:     hash(normalized typed triple)
occurrence: (accepted Rust binding, factId, R6 byte range, excerpt digest)
```

The shown `R6` alias stands for a range computed from captured bytes, not a
hard-coded location. Range checking establishes where the claim points; it
does not establish that the reader interpreted the assignment correctly.

Notice what the Rust projection does not contain: no Admission or Publication
wrapper, no promised frame condition, no expected guard, and no safety verdict.
Eqval must derive the behavior from these local records.

## 7. Validate and lower, without mixing the graphs

Before constructing terms, Eqval validates the fixed profile:

1. Resolve every referenced node and authorized correspondence in its binding.
2. Check kind-specific field cardinality: two Branch successors, one Assign
   target/value/next, no Return successor, and correctly ordered operands.
3. Check types: request equality compares request values, tests are Boolean,
   Results receives a Payload, and returns are result Alternatives.
4. Check expression and control-flow acyclicity, supported operations, reachable
   successors, source support, and the complete selected target inventory.
5. Reject wrong-side claims and arbitrary predicates or laws. Preserve missing
   or unsupported meaning as Unresolved rather than inventing a node.

A well-formed finite graph proves neither that prose was faithfully understood
nor that every source effect was observed. The comparison remains conditional
on accepted interpretation fidelity. The graph checks establish that the
subsequent calculation is defined and complete for the supplied model.

The following are typed algebra constructor signatures, not executable Egglog
syntax. They specify what the fixed host lowering must construct:

```text
Input(publicArgument, T)                  : Expr<T>
State(publicSlot, T)                      : Expr<T>
Eq(Expr<T>, Expr<T>)                      : Expr<Bool>
Not(Expr<Bool>)                           : Expr<Bool>
And(Expr<Bool>, Expr<Bool>)                : Expr<Bool>
If(Expr<Bool>, Expr<T>, Expr<T>)           : Expr<T>   [pure expressions]
Alt(publicAlternative)                   : Value<Result>
Publish(publicResource, Expr<Payload>)    : Action
Return(Expr<Result>)                     : Outcome
Step(guard, orderedActions, outcome, nextState)
```

Lower ReadState through the current symbolic state environment. Lower NotEqual
as `Not(Eq(...))` only under the admitted finite equality semantics. Authorized
correspondence chooses argument and state coordinates; it does not union the
source anchors. Let these display abbreviations name the resulting expressions:

```text
u = Input(p:ResponseId, RequestId)
a = State(p:ActiveRequest, RequestId)
c = State(p:Cancelled, Bool)
v = Input(p:IncomingResults, Payload)
z = State(p:Results, Payload)
m = Eq(u, a)
```

The independent expression roots are now:

```text
D: d:eligible      -> And(m, Not(c))
R: r:mismatch     -> Not(m)
R: r:readCancelled -> c
```

A relation such as `describes(d:eligible, And(m, Not(c)))` retains the link
between anchor and term. It does not identify the two, and no union merges
`d:eligible` with a Rust source node.

## 8. Compose the operation from the control flow

Start each graph with this symbolic execution record:

```text
guard   = true
state   = {ActiveRequest: a, Cancelled: c, Results: z}
actions = []
```

The compiler owns these transfer rules. They are instances of the algebra's
[sequential and alternative composition laws](behavior_algebra.md#composition-laws):

| Record encountered | Calculation |
| --- | --- |
| Branch(test, yes, no) | Evaluate test in the current symbolic environment. Continue yes with `guard AND test`, no with `guard AND NOT test`. |
| Assign(slot, value, next) | Evaluate RHS in the pre-assignment environment, update only that slot, append the boundary's mapped action if observable, then continue next. |
| Return(value) | Emit one Step with the current guard, ordered actions, evaluated return value, and complete current state. Stop this path. |

Source-level short-circuiting and early return determine control flow before
pure Boolean simplification. No rule runs a successor after Return. A missing
successor is not an empty branch. The frame rule for a Rust assignment is sound
here because the represented write targets one ordinary field, with no aliasing
side effects, callbacks, or destructor behavior. It is not borrowed from F12.

Walking the Rust graph gives every terminal path:

| Path | Derived guard | Ordered actions | Outcome | Next state `(ActiveRequest, Cancelled, Results)` |
| --- | --- | --- | --- | --- |
| R2 true -> R3 | `NOT m` | `[]` | `Return(Ignored)` | `(a, c, z)` |
| R2 false -> R4 true -> R5 | `m AND c` | `[]` | `Return(Ignored)` | `(a, c, z)` |
| R2 false -> R4 false -> R6 -> R7 | `m AND NOT c` | `[Publish(Results, v)]` | `Return(Published)` | `(a, c, v)` |

Walking Design gives two terminal paths:

| Path | Derived guard | Ordered actions | Outcome | Next state |
| --- | --- | --- | --- | --- |
| d:choose true -> d:store -> d:returnPublished | `m AND NOT c` | `[Publish(Results, v)]` | `Return(Published)` | `(a, c, v)` |
| d:choose false -> d:returnIgnored | `NOT (m AND NOT c)` | `[]` | `Return(Ignored)` | `(a, c, z)` |

This is where low-level observations become complete algebra Steps. Define two
joint observation expressions solely to shorten the remaining tables:

```text
O0(a, c, z) = ([], Return(Ignored), (a, c, z))
O1(a, c, v) = ([Publish(Results, v)], Return(Published), (a, c, v))
```

An action's payload and the new state both retain `v`; they are not two
unrelated facts saying that some payload was published. Every Step preserves
the correlation among guard, actions, return, and state.

The Design frame facts and explicit branch meanings supply its next-state
requirements. Rust's write set and control flow independently supply its next
state. Grouped Admission and Publication contributions and direct F12 all
participate in the operation calculation without becoming one native identity.

## 9. Calculate admission equality with Egglog laws

Derive admission from each control-flow graph by asking whether execution
reaches the mapped publication action. For this fixture every path has zero or
one such action:

```text
D_admit = And(m, Not(c))
R_admit = If(Not(m), false, If(c, false, true))
```

This is compiler-derived reachability of an observed action, not a Boolean
claim supplied by the Rust reader. The fixed pure-total laws needed here are:

```text
L1: If(p, false, q) = And(Not(p), q)
L2: And(p, true)    = p
L3: Not(Not(p))    = p
```

A separate law-only equality query loads the selected typed expression terms
and these laws. Its concrete derivation is:

```text
R_admit
= If(Not(m), false, If(c, false, true))
= If(Not(m), false, And(Not(c), true))    [L1: p=c, q=true]
= If(Not(m), false, Not(c))              [L2: p=Not(c)]
= And(Not(Not(m)), Not(c))               [L1: p=Not(m), q=Not(c)]
= And(m, Not(c))                        [L3: p=m]
= D_admit
```

Egglog congruence propagates an inner equality through the enclosing
constructor. The final query roots belong to the same e-class because the laws
established substitutable expression meaning. They are never unioned as a
premise. Source identities, support records, and the independent world graphs
are not part of this quotient.

Conceptually, the query is:

```text
Q = new graph with the fixed typed Boolean constructors and L1-L3
left  = add_term(Q, selected Design admission expression)
right = add_term(Q, selected Rust admission expression)
apply fixed laws within the supported computation limits
record equality derivation if Q proves left = right
```

These are algorithm steps, not a promise of a particular Egglog Rust API.
The [audit's proof-support constraints](AUDIT.md#egglog-build-and-proof-support)
still apply. No internal e-class ID from D is compared with an ID from R.
Exhaustion or failure to merge is not a proof of inequality.

The independent finite admission evaluations also give a complete decision:

| m | c | D_admit | R_admit |
| --- | --- | --- | --- |
| false | false | false | false |
| false | true | false | false |
| true | false | true | true |
| true | true | false | false |

This establishes only admission equality. It says nothing yet about payloads,
return alternatives, or state preservation.

## 10. Calculate whole-operation equality, not just guard equality

For this first implementation, the decisive operation procedure is complete
finite evaluation. Each world evaluates its own Steps. Canonical value
encodings and the declared correspondence make the observations comparable;
source IDs and e-class IDs are never table keys.

```text
for x in all 32 canonical input keys:
    D[x] = complete set of joint observations from Design's selected Steps
    R[x] = complete set of joint observations from Rust's selected Steps

require every key to have complete supported evaluation on both sides
require deterministic paths to cover the domain without conflicting results

if some D[x] != R[x]:
    return Different with a distinguishing observation and its support
if all D[x] == R[x]:
    return Equal for this boundary and domain
otherwise:
    return Unresolved with the missing evaluation or meaning
```

The algorithm does not turn absent rows into empty behavior. Completion is
checked after derivation finishes. A Return with no actions produces O0, not
an empty observation set. In this deterministic fixture every key must have
exactly one joint observation.

Here is the complete table, compressed without dropping any input combinations.
Every row below expands over these four `(incoming, old Results)` pairs:

```text
(v0, v0), (v0, v1), (v1, v0), (v1, v1)
```

| ResponseId | ActiveRequest | Cancelled | Design output | Rust path / output | Keys represented |
| --- | --- | --- | --- | --- | --- |
| r0 | r0 | false | O1(r0, false, incoming) | success / same O1 | 4 |
| r0 | r0 | true | O0(r0, true, old) | cancelled / same O0 | 4 |
| r0 | r1 | false | O0(r1, false, old) | stale / same O0 | 4 |
| r0 | r1 | true | O0(r1, true, old) | stale / same O0 | 4 |
| r1 | r0 | false | O0(r0, false, old) | stale / same O0 | 4 |
| r1 | r0 | true | O0(r0, true, old) | stale / same O0 | 4 |
| r1 | r1 | false | O1(r1, false, incoming) | success / same O1 | 4 |
| r1 | r1 | true | O0(r1, true, old) | cancelled / same O0 | 4 |

That is 8 publishing keys and 24 ignored keys on each side. Even when incoming
equals old Results, O1 contains a publication action and returns Published;
O0 does neither. Comparing only the next Results value would miss that
observable distinction.

For example, one publishing row expands to:

```text
x = (r0, r0, false, v1, v0)
D[x] = { ([Publish(Results, v1)], Return(Published), (r0, false, v1)) }
R[x] = { ([Publish(Results, v1)], Return(Published), (r0, false, v1)) }
```

One ignored row expands to:

```text
x = (r0, r0, true, v1, v0)
D[x] = { ([], Return(Ignored), (r0, true, v0)) }
R[x] = { ([], Return(Ignored), (r0, true, v0)) }
```

The table is a hand-derived expected result for the proposed implementation,
not output from a test run. An implemented evaluator must actually produce and
compare all 32 rows and retain the supporting calculation before emitting Equal.

### The remaining Facets become explicit comparison views

Let `obs` be the already calculated joint observation. Define `hasPublish(obs)`
from its ordered action sequence, and read `outcome(obs)` and `next(obs)` from
the same tuple. The additional Design requirements are:

| Support | Domain / condition | Required observation or property |
| --- | --- | --- |
| F12 | All 32 keys | `next.ActiveRequest = a AND next.Cancelled = c`. |
| F13 | All 32 keys | `NOT ((NOT m OR c) AND hasPublish(obs))`. |
| F14 | All 32 keys | `outcome = Return(Ignored)` implies no publication and `next.Results = z`. |
| F16 | `NOT m`, 16 keys | O0(a, c, z). |
| F17 | `m AND c`, 8 keys | O0(a, c, z). |
| F18 | `m AND NOT c`, 8 keys | O1(a, c, v). |

These are explicit accepted property/scenario interpretations, not extra
execution branches. A property comparison evaluates its Boolean expression
against the required constant true; a Case comparison restricts the domain to
its declared scenario family and compares the joint expected observation.
The same units are doing the work, without conflating a Case with a test.

The compiler derives the operation obligation from F1/F3-F12 and its required
identity/value meanings. It does not assume that checking F13 alone proves
whole-operation equality. Conversely, a complete equal operation table can
support these additional views when the Design model also satisfies them.
A conflicting Design requirement must be reported, not overwritten by the
implementation result.

A test's setup and assertions could independently lower to the same scenario
view. That could establish expectation correspondence, not that production was
executed or that mocked behavior proves the real function.

## 11. Retain the result and its derivation

A result from the implemented procedure would retain at least:

```text
subject:      SearchPublication.publish
target:       Rust production target
mode:         behavioral equality
boundary:     q_publish, including domains, observation policy, and assumptions
bindings:     exact accepted Design and Rust capture/input bindings
projections:  accepted D and R observation-content identities
runtime:      typed-lowering, fixed-law, evaluator, and actual build identity
coverage:     32 / 32 keys complete on each side
comparison:   32 / 32 equal joint observation sets
result:       Equal
support:      source occurrences + transfer derivations + finite comparison
```

The separate q_admit result can also retain the L1-L3 symbolic equality proof.
Each derivation records the rule, substitution, premise references, and
conclusion. For instance, support for the Rust successful Step includes R2's
false edge, R4's false edge, R6's target/value mapping, R7's return, and their
state/value typing. Support for its Design counterpart reaches F9, F10, F12,
and the defining Interface and State Facets.

Hashes bind inputs and calculations; matching hashes are not substitutes for
behavior comparison. Equality is conditional on the represented source
meanings and declared boundary, not a theorem about all possible programs or
all natural-language interpretations.

## 12. Remove cancellation and derive the counterexample

Edit the Rust function by deleting the R4/R5 branch. The new function retains
the request check, write, and successful return:

```rust
fn publish(
    state: &mut State,
    response_id: RequestId,
    incoming: Payload,
) -> PublishResult {
    if response_id != state.active_request {
        return PublishResult::Ignored;
    }
    state.results = incoming;
    PublishResult::Published
}
```

The source edit invalidates the old Rust binding and dependent current proofs.
Until a fresh accepted interpretation is available, the affected comparison
is Unresolved. History can identify impact but cannot keep the old Equal alive.

The fresh projection is independently read from the new bytes. Relative to
section 6, its complete operation slice keeps the same input/slot/value nodes,
request comparison, stale return, store, and successful return. Its control-flow
change is exactly:

```text
absent:
  all triples for r:readCancelled
  all triples for r:checkCancelled
  all triples for r:returnCancelled
  (r:checkRequest, a:onFalse, r:checkCancelled)

present instead:
  (r:checkRequest, a:onFalse, r:store)
```

This is a display of the semantic difference, not an instruction to patch the
old accepted projection. `r:cancelled` remains a represented state slot because
it is still part of State and the boundary observes its preserved value. Every
surviving fact receives current binding support; old occurrences are not reused
as current evidence merely because their display keys match.

Composition now yields:

```text
NOT m -> O0(a, c, z)
m     -> O1(a, c, v)

R_new_admit = If(Not(m), false, true)
            = And(Not(Not(m)), true)     [L1]
            = m                         [L3, L2]
```

Design remains `And(m, Not(c))`. Failure to prove their equality is not the
verdict. The finite calculation finds an actual differing input:

```text
x = (ResponseId=r0, ActiveRequest=r0, Cancelled=true,
     IncomingResults=v1, Results=v0)

Design condition:  true AND NOT true = false
Rust condition:    true

D[x]     = { ([], Return(Ignored), (r0, true, v0)) }
R_new[x] = { ([Publish(Results, v1)], Return(Published), (r0, true, v1)) }

Distinguishing observation: R_new[x]'s tuple is not in D[x].
Result: Different.
```

The entire table differs on the 8 keys satisfying `m AND c`. On 4 of those
keys the incoming and old payloads happen to match; the action and returned
alternative still differ. A valid single witness suffices for Different; an
exhaustive count requires completing the table calculation.

### Point to the current disagreement, not just the deleted line

The current admitting path is supported by the surviving request branch's
false successor, the current assignment, and the current Published return.
Its explanation links to these Design requirements:

| Required contribution | Witness discrepancy |
| --- | --- |
| F9 / Admission | Publication is admitted although cancellation makes Eligibility false. |
| F11 with F4 / Publication | The required ignored branch should preserve Results and return Ignored. |
| F13 / Admission | A cancelled response produces a publication action. |
| F17 / Admission Case | The active cancelled-response scenario has the wrong joint observation. |

F12 still holds: the changed code preserves ActiveRequest and Cancelled. The
stale-response and happy-path Case comparisons also remain equal on their own
domains. F14 is not itself refuted by this witness: the changed code returns
Published, so its condition on Ignored outcomes is not activated. This is why
diagnostics follow actual supported predicates, not every Facet in a Concept.

The removed cancellation check has no current range. Show its old location
only as historical context. The fresh result points to current code and the
authored Facets and does not require an old projection to establish Different.
It identifies the differing behavior and its premises, not a unique minimal fix.

## 13. The same calculation across other languages and sources

A TypeScript positive guard can independently lower to the same small units:

```typescript
function publish(state, responseId, incoming) {
  if (responseId === state.activeRequest && !state.cancelled) {
    state.results = incoming;
    return Published;
  }
  return Ignored;
}
```

Its condition lowers directly to `And(m, Not(c))`; its control graph has the
two Design-shaped terminal paths. Its own source and environment must establish
the finite value mapping, ordinary field access, absence of hidden effects, and
other boundary assumptions. Rust's guarantees do not supply TypeScript's missing
meaning. It is a separate target with its own q_publish comparison and verdict.

A Markdown source can independently describe the same boundary:

> Publish a response exactly when its request is active and not cancelled.
> On publication, replace Results with IncomingResults and return Published.
> Otherwise perform no publication, leave Results unchanged, and return Ignored.
> In both cases leave ActiveRequest and Cancelled unchanged.

Its interpretation can supply the same operation graph as section 5 with new
source-local anchors and its own support. Compare Markdown with Sigil in a
separate Design-to-Design query. Do not combine their facts and call the merged
model proof of agreement. A shorter statement saying only "ignore stale
responses" supports a narrower property, not the full 32-row operation table.

The reusable achievement is this pipeline, not a publication-specific magic
predicate. A wrong payload, swapped return, extra write, or reordered observable
action changes a joint observation even when admission stays equal. A missing
callee, unsupported effect, incomplete domain, or unresolved mapping blocks the
relevant equality rather than triggering the old capability matcher.

Module assembly and helper composition can build on these results only with
their own explicit ownership, call, state, and argument relationships. Snapdir
and semantic bindings decide which captured observations are current; they do
not prove those relationships or freeze a live source tree. Broader domains,
concurrency, or publication protocols require additional supported semantics.
The concrete first deliverable is the trace above, calculated and explained by
the implementation rather than supplied as the semanticizer's conclusion.
