# Audit of the proposed Sigil kernel

Date: 2026-09-09.

`packages/kernel/` is an initial refactor proposal. Its README, ARCHITECTURE,
and example describe the intended target, not an implemented kernel. The
current implementation audited here is `packages/sigilc/`, with the structural
frontend in `packages/core/`. Egglog and Snapdir were inspected in
`repos/egglog/` and `repos/snapdir/`, including executable Rust implementation,
not just documentation. Sigil's vendored Snapdir integration was also inspected.

This is a static architecture and source audit. No compiler runs, tests,
benchmarks, or independent semantic reconstructions were performed. Examples
and acceptance checks below are proposals, not reported execution results.

## Recommendation

Keep both chosen primitives. Snapdir supplies content identity and discovery;
Egglog supplies compositional inference and equality reasoning. Keep the
proposal's independent worlds, opaque semanticization, typed correspondence,
disposable projection store, and removal of compiler-owned orchestration.

The critical addition is a small, typed **behavioral algebra** between accepted
observations and terminal realizations. Use relational identities for source
anchors and e-classes for behavioral terms. Attach derivation witnesses to both.
Start with a finite publication-guard model, then extend to an explicit
publication protocol. This makes the first release demonstrate a behavioral
equivalence and a precisely located counterexample, rather than only a richer
graph of model-asserted capability claims.

The defensible product claim is:

> For a declared scope and supported semantic model, sigilc proves that the
> independently reconstructed design and implementation behaviors are equal
> under fixed laws, or reports a witnessed disagreement at the implicated
> design obligations and source observations. Missing information remains
> unresolved.

The proof is conditional on the accepted reconstructions faithfully representing
the sources. Hashing proves which inputs were bound; graph validation proves
admissibility; Egglog proves consequences of those inputs and laws. None of
these independently proves an LLM's interpretation of arbitrary code or prose.
This boundary need not weaken the useful capability, but it must be part of
what `Closed` means.

## Findings, in priority order

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

### P1. Obligation coverage is conformance, not equality

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
and files. Facet-sized cache bindings alone would not repair it.

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

### P2. Concept identity in the proposal conflicts with the current language boundary

Proposal: “Writing the same Concept identifier in another Sigil contract means
that same Concept again.” Current language:
[language.sigil, `ConceptIdentity`](../../spec/language.sigil),
[ADR-015](../../spec/decisions/adr-015-flat-concept-identifier-namespace.md),
[ADR-016](../../spec/decisions/adr-016-contextual-imported-concept-reuse.md), and
[design-input.ts](../core/src/design-input.ts).

The current language has a flat namespace per component and matching expands,
with specific rules for preserving imported Concept identities. A same-named
local declaration can be a distinct, ambiguous identity. Consumer contributions
also remain contextual; they must not extend the provider upstream.

**Change:** carry resolved Concept identity, contextual owner, source occurrence,
contract kind, and origin unit separately. A Facet belongs to a resolved Concept
in an explicit contract context. Preserve that context in obligations and
implementation-target selection. Do not globally equate Concept names or
globally collect consumer facets. If global identity is an intended language
change, specify it as such rather than presenting it as existing semantics.

The frontend currently exports `Unit.concept` as text, not a resolved Concept
reference. Add the resolved reference through the existing resolver. This is a
Sigil-language frontend improvement, not an implementation-language parser.

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

Extend the fixed ontology with a deliberately small observation vocabulary:

| Observation family | Examples | Compiler responsibility |
| --- | --- | --- |
| Identity | Local anchor, direct `denotes`, contextual Concept/Facet | Validate ownership, types, supplied references, mapping cardinality. |
| Pure expressions | Input, literal, comparison, Boolean operator | Validate operand roles and types; lower into terms. |
| Control flow | Branch, true/false successor, return, explicit unknown call | Validate graph shape; derive reachable paths and path conditions. |
| Effects | Read, write, publish, fail, resource argument | Preserve ordering, resource identity, and failure behavior. |
| Attribution | Source occurrence, byte range, excerpt digest | Bind to captured bytes and retain support. |

