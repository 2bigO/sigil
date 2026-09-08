# Sigil kernel architecture

This is the evergreen operational architecture for the Sigil semantic
compiler. [README.md](README.md) records the design decisions and migration
direction; this document defines the stable computation model those decisions
produce. It describes the intended architecture where the kernel has been
extracted as a Rust library and the correspondence extension exists. Current
implementation locations are linked where they are useful seeds, not as a
claim that every target feature has already landed.

## Purpose and boundary

Sigil compiles source-bound semantic assertions. It is not a language parser,
LLM runtime, task queue, worker scheduler, evidence store, or lifecycle
tracker.

```text
source files + structural frontend input
       + accepted Turtle projections
       + compiler-owned Egglog laws
                         |
                         v
          current semantic worlds and diagnostics
```

The independent LLM semanticizer interprets a source language and returns
Turtle. `sigilc` validates the Turtle as a graph under the fixed ontology and
exact source/input binding; it does not validate Rust, Python, TypeScript,
Deno, or another source language's AST or symbol table.

The kernel is a Rust library. `sigilc` is its filesystem/compiler driver:

```text
sigilc                         kernel
------                         ------
source capture                 Egglog laws
binding and freshness          saturation
Turtle parsing/validation      obligation derivation
projection publication         comparison
scope assembly                 correspondence and impact closure
CLI/report formatting          bounded semantic witnesses
```

The seed laws are currently in
[kernel.egg](../sigilc/src/kernel.egg),
[design.egg](../sigilc/src/design.egg), and
[comparison.egg](../sigilc/src/comparison.egg). Their Rust host is currently
[kernel.rs](../sigilc/src/kernel.rs). Extraction preserves the behavior before
the kernel grows new correspondence laws.

## Canonical Sigil vocabulary

All semantically meaningful accepted Turtle assertions use the canonical
`sigil:` vocabulary, whether their source was Sigil, Markdown, Rust, Deno,
Python, or another language. This vocabulary is the type system for
saturation, not a global spelling catalog. The seven Sigil keywords are the
vocabulary's seven contract kinds:

```text
Goal | Interface | State | Logic | Constraint | Decision | Case
```

`Concept` is an existing Sigil semantic type, not a container local to one
component or contract. Writing the same Concept identifier in another Sigil
contract means that same Concept again; a contract can introduce it or refer to
it. A `Facet` is a named, addressable
contribution of one contract to a Concept. For example, an Interface Facet
names an interaction, a Logic Facet names a transformation, a State Facet names
a lifecycle configuration, and a Constraint or Case Facet names a rule or
observable outcome.

Components organize contracts. Concepts and their Facets deliberately cross
contract, component, and source-language boundaries through explicit source
anchor chains. Each binding supplies the LLM with an immutable incoming anchor
set: typed, hashed anchors accepted from the preceding source surface. The LLM
creates typed local anchors and links every relevant crossover with `denotes`.
That records `Age → age → age_years` directly, without compiler name matching
or identity union.

Design may introduce new typed source anchors. Downstream Design and
Implementation LLMs receive those anchors as external semantic input, not `D`,
Design relationships, obligations, or conclusions. A binding fingerprints the
incoming anchor set; the compiler rejects `denotes` targets outside it and
treats a changed set as a freshness change.

Each incoming-anchor descriptor contains only its hashed ID, source-anchor kind
(`OriginAnchor`, `DesignAnchor`, or `ImplementationAnchor`), Sigil type
(`Concept` or `Facet`), Facet contract kind when applicable, documentary label,
and allowed mappings. A Concept permits `denotes` and `implements`; a Facet
permits `denotes` and `realizes`. This is not a slice of `D`: it carries no
Design relationships, obligations, or verdict. The LLM must omit correspondence
when a local source construct is ambiguous or merely lexically similar.

## The computation, exactly

For a selected scope, let `D` be the union of assertions from fresh accepted
Design projections and `I` the union of assertions from fresh accepted
Implementation projections. The kernel performs three separate computations:

```text
D* = saturate_design(D)
I* = saturate_implementation(I)
O  = obligations(D*)
R  = compare(O, I*)
```

`D*` and `I*` are independently derived closures, not authored files and not
persisted task state. `O` is the finite set of compiler-derived Design
obligations. `R` is the comparison result and its bounded diagnostic witnesses.
The comparison is a third, fixed semantic program; it is neither an LLM review
nor a union of the two worlds.

This separation is non-negotiable:

```text
Never: saturate(D union I)
Never: use stale assertions in D, I, D*, I*, O, or R
Always: derive Design meaning and Implementation meaning independently,
        then match only the allowed facts through fixed rules.
```

