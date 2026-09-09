# Audit of the proposed Sigil kernel

Date: 2026-09-09.

`packages/kernel/` is an initial refactor proposal. Its README, ARCHITECTURE,
and example describe the intended target, not an implemented kernel. The
current implementation audited here is `packages/sigilc/`, with the structural
frontend in `packages/core/`. Egglog and Snapdir were inspected in
`repos/egglog/` and `repos/snapdir/`, including executable Rust implementation,
not just documentation. Sigil's vendored Snapdir integration was also inspected.

The language authority for this revision is [language.md](../../language.md),
including the author's clarifications about native Facets, Embedded Facets,
shared Concept identity, and Interface exports. Older specifications and current
frontend limitations are evidence of migration work, not reasons to narrow that
language. The proposed computation is defined in
[behavior_algebra.md](behavior_algebra.md); this audit applies it to the refactor
and existing implementation rather than maintaining a competing algebra.

This is a static architecture and source audit. No compiler runs, tests,
benchmarks, or independent semantic reconstructions were performed. Examples
and acceptance checks below are proposals, not reported execution results.

## Recommendation

Keep both chosen primitives. Snapdir supplies content identity and discovery;
Egglog supplies compositional inference and equality reasoning. Keep the
proposal's independent worlds, opaque semanticization, typed correspondence,
disposable projection store, and removal of compiler-owned orchestration.

Build the kernel around **Concept-linked Facets interpreted through the seven
contracts**. Concept identity connects the contributions; each Facet supplies
an attributable statement; its contract determines that statement's role.
Interface-defined identifiers connect operations, values, and results across
imports. Components retain ownership, and module indexes assemble public
surfaces without absorbing their imported behavior.

Below that language structure, use the algebra's small units: values,
expressions, conditions, state descriptions, observable actions, outcomes,
steps, and relationships. Use relational identities for source attribution and
e-classes for behavioral terms that fixed laws can actually equate. Start with
the algebra's SearchPublication example: first prove its admission decision,
then its joint actions, outcome, and next state. A removed cancellation check
must produce a distinguishing scenario linked to the affected native Facets.
Apply the same machinery to PreparedBinding after the observation and proof
path works.