New classes and predicates should be canonical `sigil:` vocabulary, not a
Rust-specific AST. Reified expression nodes fit Turtle; native lowering can
construct Egglog terms after graph validation. The seven contract kinds classify
requirements, but are not a sufficient instruction set for reasoning about
behavior. A Logic Facet and a Constraint Facet can refer to the same underlying
behavior expression.

For the first fragment, require acyclic, typed expression graphs and explicit
unknown nodes. Reject ambiguous operand cardinality and wrong-side assertions.
Do not union conflicting observations to “repair” them. Open or conflicting
models must not produce behavioral equality.

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
obligation(id, context, concept, facet, target, mode, domain, expectedBehavior)
summary(target, localAnchor, behavior, support, modelStatus)
```

These are logical record shapes, not a prescribed public Rust API. Keep semantic
contents typed and provenance separate from identity matching.

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

### First executable capability: publication admission

Use `PreparedBinding`, the proposal's own example, but make its first Facet
narrow and actually decidable:

> When the other publication prerequisites hold, admission is allowed exactly
> when source, incoming anchors, and expected generation match.

Let `s`, `a`, and `g` denote those three pure checks. The selected domain is
all eight Boolean assignments. Input-slot correspondence is typed and explicit;
their spelling does not establish identity.

Design independently lowers to:

```text
admit_D(s, a, g) = s AND a AND g
```

A correct implementation could use early exits:

```text
if NOT s: return Reject
if NOT a: return Reject
if NOT g: return Reject
return Admit
```

The implementation semanticizer emits the local checks, branches, successor
edges, and return values. It does not emit `provides(ImmutableBinding)` or
`equivalentTo(design)`. Fixed laws reconstruct the decision expression:

```text
admit_I = If(s, If(a, If(g, true, false), false), false)
```

Boolean laws such as `If(p, true, false) = p` and
`If(p, q, false) = And(p, q)`, restricted to pure total Boolean terms, prove
the correspondence to the Design expression. Egglog congruence carries the
inner equalities outward. Exhaustive evaluation of the eight assignments
supplies a complete equality check for this fragment and a way to produce
counterexamples. This is exhaustive finite semantics, not sampled tests.

Now remove the generation rejection branch. The fresh implementation lowers to:

```text
admit_I_changed(s, a, g) = s AND a

counterexample:
  s = true, a = true, g = false
  Design outcome         = Reject
  Implementation outcome = Admit