It prevents Design assertions from manufacturing implementation facts and
prevents implementation assertions from rewriting the Design's obligations.

## Inputs, bindings, and projection lifetime

The filesystem is the source of truth. The generated `.sigil/worlds` store is a
disposable cache of accepted projections and their input bindings. `snapdir`
captures current source bytes and `sigilc` checks whether a cached projection
is still usable for the current compilation.

`prepare` produces copied semantic input plus an immutable `binding.json`.
`ingest --binding binding.json` accepts Turtle only if it matches that binding
and can still publish at its expected generation.

```text
sigilc prepare
  -> exact semantic inputs + immutable binding.json

independent LLM semanticizer
  -> Turtle

sigilc ingest --binding binding.json
  -> validated, atomically published source projection
```

The binding is compiler correctness, not a job. It includes the normalized
source path and captured source identity, the ontology and projection-format
versions, and the semantic input needed for the projection side. A binding also
includes the immutable incoming-anchor-set fingerprint supplied to its LLM.
The expected publication generation prevents an old preparation from
overwriting a newer projection.

The existing seeds are [inputs.rs](../sigilc/src/inputs.rs),
[sources.rs](../sigilc/src/sources.rs), and
[store.rs](../sigilc/src/store.rs). The historical `Job`/`job.json` names become
`PreparedBinding`/`binding.json`; no lifecycle semantics travel with that
rename.

| Input change | Effect |
| --- | --- |
| Target source bytes change or source disappears | Its projection is stale or absent. |
| Relevant Design structural/import input changes | Affected Design projection is stale. |
| Ontology or projection format changes incompatibly | Bound projection is stale. |
| Incoming source-anchor set changes | Bound downstream projection is stale. |
| LLM model, prompt, or retry configuration changes | Projection remains fresh; an external caller may choose to reconstruct it. |

Publication must reject a stale source binding, an incompatible incoming anchor
set, or an outdated generation. Interrupted publication leaves no projection that can be
treated as current. Removing `.sigil/worlds` is safe: it loses cache and
last-known impact context, never semantic authority.

### Filesystem shape and flow

The live repository currently has this **abbreviated** shape. `tmp` and
`workflow` are legacy compiler-owned material to remove; they are shown so the
boundary is concrete, not because the target architecture retains them.

```text
.sigil/
├── config.json
├── glossary.json
├── tmp/                 legacy prepared jobs, Turtle attempts, evidence, audits
├── workflow/            legacy request ledger, inputs, reports, archive
└── worlds/              generated semantic cache
    ├── .lock
    ├── design/          accepted Design projections
    ├── implementation/  accepted Implementation projections
    └── index.json       bindings, generations, and freshness
```

After the simplification, the compiler-owned layout is only:

```text
.sigil/
├── config.json
├── glossary.json
└── worlds/
    ├── .lock
    ├── design/
    ├── implementation/
    └── index.json
```

An external caller may place temporary inputs or logs elsewhere, but that
location is not part of the Sigil compiler contract and is not read as semantic
authority.

The retired flow treated semanticization as a managed work process:

```text
BEFORE — retired compiler-owned process

request queue -> job.json -> worker -> attempt/evidence -> ingest
      |                                                  |
      +-------------- workflow ledger <-----------------+
                         |
                         v
                    compile/report
```

The target flow contains only semantic correctness inputs and accepted facts:

```text
AFTER — compiler-owned semantic flow

source bytes + frontend/incoming anchors
             |
             v
  prepare -> immutable binding.json -> independent LLM semanticizer -> Turtle
                                                    |
                                                    v
                               ingest validates binding and publishes projection
                                                    |
                                                    v
                      fresh Design / Implementation projections in worlds/
                                                    |
                                                    v
                             D -> D* -> O       I -> I*
                                      \         /
                                       \       /
                                      compare / impact
```

`compare` consumes only fresh `D*`, `O`, and `I*`. `impact` may inspect a
stale source's last accepted correspondence, but it cannot feed that data back
into comparison.

## Design world

The structural Sigil frontend exports authored contracts, imports, ownership,
and other allowed structure. The LLM semanticizer turns the selected source
material into Design Turtle; native ingestion validates it. Scope includes the
selected Design roots and their required import/ownership closure before `D`
is assembled. The source and selection foundations are
[frontend.rs](../sigilc/src/frontend.rs),
[design.rs](../sigilc/src/design.rs), and
[scope.rs](../sigilc/src/scope.rs).