The controlling definitions are
[language foundations](behavior_algebra.md#start-with-the-language-we-have),
[the small units](behavior_algebra.md#the-small-units-underneath-the-contracts),
and [the first useful implementation](behavior_algebra.md#the-first-useful-implementation).

The defensible product claim is:

> For a declared scope and supported semantic model, sigilc proves that the
> independently reconstructed design and implementation behaviors are equal
> under fixed laws, or reports a witnessed disagreement at the implicated
> design obligations and source observations. Missing information remains
> unresolved.

“Equal” means equal at the stated boundary and domain, as defined in
[what equality means](behavior_algebra.md#what-equality-means-here). It does
not mean equal source syntax, matching labels, equal numbers of Facets, or
coverage of the same capability names.

The proof is conditional on the accepted reconstructions faithfully representing
the sources. Hashing proves which inputs were bound; graph validation proves
admissibility; Egglog proves consequences of those inputs and laws. None of
these independently proves an LLM's interpretation of arbitrary code or prose.
This boundary need not weaken the useful capability, but it must be part of
what `Closed` means.

## Findings, in priority order

### P1. The proposal confuses a native Concept block with an individual Facet

Proposal: [example.md, concrete SemanticBridge](example.md#7-concrete-semanticbridge-fresh-design-to-closed).
Canonical language: [Concepts](../../language.md#one-concept-several-views) and
[Facets](../../language.md#facets-are-the-statements-not-just-the-headings).

The example declares both `SemanticBridge { ... }` and `ComparisonReport { ... }`
inside Interface, then identifies `ComparisonReport` as an Interface Facet of
the SemanticBridge Concept. Under the clarified language, both headings declare
Concepts. The statements inside them are their native Facets.

The distinction changes the graph, not just terminology. The example contains:

```text
C_bridge = Concept SemanticBridge
C_report = Concept ComparisonReport
F_compare = Facet describing acceptance of exports and production of a report
F_contents = Facet describing the report's contents

F_compare contributes to C_bridge
F_contents contributes to C_report
F_compare describes an interaction whose result refers to C_report
```

The relation between the two Concepts comes from the Facet's meaning. It must
not be implemented by reclassifying the result Concept as a Facet. The same
applies to repeated Concept blocks across Interface, State, Logic, Constraints,
Decisions, and Cases: they share Concept identity while retaining their
individual Facets and source occurrences.

**Change:** correct the README, architecture, canonical example, ontology, and
frontend transport around native Facets before adopting the proposed anchor
schema. An ordinary Facet ends at one empty line; an Embedded Facet retains
its fenced content and notation. One Facet can lower to several algebra units,
all with the same source support. A Concept need not have one artificially
named Facet per contract.

The relevant algebra definitions are
[language foundations](behavior_algebra.md#start-with-the-language-we-have),
[contract contributions](behavior_algebra.md#how-each-contract-contributes-to-the-calculation),
and [connections within and between Concepts](behavior_algebra.md#concepts-connect-explicit-relationships-finish-the-connection).

### P1. The canonical composition still delegates the behavioral judgment to the LLM

Proposal: [example.md, sections 2-4](example.md#2-the-implementation-binding-exposes-anchors-not-design).
Current seed: [kernel.egg](../sigilc/src/kernel.egg) and
[comparison.egg](../sigilc/src/comparison.egg).

The proposed rule is a meaningful improvement in attribution:

```text
factorsThrough(M, S), denotes(S, C), implements(S, C),
denotes(M, F), provides(M, F)
    -> realizes(C, provides, F)
```

However, the semantic content of “the method provides ImmutableBinding” is
already inside `provides(M, F)`. The kernel does not inspect whether publication
rejects stale generations, whether a write is atomic, or whether a forbidden
overwrite occurs. Removing a generation check could leave all five observations
unchanged. Deriving a terminal predicate does not by itself move that judgment
from the model into mathematics.

The `SemanticBridge` example has the same boundary: its wrapper delegates to
`self.kernel.compare`. The local file can establish a call and its returned
value, but not the callee's full comparison semantics without independently
reconstructed callee behavior.

**Change:** retain this rule for an explicitly structural interface claim.
Require behavioral obligations to match a derived behavior summary with
observable inputs, outputs, guards, and effects. Let the model observe calls,
branches, data flow, returns, and ownership; let fixed laws compose them into
the behavioral claim. Do not rename a model's `immutable` or `safe` assertion
into a supposedly lower-level generator.

Concretely, use the algebra's
[expressions](behavior_algebra.md#expressions-calculate-without-changing-the-world),
[steps](behavior_algebra.md#steps-put-the-pieces-together), and
[sequential composition](behavior_algebra.md#sequential-behavior). A derived
admission condition is a stronger result than an asserted capability, but it
still does not establish the operation's writes or returned value. Match the
full behavior required by the relevant Facets.

### P1. Obligation coverage does not establish behavioral equality

Proposal: [ARCHITECTURE.md, computation and comparison](ARCHITECTURE.md#the-computation-exactly).
Current seed: [comparison.rs, `compare`](../sigilc/src/comparison.rs).

The proposed matcher establishes that required tuples occur in the
Implementation result. An implementation can provide everything required and
also perform an unwanted extra write. Unless that write is represented by a
prohibition, tuple coverage still succeeds. The current comparator similarly
ignores extra positive facts except where a fixed contradiction law applies.

Define the comparison mode per obligation:

| Mode | Required theorem |
| --- | --- |
| Capability | The implementation supplies a specified observable capability. |
| Safety/refinement | Every represented implementation behavior is permitted by the design. |
| Equality | Design and implementation have the same behavior at the declared observation boundary. |

For a complete finite transition model, refinement can be trace inclusion;
equality can be trace equality or an explicitly chosen behavioral equivalence.
For pure functions, equality is equal outputs on every input in the declared
domain. These are different obligations. A design that intentionally leaves
behavior open should not require equality of everything the implementation does.

**Change:** retain `Drift`, `Converged`, and `Closed` as aggregate statuses, but
report the obligation's mode, domain, assumptions, proof, and coverage.
`Closed` must not silently upgrade capability coverage into program equality.

Use the algebra's exact definition of
[equality at a boundary](behavior_algebra.md#what-equality-means-here) and its
[treatment of partial statements](behavior_algebra.md#do-not-ask-a-partial-statement-to-specify-a-whole-program).
A Constraint can require that a particular bad event never occurs while
leaving other behavior open. Equality of that event/property view is a precise
result; equality of the whole operation would be a stronger, unsupported claim.

Every result should identify the native Facets defining its boundary. Global
`Closed` must be qualified by the selected scope and its declared requirements.
Several separately proved properties establish full public behavior equality
only if their combined observations retain every distinction that boundary
can observe.

### P1. Matching Facets independently can lose correlations between their observations

The proposed tuple matcher has no representation for a correlated result,
effect sequence, or next state. It can match that a status and a payload are
provided without establishing that they occur together in the required way.

The algebra's [joint-observation example](behavior_algebra.md#compare-related-observations-together)
shows the failure:

```text
Design:          (Ready, value) or (Failed, error)
Implementation:  (Ready, error) or (Failed, value)
```

Each individual field has the same possible values; the pairs are different.
Likewise, finding both validation and publication does not show that validation
precedes publication. Finding a rejected outcome does not show that the
rejected path preserved state.

**Change:** preserve a joint `(ordered actions, outcome, next relevant state)`
for each condition and input. Conditions, parameters, resources, and operation
identities connect the Facets within a Concept. Do not independently pool
observations across branches, operations, implementation targets, or source
generations. See [steps](behavior_algebra.md#steps-put-the-pieces-together),
[alternatives](behavior_algebra.md#alternatives), and
[state transitions](behavior_algebra.md#state-transitions-and-repeated-interactions).

### P1. A blanket prohibition on e-class union prevents the proposed equality capability

Proposal: [README.md, correspondence hierarchy](README.md#a-hierarchy-of-correspondence-not-blanket-sameas)
and [ARCHITECTURE.md, typed correspondence](ARCHITECTURE.md#typed-correspondence).

Not unioning source anchors is correct. `Age`, `age`, and `age_years` must remain
separately attributable observations. But the architecture's broader statement
that the kernel must not use e-class union needs narrowing. The present seed
uses `String` relations, relational closure, and `min`/`max` functions; it does
not use term equality to recognize alternative behavioral formulations.

**Change:** use two representations:

```text
AnchorId / ObservationId / OccurrenceId / ObligationId
    immutable identities; never unioned

BoolExpr / ValueExpr / ProtocolExpr
    typed behavior terms; equated only by sound compiler-owned laws

describes(anchor, expression)
supportedBy(observation, occurrence)
```

`denotes`, lexical aliases, and broad correspondence never cause term union.
An accepted `equivalentTo` claim is not automatically a rewrite axiom either:
unless explicitly declared a trusted assumption, it is a candidate to prove.
Equating behavior terms does not erase source attribution when attribution is
kept outside the quotient.

Follow [how Egglog carries the calculation](behavior_algebra.md#how-egglog-should-carry-the-calculation).
The term families above are illustrative implementation types, not another
language or permission to equate unsupported protocols. Begin with the
algebra's [pure-expression laws](behavior_algebra.md#pure-expression-equality):
purity and totality are premises, not consequences of a Boolean result type.
Extraction chooses a representative after calculation; its cost is not evidence
of truth, and unequal representatives are not a counterexample.

### P1. “Exactly where” requires proof support and source occurrences from the beginning

Proposal: optional documentary spans and deferred Facet precision.
Current seed: [turtle.rs, `Assertion::id`](../sigilc/src/turtle.rs),
[kernel.egg, `because`](../sigilc/src/kernel.egg), and
[report.rs, `Locations::resolve` and `implementation`](../sigilc/src/report.rs).

Current fact IDs hash only the normalized triple. Assembly maps those IDs to
source files. Implementation diagnostics deliberately have file-only locations.
`because` carries an asserted fact or an intermediary identity, not every
premise of a derivation. The report selects matching immediate rows and does
not reconstruct a full proof tree. Some violation rules retain only one of
the contradictory facts' IDs.

That cannot reliably explain a disagreement composed across several methods
and files. Facet-sized cache bindings alone would not repair it. The native
Facet must already be an attributable source unit before its interpretation
is decomposed into several observations.

**Change:** preserve three different identities:

```text
factId       = hash(normalized semantic observation)
occurrenceId = hash(binding, factId, source span/occurrence key)
derivation   = ruleId + substitution + premise references + conclusion
```

Allow one fact to have several occurrences and several alternative derivations.
For behavior-bearing observations, collect byte ranges and an exact excerpt
digest against the captured source. Ingest can validate bounds and excerpt
bytes without parsing the implementation language. This verifies the location,
not the truth of the interpretation attached to it.

Preserve full support for the reported theorem. Bound presentation separately
from proof computation. A truncated display may link to a complete witness;
an exhausted proof computation may not masquerade as a completed proof.
For a missing operation, point to the failed design obligation and current
enclosing implementation observation, with historical locations explicitly
marked historical. Do not fabricate a current line for deleted code.

For an Embedded Facet, retain its introducing prose, notation, and fenced-body
range. A supported interpretation can identify a more precise subrange inside
the diagram or snippet; otherwise point to the whole Embedded Facet. Unsupported
embedded meaning is an explicit gap, not an empty behavior that matches another
empty behavior. See [contract contributions](behavior_algebra.md#how-each-contract-contributes-to-the-calculation)
and [required result support](behavior_algebra.md#what-the-result-must-retain).

### P1. Negative requirements and loss of behavior need explicit semantics

Current seed: [comparison.egg](../sigilc/src/comparison.egg) and
[comparison tests](../sigilc/tests/comparison.rs).

The current rules correctly refuse to satisfy a prohibition from an absent
positive row. There is also no rule that can prove a prohibition satisfied.
Consequently a correct implementation with a negative obligation remains
`Converged`. The proposal preserves the epistemic rule but does not supply the
missing proof mechanism.

Likewise, absence of `provides` after an edit only leaves a positive obligation
unresolved. It does not prove the implementation violates that obligation.
Different e-classes are also not proof of different semantics: the rule set or
search may be incomplete.

**Change:** begin with a complete finite behavioral fragment. Establish negative
claims through exhaustive evaluation or a checked invariant over a closed
transition model. A missing transition list, unresolved external call, or
unsupported construct leaves the model open. A model-supplied `complete=true`
is insufficient to establish source completeness; structural closure of the
submitted model and faithfulness to source remain separate questions.

Emit `Drift` only for a positive contradictory observation, a valid
counterexample, or another supported refutation. Otherwise emit an explicit
unresolved reason. This distinction is essential to honest change diagnostics.

The algebra's [result definitions](behavior_algebra.md#complete-calculations-honest-results)
also require completeness checks after the relevant computation finishes.
Neither unfinished saturation nor an accidentally empty input domain counts as
coverage. A valid local refutation can survive unrelated unresolved meaning;
an incomplete overall world is not a reason to hide an established violation.

### P1. The proposed realization tuple loses which implementation must satisfy it

Proposal: [README.md, Rust/Deno chain](README.md#worked-chain-readmemd--sigil--rustdeno)
and `realizes(Concept, predicate, Facet)` in [example.md](example.md).

If Rust and Deno are independent implementations, a Rust witness can satisfy
the shared tuple while Deno contributes no behavior. Freshness of both files
does not imply coverage by both implementations. Conversely, fragments of two
different backends must not accidentally compose into one implementation.

**Change:** bind comparison to explicit implementation targets and a coverage
quantifier. A target may contain several cooperating source files; it is not
necessarily one file or language. For example, `rust-backend` and `deno-backend`
each require their own realization. Carry the target dimension in facts or
isolate each target's graph and result. Make `each`, `any`, and collective
composition explicit. Scope is still semantic membership, not a task queue.

### P1. Snapdir content identity is not an atomic snapshot or a full semantic binding

Actual primitive: [hash_file.rs](../../repos/snapdir/crates/snapdir-core/src/hash_file.rs),
[walk.rs](../../repos/snapdir/crates/snapdir-core/src/walk.rs), and
[merkle.rs](../../repos/snapdir/crates/snapdir-core/src/merkle.rs).
Current integration: [sources.rs](../sigilc/src/sources.rs),
[inputs.rs](../sigilc/src/inputs.rs), and [store.rs](../sigilc/src/store.rs).

Snapdir is the right byte-identity primitive, with important boundaries:

- `directory_checksum` hashes sorted, deduplicated child checksums. It does not
  bind child names or multiplicity. A rename or removal of one duplicate can
  leave it unchanged. It is not a valid Sigil scope identity by itself.
- `snapshot_id` hashes serialized manifest text, including paths. Sigil's
  existing `source_manifest` instead hashes sorted `(path, file, checksum)`
  rows, deliberately excluding filesystem metadata. Preserve that path-aware
  identity when source semantics depend only on path and bytes.
- `walk_inner` enumerates first, hashes pending files, then assembles a manifest.
  It does not freeze a tree. `hash_pending` checks recorded size and handles
  disappearance/mmap faults, but does not establish an atomic multi-file view.
- In `blake3_hash_file`, the returned length comes from metadata read before
  hashing. Do not treat it as an independently counted number of bytes read
  under concurrent modification. Same-size edits also need more than size
  comparison.
- `CopyGuard` is a stat-based optimization aid, not proof of content identity.
  Its surrounding object-store trust model must not be silently transplanted
  into semantic freshness.
- Linked-object checksum recovery can trust an object's address without reading
  its bytes. Current Sigil uses `NoFollow` and empty object-store hints, so it
  does not use that shortcut. Keep those settings unless verified snapshot
  objects become an explicit input mode.

Current `sources::capture` is stronger than a bare walk: it retains actual
bytes, hashes them, then hashes the path again. The explicit-file discovery
path also compares metadata and `CopyGuard`; the directory path delegates to
Snapdir's walk. Neither a projection-store lock nor several sequential hashes
stop an editor from changing source files.

**Change:** make the theorem refer to a captured, immutable input manifest.
Use Snapdir to discover/hash and Sigil to bind exact copied semantic inputs.
Recheck required source and membership inputs before publication and before
labeling a report current; if they changed, report unavailable/stale. Describe
this as current at validation, not permanently current or an atomic snapshot.
An actual point-in-time tree guarantee requires a quiescent source or filesystem
snapshot. This distinction should be explicit, not hidden in the word “fresh.”

### P2. The current frontend and catalog carry less than the canonical language

Current transport: [design-input.ts](../core/src/design-input.ts),
[frontend.rs](../sigilc/src/frontend.rs), and
[catalog.rs](../sigilc/src/catalog.rs). Canonical definitions:
[shared Concepts](../../language.md#one-concept-several-views) and
[Interface exports](../../language.md#interface-gives-the-vocabulary-a-passport).

The earlier audit treated cross-contract Concept identity as a questionable
proposal against an older specification. That assessment was too narrow.
Shared identity is a foundation of Sigil, already visible in the repeated
`LiteralBlock` Concept in [parser.sigil](../core/src/parser.sigil) and
`DesignConversation` in the [skill contract](../../integrations/skills/sigil/design-conversation.sigil).
The task is to preserve that identity through transport and calculation.

The current frontend already inventories physical semantic units and exports
resolved Component and locally owned Concept entities. However, `Unit.concept`
is only text. It does not transport the resolved Concept reference for each
contribution. Its entity types are only Component and Concept; there is no
public-identifier category for an operation or domain term defined within an
Interface Facet. It also lacks explicit Embedded Facet representation metadata.
These are implementation gaps, not restrictions on the language.

**Change:** preserve the following distinctions through frontend, accepted
Design observations, and outgoing descriptors:

| Native meaning | Required representation |
| --- | --- |
| Shared Concept | Resolved originating identity, independent of the contract occurrence using it. |
| Facet | Authored unit, contextual component owner, contract kind, optional resolved Concept, and source range. |
| Embedded Facet | The same ownership and attribution, plus introducing prose, notation, and fenced content. |
| Interface-defined identifier | Typed public identity, defining Facet, originating owner, and source-supported definition. A Concept block is not required. |
| Imported reference | The provider's identity and its visibility in this consumer, not a new same-spelled declaration. |
| Matching expand | Additional contributions to its resolved component, with their own source occurrences; no last-writer override. |
| Module assembly | Explicitly exposed component surface with original ownership, separate from runtime invocation. |

Use the existing Sigil resolver for structural identities and scopes. Keep
structural export of Facets distinct from interpreting definitions inside their
prose: the deterministic frontend need not become an arbitrary-language meaning
extractor. Accepted Design interpretation can supply typed, source-supported
public definitions, validated against their Interface owner and accessible
scope. Ambiguous definition/reference distinctions remain unresolved. Do not
export every prose word, invent new `export` syntax, or force authors to wrap
every public term in a Concept.

A consumer contribution about an imported Concept retains consumer context and
does not rewrite its provider upstream. Conversely, independently declared
same-spelled Concepts in unrelated scopes do not become one identity. These
are scoping rules around the shared primitive, not objections to it.

Do not force every implementation expression, branch, or local variable into a
fake Concept or Facet merely to fit the proposal's two-type descriptors. Local
observations have the algebra's own types and explicit correspondence to
applicable native/public identities. An ungrouped native Facet remains valid.
See [language foundations](behavior_algebra.md#start-with-the-language-we-have)
and [explicit connections](behavior_algebra.md#concepts-connect-explicit-relationships-finish-the-connection).

### P2. Cross-file composition needs an explicit linkage surface

The proposal admits local anchors but restricts direct external references to
the incoming anchor set. Independent workers seeing only their own file and
Design descriptors cannot necessarily name a helper's implementation-local
anchor. Hashing source-local keys does not resolve that connection.

**Change:** initially prove behavior wholly represented within one file, and
report unknown external calls. Then add explicit exported implementation
anchors and source-local reference observations. Compose a call with an
independently reconstructed callee summary only when the link, argument mapping,
target membership, and freshness are established. No lexical join or Design
capability is a substitute for the callee summary.

If workers consume behavior summaries, those summaries become semantic binding
inputs. If they consume only stable identities and assembly joins current
callee behavior later, callee edits need not invalidate the caller projection.
These two designs have different freshness consequences. Choose explicitly.
Handle recursive source dependencies as a declared boundary; do not imply that
every incoming-anchor graph can be prepared in a simple topological order.

Sigil already contributes the public linkage vocabulary through Interface and
imports. Reuse it rather than infer a second design namespace from code names.
Still distinguish an imported name, an exposed component, and an actual call.
The [core module](../core/_module.sigil) assembles public contracts; the
[workspace pipeline](../core/src/pipeline.sigil) separately owns stage ordering,
result assembly, and diagnostic deduplication. Only the latter Facets describe
that runtime sequence. This is the algebra's distinction between
[relationships](behavior_algebra.md#relationships-structure-also-has-meaning)
and [component/module composition](behavior_algebra.md#component-and-module-composition).

## What the actual Egglog implementation enables

The engine supports the proposed direction. The missing piece is Sigil's
representation and laws, not a need to replace Egglog.

| Inspected source | Mechanism | Consequence for the refactor |
| --- | --- | --- |
| `repos/egglog/src/lib.rs`, `EGraph::step_rules` | Ruleset execution and update reports | Keep explicit phase scheduling and bounded runs. |
| `repos/egglog/egglog-bridge/src/lib.rs`, `run_rules`, `rebuild`, `UnionAction::union` | Staged unions, execution, and canonicalization | Equality changes subsequent matching; it is more than transitive string relations. |
| `repos/egglog/core-relations/src/table/rebuild.rs`, `do_rebuild` | Incremental/full rebuilding of affected table values | Relations over behavioral terms can match modulo discovered equality. |
| `repos/egglog/tests/web-demo/matrix.egg` | Constructors, guarded rewrites, dimensions, composed expression equality | Shape facts can justify recognition of a higher-level composition. |
| `repos/egglog/tests/web-demo/rw-analysis.egg` | Control-flow facts and an abstract-value analysis | Low-level observations can support global behavior analysis. |
| `repos/egglog/src/proofs/proof_encoding.md` and proof implementation | Explicit equality tracking, rule premises, congruence, proof extraction | Use native proof support for the supported term fragment. |
| `repos/egglog/tests/proofs/eqsat-basic-proof.egg` | A `prove` query over two algebraically equivalent expressions | A behavioral equivalence can have a concrete derivation artifact. |
| `repos/egglog/tests/api_proofs.rs` | Proof mode rejects APIs that bypass instrumentation | Do not assume arbitrary Rust callbacks/direct updates remain provable. |

The earlier paper interpretation needs one qualification: Egglog recovers latent
structure **when the representation retains the relevant distinctions and the
laws express that structure**. It does not discover arbitrary domain laws from
unstructured triples. The paper's contribution combines Datalog analyses with
term rewriting and congruence closure; that combination is precisely what a
behavioral layer would use. See
[Better Together: Unifying Datalog and Equality Saturation](https://arxiv.org/abs/2304.04332).

Use extraction to choose a readable expression or compact witness after proof;
do not use extraction cost as truth. Two different extracted representatives
do not establish inequality. The official
[equality-saturation tutorial](https://egraphs-good.github.io/egglog-tutorial/01-basics.html)
also distinguishes inserting expressions, defining laws, executing them, and
checking equality.

The checked-out engine exposes `EGraph::new_with_proofs`, `prove`, and a
`ProofStore`; the proof checker validates rule applications and supported
primitive side conditions against the supplied program. It does not certify
that a supplied law models Rust or that an input observation is true.
Native proofs also have a supported subset, visible in the API tests and
`tests/snapshots/files__proof_unsupported_files.snap`. Name every Sigil law and
exercise proof support early in the implementation, before committing to
container or primitive choices. A concise, checked relational derivation DAG
remains useful for correspondence and source support.

There is a dependency distinction to resolve during implementation:
[sigilc's Cargo.toml](../sigilc/Cargo.toml) pins Egglog to
`90635860397ce710f8c0a4eeb04154a8ebc3ac05`; the inspected local Egglog manifest
declares version `3.0.0`. This audit does not establish that the checkout equals
that pin. Likewise, Sigil's Snapdir Git dependency is patched to
`vendor/snapdir-core`, not directly built from `repos/snapdir`. The inspected
vendored hash/walk bodies share the relevant mechanisms, with portability
changes. Choose and record the actual build sources; do not infer API support
from a neighboring checkout's version alone.

## A small behavioral layer that preserves the proposal's intent

### Observation transport and typed lowering

Keep Turtle as a data transport. Its serialization format is not the obstacle.
The current restricted `.egg` encoder/reader in
[assertions.rs](../sigilc/src/assertions.rs) should continue to reject executable
rules, includes, arbitrary expressions, and compiler-derived verdicts.

Extend the fixed ontology with the algebra's
[eight small units](behavior_algebra.md#the-small-units-underneath-the-contracts),
not a separate instruction set for each contract or programming language:

| Algebra unit | Examples | Compiler responsibility |
| --- | --- | --- |
| Value | Boolean, defined name, finite alternative, record, resource | Preserve type, payload, identity, and value distinctions. Missing, null, empty, and unknown are not interchangeable. |
| Expression | Input/state reference, field selection, admitted pure operation | Check operand types and roles; lower to fixed terms with explicit numerical or other value meaning. |
| Condition | Branch guard, scenario domain, forbidden-state predicate | Evaluate the Boolean meaning while retaining its role. A code guard does not create a Design precondition. |
| State description | Active request, cancellation flag, public Results | Validate explicit representation mappings and preserve history relevant to later interactions. |
| Observable action | Publish a value, write a resource, emit an event | Preserve target, contents, order, and repetition at the declared boundary. |
| Outcome | Return a value, fail, remain pending, diverge | Keep these distinct; never encode unsupported meaning as an outcome. |
| Step | Guarded actions, outcome, and next state | Compose paths without losing their joint behavior; check the supported fragment's closure. |
| Relationship | Owns, exposes, invokes, contributes | Validate endpoint types and scope; distinguish namespace assembly from runtime behavior. |

New classes and predicates should be canonical `sigil:` vocabulary, not a
Rust-specific AST. Reified expression nodes fit Turtle; native lowering can
construct Egglog terms after graph validation. Branch and successor observations
can be a source-local way to describe steps without becoming new Sigil language
primitives. Source identity, occurrence support, contract role, and production
versus test role accompany these observations; they are not extra behavior laws.

For the first fragment, require acyclic, typed expression graphs and explicit
unknown nodes. Reject ambiguous operand cardinality and wrong-side assertions.
Do not union conflicting observations to “repair” them. Open or conflicting
meaning relevant to a selected boundary must not produce behavioral equality.

### Use the seven contracts as interpretation roles

The contracts are not merely labels on otherwise identical `provides` facts.
They tell interpretation what a contribution does. Apply
[the algebra's contract definitions](behavior_algebra.md#how-each-contract-contributes-to-the-calculation)
as follows:

| Contract | What the refactor should calculate | What must not substitute for that calculation |
| --- | --- | --- |
| Goal | An explicitly defined outcome/property view under its applicable conditions. | Turning qualitative purpose into invented executable requirements or claiming it has been proved because its text is present. |
| Interface | Public operation/value identities and joint result, failure, action, and state meaning. | A matching signature, Concept heading, or result-type name. |
| State | Relevant quantities and configurations under a supported, attributable representation mapping. | Equal state labels while hidden state changes later behavior. |
| Logic | Pure calculations, conditions, guarded steps, sequencing, and supported delegation. | Finding every named operation without establishing arguments, order, continuation, or callee behavior. |
| Constraint | A predicate on states, steps, traces, or complete structural relationships. | Missing positive facts as proof of a prohibition, or a restriction reported as whole-operation equality. |
| Decision | Applicable choices and assumptions connected to their rationale and binding restrictions. | Treating discarded alternatives as requirements, or silently turning rationale into a new Constraint. |
| Case | Given conditions, actions, and expected observations for a concrete scenario or an explicitly quantified family. | Requiring a test file, equating test names, or generalizing a happy-path example to every input. |

One Facet may supply several units; several Facets may jointly define one
operation. Keep an interpretation disposition for every selected native Facet:
represented meaning, interpretive context, or an explicit gap. Context is not a
hidden success state: if the selected claim needs an observable interpretation
that is still missing, that comparison remains Unresolved.

Shared Concept identity gives a reliable starting connection, not permission
to combine unrelated operations under that Concept. Bind each condition,
action, state quantity, and outcome to the operation and resources it concerns.
Connections between different Concepts can be equally important: the pipeline's
Interface `WorkspaceResolution` and operational `WorkspaceResolutionPipeline`
need their explicit operation/result relationship, not forced name equality.

### Cases, tests, and Embedded Facets retain their roles

Use the algebra's [Case decomposition](behavior_algebra.md#cases-and-tests-use-the-same-smaller-units):

```text
given:   starting-state and input condition
actions: operation or operation sequence
expect:  required observation or predicate on the resulting trace
```

Happy paths, sad paths, cancellation, recovery, and boundary scenarios all fit
these units. A concrete scenario, a family of scenarios, a required outcome,
and a permitted outcome have different quantifiers. Preserve them rather than
guessing a universal rule from a representative example.

Production behavior, test expectations, and mock behavior must stay separate
even when they share a Concept or inhabit one file. The compiler can compare
what a test sets up and asserts with a Case, and independently compare the
production operation with that Case. Test-source correspondence is not proof
of test execution or of production behavior; a mock cannot satisfy a missing
production callee. This opens a useful scenario-coverage capability without
making tests the definition of Cases.

An Embedded Facet uses its surrounding contract's role. A Mermaid transition
diagram can supply state and step observations; a JSON Interface shape can
supply value meanings; code in Cases can describe a scenario. Neither the fence
label nor code-like syntax changes Design material into production evidence.
Unsupported notation or ambiguous transitions remain visible gaps. The kernel
compares the resulting supported units, not the raw diagram syntax.

### Independent closures and the comparison boundary

Preserve:

```text
D* = close_design(fresh Design observations)
I* = close_implementation(fresh Implementation observations)
O  = obligations(D*)
R  = compare(O, summaries(I*))
```

The comparator needs a richer input than `(Concept, predicate, Facet)`:

```text
boundary(subject, target, inputs, assumptions, observations, valueMeanings)
obligation(id, boundary, contributingFacets, mode, expectedBehavior)
summary(target, operation, sourceRole, behavior, support, modelStatus)
```

These are logical record shapes, not a prescribed public Rust API. Keep semantic
contents typed and provenance separate from identity matching. The subject can
include an ungrouped Facet or several related Concepts. Several contributing
Facets do not imply several independent comparisons if their observations are
coupled. Fix the boundary before examining a mismatch; do not hide the mismatch
by deleting an observation or importing an implementation-only precondition.

Implementation reconstruction receives captured source, fixed vocabulary, and
authorized identity/type descriptors, not the Design's expected conditions,
Cases, result tables, or comparison feedback. Descriptor labels must not become
a channel for smuggling those expected behaviors into the independent reading.
Markdown-to-Sigil correspondence likewise supplies identities, not an assumption
that the later description is faithful or more complete. Missing Markdown
meaning must not be filled from the desired target. See
[independent reconstruction](behavior_algebra.md#keep-the-two-reconstructions-independent).

Independent e-graphs do not share stable e-class IDs. Never compare their
internal IDs or stringify their chosen representatives and call that equality.
For a small complete finite domain, independently export the full behavior
table in a canonical input order and compare exact entries. For symbolic
equality, export selected root term DAGs and their assumptions into a third,
law-only equality query. It may insert both expressions as query subjects; it
must not assert their equality or import Design capability facts as
Implementation premises. This is a typed comparison operation, not
`close(D union I)`.

Domain assumptions must be identical on both sides or discharged by the
comparison. For example, a pure Boolean simplification cannot erase an
effectful call that happens to return a Boolean. Floating-point expressions,
overflow, exceptions, mutation, aliasing, and nondeterminism require their own
semantics before corresponding algebraic laws become admissible.

Use [Equal, Different, and Unresolved](behavior_algebra.md#complete-calculations-honest-results)
for the actual boundary calculation. Existing aggregate names can remain as
presentation, with `Drift` carrying a supported refutation, `Converged` retaining
unresolved obligations, and `Closed` requiring the declared mode's completed
proofs plus coherent Design and current required inputs. A scope containing
only capability checks must not advertise behavioral equality. Design coherence
also remains a judgment about represented requirements, not a certification
that prose interpretation is infallible.

### First executable capability: the algebra's publication example

Use [SearchPublication](behavior_algebra.md#a-complete-example-across-design-and-code)
as the initial example, replacing the audit's earlier PreparedBinding-first
recommendation. It exercises native Concept reuse, several contracts, public
identifiers, happy/sad scenarios, and independent Markdown/Python/TypeScript
formulations without first needing a model of filesystem concurrency.

The shared `Publication` Concept connects Interface result meanings, State
quantities, Logic branches, the stale/cancelled Constraint, and Cases. The Goal
and Decision explain the observable intent and authority choice; they do not
invent extra runtime behavior. Explicit `publish`, `ResponseId`, `Results`, and
result-alternative identities complete the connections.

**Milestone A: admission equality.** Apply
[the four-input decision calculation](behavior_algebra.md#first-calculate-the-admission-condition):

```text
m = ResponseId equals ActiveRequest
c = Cancelled

Design:              and(m, not(c))
Python early exits:  if(not(m), false, if(c, false, true))
TypeScript branch:   and(m, not(c))
```

Establish matching input meanings and pure, total checks. The finite Boolean
table can decide equality completely for this admission boundary. Fixed laws
and Egglog congruence explain the equivalence of the different formulations.
The model emits checks, branches, and values, never the terminal verdict.

This result does not establish any branch's writes or returned value. It also
does not by itself prove request-identity equality across arbitrary source
types: that meaning must be established or the assumption stated.

**Milestone B: full selected operation equality.** Follow
[joint operation comparison](behavior_algebra.md#then-compare-the-full-selected-operation):

| Condition | Ordered actions | Outcome | Next relevant state |
| --- | --- | --- | --- |
| `m AND NOT c` | Publish IncomingResults to Results | `Return(Published)` | Results becomes IncomingResults; ActiveRequest and Cancelled unchanged. |
| Otherwise | None | `Return(Ignored)` | Unchanged. |

Source-supported mapping must establish that the local assignment changes the
public Results resource. Preserve the payload, result alternative, and next
state together. The example assumes infallible ordinary assignment, no hidden
getter/setter effects, and no concurrent state mutation; these cannot silently
be generalized to arbitrary code. Use finite request/payload domains initially,
or separately establish symbolic identity and unchanged-value forwarding. The
four Boolean rows alone cannot prove behavior over every possible payload.

This stronger calculation catches a wrong published value, an extra visible
write, a swapped return alternative, or state mutation on the ignored branch
even when admission remains equal. Those are genuinely new capabilities beyond
tuple coverage.

**Disagreeing edit:** removing cancellation produces admission `m`. The
[distinguishing situation](behavior_algebra.md#a-disagreeing-edit-has-a-small-witness)
is an active but cancelled request with incoming Results different from current
Results. Design ignores it and preserves state; the changed implementation
publishes it and returns Published. The compiler derives the disagreement from
fresh behavior, not from a textual diff or an LLM's judgment of the edit.

Report the current publishing path and the native Interface, Logic, Constraint,
and Case Facets whose represented observations it contradicts. Do not simply
mark every Facet under Publication wrong. Each reported connection needs its
own semantic support. The removed check's old span is historical context only.

**Transfer to PreparedBinding afterward.** Its source-match, incoming-anchor,
and expected-generation guards can use the same pure-decision machinery.
Proving actual publication safety additionally needs explicit state and steps
for lock scope, validation, temporary writes, commit, failure, and index
visibility. A generation check somewhere before a write does not prove atomic
compare-and-swap or prevent a race. Model supported transitions and assumptions
before claiming that protocol's equality; unsupported concurrent interleavings
remain Unresolved. See [repeated interactions](behavior_algebra.md#state-transitions-and-repeated-interactions).

Repeated guards and larger helper compositions become recognizable because
their expressions and joint steps are represented, not because `provides` was
renamed. Pattern discovery can suggest candidates; accepting a rewrite still
requires every side condition and independently supported callee behavior.

## Freshness and change impact as separate computations

### Keep three fingerprints separate

The current [inputs.rs](../sigilc/src/inputs.rs) and
[kernel.rs, `fingerprint`](../sigilc/src/kernel.rs) provide useful seeds.

| Identity | Contents | Invalidates |
| --- | --- | --- |
| Projection binding | Source path/bytes, side, ontology, transport/lowering schema, actual frontend and incoming descriptors supplied | The affected reconstruction. |
| Accepted projection identity | Binding plus normalized accepted facts and source occurrences | Closures and proofs that used that accepted content. |
| Semantic run identity | Selected membership, projection identities, laws/runtime, comparison mode and domains | Derived worlds, proofs, and verdicts. |

A law-only change should recompute closure and comparison, not automatically
ask an LLM to reinterpret unchanged inputs. A change in accepted ontology or
meaning of transported observations must invalidate incompatible projections.
An unchanged source can be reconstructed differently; include accepted content,
not only its source binding, in proof identity. External models, prompts, and
attempt records remain outside compiler state as proposed.

Incoming descriptor content and its authority/freshness are separate checks.
If a provider changes only relationships while its descriptors remain identical,
downstream observations that consumed only those descriptors can be reusable.
If the provider is stale or Disjoint, matching descriptor hashes alone must
not manufacture a current authoritative Design surface. Recompute obligations
against current Design independently of that reuse decision.

The same rule applies to Interface-defined identifiers and nested module
surfaces. Bind the full descriptor payload actually consumed, not just a list
of exported spellings. A type, ownership, or visibility change can matter with
unchanged labels. An altered provider behavior need not force reinterpretation
of a caller that consumed only unchanged identities, but it must invalidate
any composed proof that used the old behavior. This is the algebra's separation
between [independent inputs](behavior_algebra.md#keep-the-two-reconstructions-independent)
and [result support](behavior_algebra.md#what-the-result-must-retain).

### Preserve source membership, not just surviving files

Use a versioned path-aware manifest to compare added, changed, removed, and
out-of-scope sources. Current `implementation::assemble_manifest` computes
`all_fresh` over present manifest files before appending deleted-source
diagnostics. Explicit missing paths instead fail discovery. These outcomes are
different and need an explicit target-membership policy in the refactor.

A removed required target cannot become vacuously satisfied because it vanished
from discovery. Conversely, an old cache entry outside the selected scope
must not become a required current input simply because it once existed.
Derive expectations from declared scope/targets and preserve comparison scope
in the report; historical cache inventory alone is not semantic authority.

### Keep impact useful without promoting history to truth

Use two separate graphs:

```text
Current semantic support:
  occurrence -> observation -> derivation -> obligation result

Last-known impact:
  changed/deleted source -> prior anchor -> denotes path -> Facet/origin
```

Carry each historical hop's accepted binding/generation. Do not freely join
edges from different cached generations into a path that never existed as a
compatible chain. If compatible history is unavailable, label the result a
candidate impact surface. Bounded hop witnesses and cycle detection are enough;
storing every possible path can grow exponentially.

The store currently retains distinct bindings, but does not expose a complete
impact/history-selection API. A new `inspect_last_known` should validate cached
checksums and return explicitly historical data. Its result type should be
unacceptable to current-world assembly. Same-binding reconstructions currently
replace the current projection rather than retaining every generation; promise
only the history the cache actually preserves.

After a change, report potential impact immediately and remove stale facts
from current truth. After fresh reconstruction, report the semantic result.
Keep full file bindings initially: precise Facet diagnostics can already come
from observation support. Facet-granular cache reuse is a later optimization,
not a prerequisite for locating a failed obligation.

## Surgical implementation sequence

Each step should add a reviewable capability. The old matcher is source
material, not a compatibility requirement. Do not introduce a legacy fallback
that can turn a failed behavioral proof into success through direct `provides`.

| Step | Exact boundary to change | Concrete result |
| --- | --- | --- |
| 1. Align the proposal with native language and algebra | Kernel README, ARCHITECTURE, example; governing Sigil contracts | Correct Concept/Facet examples, include Interface-defined exports and ungrouped/Embedded Facets, distinguish module exposure from invocation, and adopt the algebra's boundary/result definitions. |
| 2. Extract the computation | New `packages/kernel/Cargo.toml` and `src/lib.rs`; current `sigilc/src/kernel.rs`, three `.egg` programs, `comparison.rs` | A Rust library with typed Design/Implementation inputs and result surfaces; no filesystem, scheduling, or worker dependencies. Move reusable runtime/limit code without freezing the old fact schema as public API. |
| 3. Preserve native units and lower typed observations | `sigilc/src/turtle.rs`, `assertions.rs`, `catalog.rs`, `frontend.rs`; `core/src/design-input.ts`; new kernel observation/lowering module | Resolved per-Facet Concept references, public definition identities, local observations in the eight-unit vocabulary, production/test roles, checked ranges, and explicit interpretation gaps. |
| 4a. Deliver finite pure-decision equality | New kernel Boolean laws/evaluation and proof output; `sigilc/src/comparison.rs`, `report.rs`; replacement canonical example | SearchPublication early exits and conjunction prove equal for the declared domain; removing cancellation yields a witness and two-sided source support. Follow the algebra's admission example. |
| 4b. Deliver finite guarded-operation equality | Kernel steps, value/state mappings, joint comparison and support | Compare actions, outcomes, payloads, and next state together. Detect correct admission with a wrong write or result. Follow the algebra's full selected operation, without silently widening the finite domain. |
| 5. Integrate freshness and impact | `sigilc/src/sources.rs`, `inputs.rs`, `store.rs`, `design.rs`, `implementation.rs`, scope/report code | Path-aware captured manifests, complete consumed descriptor bindings, module/public-surface dependencies, target-specific results, validated last-known impact, and proof invalidation on accepted-content changes. |
| 6. Remove the retired process surface | `sigilc/src/request.rs`, request branches in `cli.rs`, artifact fields/methods in store and reports; current CLI docs/contracts and repository-owned Sigil skill | `PreparedBinding`/`binding.json`, opaque external semanticization, no `--evidence`, worker receipts, or request ledger. Keep generation checks, locking, restricted ingest, and scope. |
| 7. Expand one domain at a time | Kernel protocol laws, scenario comparison, and explicit exported implementation anchors | Case/test expectation comparison with separate production evidence; cross-file composition from current callees; PreparedBinding protocol claims only under represented state/concurrency semantics. Add arithmetic and broader state only with explicit theories. |

Steps 1-5 form the first useful vertical slice. Step 4a is a narrow mathematical
milestone; step 4b is the first joint-operation capability. Their controlling
scope is [the algebra's first useful implementation](behavior_algebra.md#the-first-useful-implementation),
not an assertion that the whole repository becomes decidable. Process cleanup may be developed
alongside them, but its size must not substitute for demonstrating the new
semantic capability. Authoritative docs and skill instructions must switch with
the command boundary; the currently installed worker/evidence workflow describes
the existing compiler, not this proposed target.

Keep the existing tests that establish relevant invariants: source capture,
binding freshness, CAS publication, scope membership, graph separation,
restricted data ingestion, contradiction precedence, and explicit limits.
Rewrite assertions whose purpose is only to preserve the obsolete matcher or
process schema. Do not discard absence/negative-evidence safeguards simply
because the old implementation is being replaced.

## Acceptance checks for the new capability

These are implementation acceptance criteria, not tests run during this audit.

| Scenario | Required result |
| --- | --- |
| One Concept appears in several contracts and matching expands | One resolved Concept with separately attributable Facets and collective, non-overriding contributions. |
| Interface contains both SemanticBridge and ComparisonReport Concept blocks | Two Concepts connected by the operation's result relationship; neither block is reclassified as a Facet of the other. |
| Adjacent prose lines, an empty-line separator, and an ungrouped statement | Native Facet boundaries and optional Concept are preserved, not replaced by heading-sized anchors. |
| An Embedded Facet contains blank lines and braces | Preserve its introducing prose, notation, fenced body, and source support; unsupported meaning remains explicit. |
| Interface defines Results or publish inside a Facet without its own Concept block | The defined public identity is importable with its originating owner; ordinary prose words are not automatically exports. |
| A nested module explicitly assembles imported components | Compute the declared public surface without sweeping the directory, transferring ownership, or inventing runtime calls. |
| Conjunction and pure early-return guards encode the same function | Equality proof for every input in the finite domain; source anchors remain distinct. |
| Repeated guard expressions occur in several local constructs | Shared behavioral equivalence with separately preserved occurrences. |
| Cancellation check is removed | Fresh counterexample `m=true,c=true`; current publishing path and affected native Facets, with differing Results for the state-change witness. |
| Admission is correct but the branch writes a different payload or returns the wrong alternative | Admission remains Equal; the larger operation boundary is Different with a joint witness. |
| Status and payload each match, but their allowed pairs are crossed | Different joint result, despite equal individual value sets. |
| Ignored branch writes state, repeats a write, or changes observable action order | Different when the declared boundary observes that distinction; no set-based erasure of action order or repetition. |
| A Boolean-returning call has effects, failure, or possible nontermination | Pure-total rewrites do not apply; represent the behavior or return Unresolved. |
| Two state representations agree now but hide a distinction affecting a later interaction | No repeated-interaction equality without a sufficient state mapping and transition proof. |
| A partial prohibition is proved | Equality of its specified property view, not automatically the whole operation. |
| Design permits alternatives but implementation supplies only a subset | Report conformance if that mode is selected; do not report set equality. |
| A happy or sad Case has no test file | Compare the specified scenario against production meaning; absence of a test does not erase the Case. |
| A test asserts the expected result but production or its helper is wrong/missing | Test/Case expectation correspondence cannot satisfy production behavior; mocks retain their separate role. |
| A Case gives one example or leaves must/may ambiguous | Keep its actual domain or report ambiguity; no invented universal claim. |
| A Decision documents a rejected alternative | Preserve rationale without creating an implementation obligation for that alternative. |
| Method retains its name/signature but returns a fixed success | Behavioral mismatch, even when all correspondence remains valid. |
| Only `denotes`, `implements`, containment, or coarse `provides` is supplied | Behavioral obligation remains unresolved. |
| Unknown external helper or missing branch observation | Open model; no equality or absence-based safety proof. |
| A negative property holds in a complete finite model | Checked invariant/exhaustive proof can satisfy it. |
| Symbolic search fails to equate two roots | Unresolved unless a valid refutation exists; never inequality from different e-class IDs. |
| Rust is correct and Deno is empty or incorrect | Separate target results; Rust cannot discharge Deno's obligation. |
| Consumer adds a Facet to a reused Concept | Provider context remains unchanged; consumer obligation retains its owner. |
| Two operations share a Concept, or unrelated owners use the same spelling | No cross-operation obligation satisfaction or global lexical identity merge. |
| A code guard excludes the failing case but Design does not | Do not shrink the permitted domain to make the implementation equal. |
| A helper moves behind a public import | Compose only from established linkage, argument/state mapping, compatible assumptions, target membership, and fresh callee behavior. |
| Same-size edit, rename, duplicate-file removal, or newly selected source | Path-aware capture/membership changes are handled; directory child checksum alone is never the gate. |
| Source changes after preparation or publication generation advances | Ingest rejects the obsolete binding; no stale facts enter current closure. |
| Source changes after capture while a comparison runs | Report remains tied to captured inputs; currentness validation detects ordinary drift or leaves currentness unavailable. |
| A new reconstruction changes facts without changing source bytes | Derived proof/run identity changes; old proof is not reused by binding hash alone. |
| Law version changes but accepted observation format does not | Recompute proof from compatible observations; no compulsory model rerun. |
| Stale history connects a changed file to a Facet | Impact only, with generation-qualified hops; no current satisfaction or contradiction. |
| Code was deleted | Failed obligation and historical location remain explainable; no invented current span. |
| Proof display hits its output bound | Omission is explicit and complete proof remains addressable if computed. |
| Semantic computation hits a resource bound | Incomplete/operational result; no completed equality claim. |
| Both models have unknown behavior, or the selected domain is accidentally empty | No covered-operation equality from matching gaps or vacuity. |
| Unrelated meaning is unresolved but a current trace violates an explicit prohibition | Report the supported local disagreement and the unresolved remainder separately. |
| Cache is deleted | Reconstructed equivalent observations yield equivalent semantic results; historical impact may be unavailable. |

Finite vocabulary does not imply finite term generation. Begin with bounded
acyclic expressions, a finite input domain, and a small rewrite set. Avoid
unrestricted expansion and associative/commutative permutations when a
canonical representation suffices. Egglog's
[scheduling documentation](https://egraphs-good.github.io/egglog-tutorial/04-scheduling.html)
describes why rules can create excessive growth. The current host checks
limits between iterations, so those checks are not hard per-iteration memory
or wall-clock bounds. Keep explicit incomplete outcomes and measure the chosen
fragment before widening it.

The first useful operation milestone is reached when Sigil and Markdown meaning
can be compared with independently reconstructed, differently structured code;
the compiler derives the joint behavior rather than accepting its capability
name; and a disagreeing edit produces a distinguishing situation with current
code support and affected native Facets. Each proof names its boundary, domain,
assumptions, source bindings, and laws, as required by
[the algebra's result contract](behavior_algebra.md#what-the-result-must-retain).

That is the capability that justifies this refactor: calculate what observation
changed, under which input, and which authored contributions required otherwise.