```

The kernel can refute equality without asking the LLM whether the change
violates the design. Report the admission Facet, its authored range, the
current admitting return/path, the facts that support it, and the failed input
assignment. The previous generation-check span may be shown as historical
impact evidence, but contributes nothing to this fresh counterexample.

Do not call this proof of the entire immutable-publication protocol. The next
step models expected-generation checks, lock scope, temporary writes, commit,
failure, and index visibility as a finite transition system. A transition
summary must preserve order and failure effects: finding both a check and a
write somewhere is insufficient. Protocol equality or safety then has an
explicit observation boundary, for example whether stale input can become an
index-visible accepted projection.

The same machinery can later recognize repeated guard patterns and delegated
operations across functions. Candidate pattern recognition may be broad;
accepting a semantic rewrite must still require its complete side conditions.

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
| 1. Tighten the proposal | Kernel README, ARCHITECTURE, example; governing Sigil contracts | Define scoped equality/refinement, separate anchor identity from term equality, require source support, specify target quantifiers and Concept context. |
| 2. Extract the computation | New `packages/kernel/Cargo.toml` and `src/lib.rs`; current `sigilc/src/kernel.rs`, three `.egg` programs, `comparison.rs` | A Rust library with typed Design/Implementation inputs and result surfaces; no filesystem, scheduling, or worker dependencies. Move reusable runtime/limit code without freezing the old fact schema as public API. |
| 3. Add typed local observations and occurrences | `sigilc/src/turtle.rs`, `assertions.rs`, `catalog.rs`, `frontend.rs`; `core/src/design-input.ts`; new kernel observation/lowering module | Arbitrary-language source anchors, expression/control-flow observations, mechanically checked ranges, and fixed typed lowering. Preserve required authored-unit inventory. |
| 4. Deliver the publication-admission proof | New kernel Boolean laws/evaluation and proof output; `sigilc/src/comparison.rs`, `report.rs`; replace the canonical example | Equivalent early exits and conjunction close; omitted generation check yields a concrete counterexample and two-sided locations. No capability assertion is sufficient for this obligation. |
| 5. Integrate freshness and impact | `sigilc/src/sources.rs`, `inputs.rs`, `store.rs`, `design.rs`, `implementation.rs`, scope/report code | Path-aware captured manifests, immutable incoming descriptor bindings, target-specific coverage, validated last-known impact, proof invalidation on accepted-content changes. |
| 6. Remove the retired process surface | `sigilc/src/request.rs`, request branches in `cli.rs`, artifact fields/methods in store and reports; current CLI docs/contracts and repository-owned Sigil skill | `PreparedBinding`/`binding.json`, opaque external semanticization, no `--evidence`, worker receipts, or request ledger. Keep generation checks, locking, restricted ingest, and scope. |
| 7. Expand one domain at a time | Kernel protocol laws and explicit exported implementation anchors | Publication-protocol safety/equality and cross-file composition from current callee observations. Add arithmetic or broader state semantics only with a declared theory and meaningful counterexamples. |

Steps 2-5 form the first useful vertical slice. Process cleanup may be developed
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
| Conjunction and pure early-return guards encode the same function | Equality proof for every input in the finite domain; source anchors remain distinct. |
| Repeated guard expressions occur in several local constructs | Shared behavioral equivalence with separately preserved occurrences. |
| Generation check is removed | Fresh counterexample `s=true,a=true,g=false`; failed Design Facet and current admitting path. |
| Method retains its name/signature but returns a fixed success | Behavioral mismatch, even when all correspondence remains valid. |
| Only `denotes`, `implements`, containment, or coarse `provides` is supplied | Behavioral obligation remains unresolved. |
| Unknown external helper or missing branch observation | Open model; no equality or absence-based safety proof. |
| A negative property holds in a complete finite model | Checked invariant/exhaustive proof can satisfy it. |
| Symbolic search fails to equate two roots | Unresolved unless a valid refutation exists; never inequality from different e-class IDs. |
| Rust is correct and Deno is empty or incorrect | Separate target results; Rust cannot discharge Deno's obligation. |
| Consumer adds a Facet to a reused Concept | Provider context remains unchanged; consumer obligation retains its owner. |
| Same-size edit, rename, duplicate-file removal, or newly selected source | Path-aware capture/membership changes are handled; directory child checksum alone is never the gate. |
| Source changes after preparation or publication generation advances | Ingest rejects the obsolete binding; no stale facts enter current closure. |
| Source changes after capture while a comparison runs | Report remains tied to captured inputs; currentness validation detects ordinary drift or leaves currentness unavailable. |
| A new reconstruction changes facts without changing source bytes | Derived proof/run identity changes; old proof is not reused by binding hash alone. |
| Law version changes but accepted observation format does not | Recompute proof from compatible observations; no compulsory model rerun. |
| Stale history connects a changed file to a Facet | Impact only, with generation-qualified hops; no current satisfaction or contradiction. |
| Code was deleted | Failed obligation and historical location remain explainable; no invented current span. |
| Proof display hits its output bound | Omission is explicit and complete proof remains addressable if computed. |
| Semantic computation hits a resource bound | Incomplete/operational result; no completed equality claim. |
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

The first milestone is reached when the compiler can derive a behavior that
was not directly asserted, prove its equality to the independent design model,
and expose the exact counterexample and source support after a disagreeing edit.
That is the capability that justifies this refactor.