`saturate_design` applies only compiler-owned Design laws. It derives
reachability, contradictions, required capabilities, ownership consequences,
numeric constraints, and obligations. It does not consume Implementation
assertions.

The Design result is one of:

| State | Meaning |
| --- | --- |
| 🔴 `Disjoint` | Current Design facts contradict a hard invariant. No usable outgoing anchor set or comparison result exists. |
| 🟡 `Loose` | Design is non-contradictory but one or more required Design obligations remain unresolved. A provisional outgoing anchor set may be exported. |
| 🟢 `Coherent` | Design has no contradiction and all required Design obligations are satisfied. Its outgoing anchor set is authoritative. |

`Loose` is deliberately not green: even if the Implementation happens to cover
every currently derivable obligation, the final comparison cannot be `Closed`.
If a `Loose` Design becomes `Coherent` without an outgoing-anchor-set identity change,
compatible fresh Implementation projections may be reused and only the
closures, obligations, and comparison recomputed.

## Implementation world

Each Implementation projection is source-local. Its LLM receives only the
exact target source bytes, fixed ontology, and frozen incoming source-anchor
set needed to create `denotes` edges. It does not receive Design relationships,
Design obligations, neighboring implementation bodies, or comparison feedback.

```text
one implementation source + ontology + frozen incoming anchor set
            |
            v
independent LLM semanticization
            |
            v
one accepted local projection of direct observations
```

All fresh selected local projections are assembled as `I`, then
`saturate_implementation(I)` derives the permitted global consequences. A
change to one implementation file invalidates that file's projection, not its
neighbors merely because they import it or expose a changed name. Global
meaning is recomputed from the reusable fresh projections plus the reconstructed
one. An incoming-anchor-set change invalidates projections built against the old
set.

The compiler has no implementation-language adapter, AST parser, symbol
resolver, LSP dependency, Git symbol history, or fuzzy name matcher. A comment
or lexical similarity does not independently establish an implementation fact.

## Typed hashed anchors and canonical identity

The LLM semanticizer may observe a source-language construct such as a Rust
method and create a typed source-local anchor key:

```turtle
<urn:sigil:anchor-key:person-age-years>
  a sigil:ImplementationAnchor, sigil:LogicFacet ;
  sigil:anchorKey "implementation|Person::age_years|method" ;
  sigil:label "Person::age_years" ;
  sigil:denotes <urn:sigil:anchor:incoming-age#91d4...>,
    <urn:sigil:anchor:incoming-age-years#c63a...> ;
  sigil:implements <urn:sigil:anchor:incoming-age#91d4...> ;
  sigil:realizes <urn:sigil:anchor:incoming-age-years#c63a...> .
```

During ingestion, the compiler validates the Anchor type and opaque key, then
constructs the source-scoped identity mechanically:

```text
source namespace = sha256(versioned normalized workspace-relative source path)
anchor identity  = source namespace # sha256(versioned anchor key)
```

The LLM chooses the key; the compiler owns the hash, source namespace, and
well-formed identity. The label and optional source span are documentary. A
reconstruction can retain useful anchor continuity when the LLM chooses the
same key, but `sigilc` makes no source-language claim that two anchors denote
the same symbol. It validates source scoping, graph structure, and that every
`denotes` target belongs to the immutable incoming anchor set, `implements`
targets are Concepts, and `realizes` targets are Facets only.

Origin anchors, Sigil anchors, and Implementation anchors are explicit `sigil:Anchor`
subtypes and carry canonical Sigil types such as `Concept` or `LogicFacet`.
They stay distinct from other source anchors. An explicit authority—often an
origin document or glossary—introduces the first anchors; source-local labels
such as `age`, `Age`, and `age_years` remain local presentation until accepted
`denotes` edges map them across the chain.

## Typed correspondence

Accepted Turtle contains direct, typed correspondence assertions. The kernel
derives broader correspondence from them; it does not hide direct mappings in
an LLM interpretation.

| Relation | Meaning | Impact closure | Obligation matching |
| --- | --- | ---: | ---: |
| `correspondsTo` | Compiler-derived broad/transitive correspondence closure; never accepted Turtle | yes | no |
| `denotes` | LLM-asserted direct local-to-supplied-anchor mapping; never transitive | yes | only by an explicit rule |
| `implements` | Local target anchor makes an explicit implementation claim about its denoted Design anchor | yes | only by an explicit rule |
| `realizes` | Local anchor makes an explicit Facet realization claim | yes | only by an explicit rule |
| `specifies` | Sigil material gives structured meaning | yes | no by itself |
| `refines` | Narrower representation | yes | only where a rule opts in |
| `aliasOf` | Terminology synonym | terminology only | no |
| `equivalentTo` | Explicit semantic equivalence | yes | only where a rule opts in |

The LLM emits `denotes` for the source-anchor crossover it observed. When code
also carries stronger meaning, it emits `implements` to a supplied Concept
anchor and `realizes` to a supplied Facet anchor. These are not identical: one
Concept can have many Facets, so `implements` gives broad Concept coverage while
`realizes` identifies the specific behavior, state, constraint, decision, or
case seen in source. `sigilc` validates target membership and Sigil types; it
requires `implements` and `realizes` targets to also appear in `denotes`; it
does not validate the programming-language observation that caused the LLM to
assert either relation.

The target Egglog closure begins with the direct mapping and derives the broad
relation explicitly:

```text
denotes(a, b)                         -> correspondsTo(a, b)
correspondsTo(a, b) + correspondsTo(b, c)
                                      -> correspondsTo(a, c)
```

Thus `Age ←denotes— age ←denotes— age_years` yields derived
`correspondsTo(age_years, Age)`, while neither direct `denotes` assertion is
rewritten or treated as transitive. The current and historical `kernel.egg`
contain no `correspondsTo` relation, so this adds no legacy Egglog behavior to
preserve. `equivalentTo` retains its separate explicitly asserted symmetric /
transitive closure. The kernel must not use Egglog e-class `union`, RDF
`sameAs`, or another blanket identity mechanism.

### Concrete bridge: SemanticBridge comparison report

Assume the external incoming anchor set contains these typed Sigil anchors:

```text
C = SemanticBridge       [Concept]
F = ComparisonReport     [Interface Facet]
```

Fresh `D*` derives the Design obligation:

```text
O17: C provides F
```

The Implementation LLM inspects `SemanticBridge::compare` and asserts only
what it observed in that source:

```text
a = SemanticBridge::compare             [ImplementationAnchor, Logic Facet]
denotes(a, C) and denotes(a, F)          [direct correspondence]
implements(a, C) and realizes(a, F)      [typed implementation claims]
known(a, "provides", F)                 [specific local implementation fact]
```

Only the last fact establishes behavior. A fixed comparison bridge, supplied
with fresh `I*`, may derive:

```text
ImplementationAnchor(a) + implements(a, C) + realizes(a, F)
  + known(a, "provides", F)
  -> actual(C, "provides", F)

O17 + actual(C, "provides", F) -> satisfied(O17)
```

If the LLM asserts only `denotes`, `implements`, or `realizes`, the bridge does
not fire: there is no `actual` fact and `O17` remains unresolved. `sigilc`
validates the incoming target membership and types, not whether the Rust method
really provides the report. That source-language judgment belongs to the LLM;
the fixed rule defines exactly how its accepted local fact may participate in
comparison. `specifies`, `aliasOf`, and derived `correspondsTo` never satisfy
an obligation by themselves.

All seven contract kinds remain first-class in the shared vocabulary. `State`
already has `initialState`, `transitionsTo`, owner, and exclusivity laws; State
Facets and typed anchors may participate in correspondence and impact without
weakening those laws.

## Comparison states

`compare(O, I*)` uses current, independently saturated facts only. Its result
is one of:

| State | Meaning |
| --- | --- |
| 🔴 `Drift` | `I*` establishes a fact that contradicts a Design obligation or prohibition. |
| 🟡 `Converged` | No contradiction is established, but one or more obligations are unresolved, the Design is `Loose`, or required current input is unavailable. |
| 🟢 `Closed` | Design is `Coherent`; every finite obligation is satisfied by fresh `I*`; and no contradiction exists. |

Missing information cannot manufacture `Closed`. An empty Implementation
projection cannot satisfy a positive requirement or prove a negative
prohibition. Exhausted limits or unavailable prerequisite inputs produce an
incomplete/operational result, never a successful semantic conclusion.

## Current truth and last-known impact

Current truth and impact have different epistemic roles.

```text
current comparison
fresh D -> D* -> O
fresh I -> I*
O + I* -> Closed | Converged | Drift

impact
changed or missing source
  -> last accepted projection for that source
  -> last-known correspondence closure
  -> affected typed source anchors and origin anchors
```

Last-known data may say that an edited Rust file *might affect* a typed source
anchor or an origin Markdown section because the prior accepted projection
mapped it there.
It cannot enter `D`, `I`, saturation, obligation derivation, comparison, or a
current status. Reconstructing the source may recreate source-scoped hashed
anchors when the LLM chooses the same keys, and always creates a new current
mapping; the older mapping remains only historical cache context until eviction
or `clean`.

An impact report returns affected surfaces and bounded path witnesses. It does
not call the affected source stale, assert that documentation is wrong, or
change any semantic verdict.

### Deferred precision: Facet-granular anchors

The initial binding is source-scoped: a file's accepted anchors become the
external incoming set for a downstream source. A later capability should select
and bind incoming anchors at Facet granularity rather than at file granularity.
That can let one saturation pass distinguish a genuinely broken Facet from the
broader “this file once denoted these Facets” repair surface. It remains a
binding/freshness refinement, not a task queue or a way for stale assertions to
establish current truth.

## Scope, finiteness, and numerical analysis

Scope is semantic selection: Design roots plus closure, selected Implementation
sources, and deterministic reporting priority. It is not a request queue,
predecessor graph, completion record, or scheduling instruction. The external
environment decides what to reconstruct and when. Sources whose incoming anchor
sets already exist are independent and may run concurrently; a downstream
source waits only for the external anchor set its binding names.

All kernel laws are finite and compiler-owned. Limits bound facts, derivation,
paths, arithmetic, and reported witnesses. A limit breach is an explicit
incomplete/operational diagnostic; the kernel never silently truncates a world
and declares it closed.

The current seed's numerical laws illustrate the allowed form:

- minimum `distance` across dependency paths;
- maximum propagated `peak-risk`;
- bounded arithmetic and crisp latency-budget constraints.

Correspondence may similarly derive minimum `impact-distance`, maximum
`impact-risk`, and diagnostic-only coverage counts. Monotone `min`/`max` merge
laws are safe fixed-point computations. Scores rank and explain an already
determined repair surface; they never make an obligation true.

See [egg.md](../../egg.md) for the Egglog model and
[turtle.rs](../sigilc/src/turtle.rs) for finite input validation.

## What the compiler deliberately does not retain

The compiler owns source identity, semantic input binding, projection
freshness, accepted assertions, correspondence, world assembly, saturation,
obligations, comparison, and impact. It does not retain or model:

- jobs, queues, requests, scope completion, or work assignment;
- worker processes, models, providers, prompts, retries, attempts, or logs;
- artifact evidence, receipt bundles, or Turtle-attempt history; or
- an execution/provenance side channel that duplicates any of the above.

An external harness can record those details for its own debugging and
orchestration. They have no role in freshness or semantic truth. Changing an
external model or prompt therefore never invalidates an accepted projection.

## Required invariants and regression cases

The kernel and `sigilc` integration must preserve these checks:

- A Design contradiction yields `Disjoint`; unresolved required Design meaning
  yields `Loose`; a complete non-contradictory Design yields `Coherent`.
- `D* = saturate_design(D)`, `I* = saturate_implementation(I)`, and
  `compare(obligations(D*), I*)` remain separate calls and graphs.
- A positive Implementation disagreement yields `Drift`; an absence of
  contradiction without sufficient coverage yields `Converged`; only coherent,
  fully fresh coverage yields `Closed`.
- A source edit, deletion, incompatible ontology/format change,
  incoming-anchor-set change, or publication race prevents obsolete projection
  assertions from becoming current.
- A source edit may use its prior projection only to report last-known impact.
- Design import closure invalidates affected Design inputs; downstream
  freshness is local to its source binding and frozen incoming anchor set.
- A mixed-language repository works without compiler language adapters.
- Unknown incoming anchors, malformed typed anchor keys, invalid incoming-anchor
  set changes, wrong-side assertions, path escapes, Egglog rules,
  includes, and non-finite numeric input are rejected at ingestion.
- Typed correspondence retains distinct source-anchor nodes and their Sigil
  types; no alias, `denotes`, `implements`, or `realizes` edge silently proves
  a requirement.
- Equivalent normalized fixtures reconstruct equivalent worlds after cache
  deletion. Compiler determinism and semanticizer repeatability are separate
  properties.

## Related documents

- [Kernel README](README.md): rationale, correspondence design, and migration
  order.
- [sigilc README](../sigilc/README.md): current command-facing compiler driver.
- [scope contract](../sigilc/scope.sigil): current semantic selection behavior.
- [projection store contract](../sigilc/store.sigil): current binding/history
  model.
- [language grammar](../../spec/language.sigil): authored Sigil language.

When an implementation changes this architecture, update this document and the
kernel README in the same change. Do not restore retired orchestration or
artifact-evidence concepts through a new compiler API.
