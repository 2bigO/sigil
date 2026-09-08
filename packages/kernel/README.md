# Sigil kernel

`packages/kernel` is the compile-first semantic kernel for Sigil. It owns the
finite Egglog laws that turn accepted, source-bound RDF assertions into current
semantic worlds, correspondence/impact results, and crisp comparison outcomes.

It is a Rust library consumed by `sigilc`. No standalone `sigil-kernel` binary
is part of this design: extraction alone is not a reason to add another command
surface.

The initial kernel seed is the current
[`packages/sigilc/src/kernel.egg`](../sigilc/src/kernel.egg). The first
extraction must preserve its exact current rules and outcomes before extending
the model. This README is the agreed target architecture; it deliberately
describes behavior that is not all implemented in the current `sigilc` crate.

## The decision

Sigil is a compiler over filesystem-derived semantic worlds. It is not a task
queue, a worker scheduler, a request catalog, or a delivery ledger.

An external caller may call one selected reconstruction-and-comparison pass a
*cycle*, but a cycle is not a persisted semantic object. It is simply a current
selection of source material and target material. The compiler sees only:

```text
current source bytes
  + current frontend observations
  + accepted source-bound Turtle projections
  + compiler-owned Egglog laws
  = current worlds, correspondence, impact, and comparison
```

The filesystem is authoritative. `snapdir` captures and hashes current bytes;
the world store records which exact binding produced each accepted projection.
The store is a generated, on-disk cache rather than a second task-management
truth. It is useful precisely because it retains source identity, generation,
and freshness state across normal compiler invocations.

Relevant current foundations:

- [source capture and semantic bindings](../sigilc/src/inputs.rs)
- [snapdir source discovery and hashing](../sigilc/src/sources.rs)
- [projection index, generation, and freshness](../sigilc/src/store.rs)
- [Design assembly](../sigilc/src/design.rs)
- [Implementation assembly](../sigilc/src/implementation.rs)
- [scoped membership](../sigilc/src/scope.rs)

## Current worlds and stale data

The current store model stays. A projection is current only when its complete
binding matches current source bytes and every semantic input it was bound to.
That is the only kind of projection that may contribute assertions to a Design
world, an Implementation world, or a semantic verdict.

```text
fresh projection     -> may supply current semantic facts
stale projection     -> may not supply current semantic facts
last-known projection -> may explain affected correspondence, never prove it
```

This is the key distinction for a refactor. Suppose a Rust function changes.
Its previous Implementation projection becomes nonfresh, so it cannot satisfy
an obligation in the next comparison. Its last accepted projection may still
be inspected to report: “this changed target last corresponded to these Sigil
Facets and origin sections.” That is impact explanation, not stale semantic
truth.

The current store already retains distinct accepted bindings for a source; see
[`BindingHistory` in the projection contract](../sigilc/store.sigil) and the
current projection implementation in [store.rs](../sigilc/src/store.rs). The
kernel extends the facts carried by those projections; it does not add a
workflow ledger.

`sigilc clean` remains an explicit cache reset. It may delete last-known
correspondence along with other generated worlds. After a clean, impact is
unavailable until projections are rebuilt from current filesystem inputs. This
is preferable to turning a disposable cache into hidden, untracked task state.

## Scope remains a compiler capability

Scope is retained because it selects semantic membership, not work scheduling.
A scope chooses:

- the Design roots and their import/ownership closure;
- the target Implementation selection; and
- a deterministic reporting priority.

The existing [scope contract](../sigilc/scope.sigil) and
[scope implementation](../sigilc/src/scope.rs) already enforce most of this:
they validate roots, include transitive Design dependencies, preserve
membership separately from focus order, and reuse unchanged source bindings.

The request-specific meaning is removed. Scope order is never a queue, a
predecessor relation, a completion claim, or a scheduler instruction. An
external caller decides which selected stale projections to reconstruct.
Sources whose incoming anchor sets already exist are independent and may run
concurrently; a downstream source waits only for the external anchor set its
binding names, not for a compiler-owned job lifecycle.

## Sigil is the shared vocabulary

Every accepted Design and Implementation projection describes semantically
meaningful observations in the canonical `sigil:` vocabulary. The vocabulary is
the shared type system for saturation, not a global spelling catalog. The seven
language keywords are its seven contract kinds:

```text
Goal | Interface | State | Logic | Constraint | Decision | Case
```

A `Concept` is the existing semantic type. Writing the same Concept identifier
in another Sigil contract means that same Concept again; a contract can
introduce it or refer to it. A `Facet` is a named,
addressable contribution from one of the seven contracts to a Concept: an
Interface facet may describe an interaction, a Logic facet a transformation, a
State facet a lifecycle configuration, and a Constraint or Case facet a rule or
observable outcome. Components organize contracts; Concepts are deliberately
cross-contract and cross-source.

Each semanticization binding instead supplies an immutable **incoming anchor
set**: typed, hashed anchors accepted from the preceding source surface. The
LLM creates a typed local anchor for every relevant new observation and emits a
`denotes` relation to the incoming anchor it identifies. Thus a source chain
can retain the exact mapping `Age → age → age_years` without pretending that
the three source spellings are one compiler identity. The binding fingerprints
that incoming set; a changed set makes the resulting projection stale.

Each incoming-anchor descriptor contains only the information needed to make a
typed correspondence decision:

```text
hashed anchor ID
source-anchor kind: OriginAnchor | DesignAnchor | ImplementationAnchor
Sigil type: Concept | Facet
Facet contract kind, when applicable:
  Goal | Interface | State | Logic | Constraint | Decision | Case
documentary display label
allowed mappings:
  Concept -> denotes, implements
  Facet   -> denotes, realizes
```

The descriptor is not a slice of `D`: it contains no Design relationships,
obligations, or verdict. Its type prevents an `implements` edge to a Facet or a
`realizes` edge to a Concept. The LLM must not map from lexical similarity
alone; if a local source construct is ambiguous or unrelated, it omits the
correspondence.

Design may introduce source anchors for Concepts and Facets. Downstream Design
and Implementation LLMs receive those anchors as external semantic input, not
`D`, Design relationships, obligations, or conclusions. They use the same
Sigil types and predicates when a fact is semantically relevant; they need not
manufacture all seven contract kinds for every source file.

## Correspondence is asserted Turtle

The desired transitive property comes from semantic correspondence assertions
accepted into source-bound `.egg` projections. It does not come from a hidden
cycle record.

```text
upstream source anchor `Age`
  <--denotes-- Sigil source anchor `age`
                    <--denotes-- Rust source anchor `age_years`

each anchor has a canonical Sigil type
  (`Concept`, `Facet`, and one of the seven contract kinds where applicable)
```

LLM semanticizers propose these assertions during their isolated Turtle pass. Native
ingest validates them against the fixed ontology and source binding, then the
projection store persists the accepted assertions in the corresponding world.
The assertions remain attributable to the file that produced them.

The Implementation LLM creates a typed, source-local anchor key for each
relevant observation. Ingest hashes the opaque key and scopes it to a stable
source namespace; neither step requires source-language parsing:

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

At ingestion, Sigil validates the anchor type and opaque key, then constructs:

```text
source namespace = sha256(versioned normalized workspace-relative source path)
anchor identity  = source namespace # sha256(versioned anchor key)
```

The LLM chooses the anchor key as part of semanticization; the compiler owns
the hash, namespace, and collision-safe identity form. The label and optional
span are documentary, not identity. The same LLM key may give useful continuity
through ordinary edits, but the compiler makes no source-language claim that a
later anchor is the same symbol. Sigil need not parse Rust, Python, TypeScript,
or any other implementation language to perform this rewrite or validate the
resulting graph. It validates that each `denotes` target is in the immutable
incoming anchor set, that `implements` targets are Concepts, and that
`realizes` targets are Facets. It never validates that a source-language symbol
has a particular name.

### Worked chain: README.md → Sigil → Rust/Deno

Consider a repository whose original product statement lives in `README.md`:

```markdown
## Semantic bridge

The semantic bridge accepts a design export and produces a comparison report.
```

The Markdown LLM introduces typed source anchors for the concept and interface
facet it observes. An introducing source has no upstream source anchor to
denote; its anchors become part of the next binding's incoming anchor set.

```turtle
<urn:sigil:anchor:8ac4...#d2b7...>
  a sigil:OriginAnchor, sigil:Concept ;
  sigil:label "Semantic bridge" .

<urn:sigil:anchor:8ac4...#a03e...>
  a sigil:OriginAnchor, sigil:InterfaceFacet ;
  sigil:about <urn:sigil:anchor:8ac4...#d2b7...> ;
  sigil:label "comparison report" .
```

In a later pass, the `architecture.sigil` LLM receives those two source anchors.
It creates its own typed anchors and uses `denotes` to record the crossover,
rather than copying, unioning, or globally renaming the Markdown anchors.

```turtle
<urn:sigil:anchor:31f9...#78c1...>
  a sigil:DesignAnchor, sigil:Concept ;
  sigil:label "SemanticBridge" ;
  sigil:denotes <urn:sigil:anchor:8ac4...#d2b7...> .

<urn:sigil:anchor:31f9...#fa63...>
  a sigil:DesignAnchor, sigil:InterfaceFacet ;
  sigil:about <urn:sigil:anchor:31f9...#78c1...> ;
  sigil:denotes <urn:sigil:anchor:8ac4...#a03e...> .
```

The selected Rust and Deno LLMs receive the Sigil anchors in their own incoming
sets. They create local anchors that denote those exact source anchors:

```turtle
<urn:sigil:anchor:3c91...#c14a...>
  a sigil:ImplementationAnchor, sigil:LogicFacet ;
  sigil:label "SemanticBridge::compare" ;
  sigil:denotes <urn:sigil:anchor:31f9...#78c1...>,
    <urn:sigil:anchor:31f9...#fa63...> ;
  sigil:implements <urn:sigil:anchor:31f9...#78c1...> ;
  sigil:realizes <urn:sigil:anchor:31f9...#fa63...> .

<urn:sigil:anchor:71e2...#a421...>
  a sigil:ImplementationAnchor, sigil:LogicFacet ;
  sigil:label "exportComparison" ;
  sigil:denotes <urn:sigil:anchor:31f9...#78c1...>,
    <urn:sigil:anchor:31f9...#fa63...> ;
  sigil:implements <urn:sigil:anchor:31f9...#78c1...> ;
  sigil:realizes <urn:sigil:anchor:31f9...#fa63...> .
```

The same mechanism records terminology across a chain without compiler name
matching:

```text
origin anchor `Age`
  <--denotes-- Design anchor `age`
                    <--denotes-- Implementation anchor `age_years`
```

The fixed kernel computes typed `denotes` closure and applies bridge laws using
canonical Sigil types and predicates—not `Age`, `age`, or `age_years` strings.
An anchor's correspondence alone never satisfies an obligation; a bridge still
needs the required fresh Implementation facts.

If the Rust source changes, its old source anchor is not reused as current truth.
The impact report may read its last accepted correspondence and produce:

```text
changed packages/kernel/src/bridge.rs
  → last-known Rust source anchor c14a...
  → Sigil source anchor fa63...
  → README.md section “Semantic bridge”
```

That report means “this origin section may need freshening after the downstream
change.” It does not mean the README bytes are stale, and it cannot satisfy or
invalidate a current comparison. Reconstructing the changed Rust source may
recreate a source-scoped hashed anchor when the LLM chooses the same anchor key;
regardless, it replaces the current correspondence surface.

Today, the relevant limits are intentional but insufficient for this model:

- the current Turtle vocabulary is fixed in
  [`turtle.rs`](../sigilc/src/turtle.rs);
- `implements`, `denotes`, `correspondsTo`, and equivalence predicates do not
  yet exist there;
- the current frozen catalog in [catalog.rs](../sigilc/src/catalog.rs) must
  become the binding's typed incoming-anchor set, so an Implementation LLM can
  denote only anchors that were actually supplied; and
- current [comparison.rs](../sigilc/src/comparison.rs) consumes obligations and
  Implementation facts only for a one-shot verdict. It does not yet emit an
  impact graph.

The new kernel makes those limitations explicit extension points. A target
anchor is a typed, LLM-authored key hashed and source-scoped mechanically by
ingestion, not an untracked model string and not a compiler-verified
source-language symbol. When source bytes change, its prior mapping is last-known only;
saturation may follow that mapping outward to identify the upstream repair
surface until a new projection is accepted.

## Origin, canonical terminology, and local labels

Identity and spelling are different.

Every source format first produces typed hashed anchors and preserves its local
labels: `age`, `Age`, `height_cm`, or `BMI`. A designated origin or glossary
source introduces the first typed source anchors; downstream sources receive
them as incoming anchors and explicitly denote them. The initial authority must
be explicit, never inferred from whichever file happened to be selected first.

```text
Origin `Age`
  <--denotes-- Python local `age`
                    <--denotes-- Rust `Person::age_years`
```

The language model may propose mappings, but it does not get to silently merge
identities. A mapping becomes usable only after it is an accepted, validated
assertion. An unmapped spelling collision is ambiguity, not proof that two
things are the same.

This builds on the existing rule that a local name is an identity key and need
not equal its display label; see [catalog.rs](../sigilc/src/catalog.rs). The
current frontend's source ownership and terminology are documented in
[frontend.rs](../sigilc/src/frontend.rs),
[glossary model code](../core/src/model/glossary.sigil), and the
[language grammar](../../spec/language.sigil).

## A hierarchy of correspondence, not blanket `sameAs`

Do not use global RDF-style `sameAs` as the default relation. It would let a
lexical alias, a representation mapping, and a strict semantic equivalence all
collapse into one identity. That loses attribution and can make unrelated
obligations appear satisfied.

The ontology instead gains a common correspondence family with typed members:

| Relation | Meaning | May drive impact? | May satisfy an obligation? |
| --- | --- | ---: | ---: |
| `correspondsTo` | broad common family | yes | no |
| `denotes` | local anchor maps to a supplied upstream source anchor | yes | only through explicit rules |
| `implements` | local target anchor makes an explicit implementation claim about its denoted Design anchor | yes | yes, through matching rules |
| `realizes` | local anchor makes an explicit Facet realization claim | yes | yes, through matching rules |
| `specifies` | Sigil source gives structured meaning | yes | no by itself |
| `refines` | narrower semantic representation | yes | only where a rule opts in |
| `aliasOf` | lexical/terminology synonym | terminology only | no |
| `equivalentTo` | explicitly asserted semantic equivalence | yes | only in explicitly enabled rules |

The LLM emits `denotes` for the source-anchor crossover it observed. When code
also carries stronger meaning, it emits `implements` to the supplied Concept
anchor and `realizes` to the supplied Facet anchor. These are not the same:
one Concept can have many Facets, so `implements` gives broad Concept coverage
while `realizes` identifies the specific behavior, state, constraint, decision,
or case seen in source. `sigilc` validates target membership and Sigil types,
and requires `implements` and `realizes` targets to also appear in `denotes`;
it does not validate the programming-language observation that caused the LLM
to assert either relation.

Saturation derives a broad `impact-reachable` closure from correspondence
relations. It derives a separate symmetric/transitive equivalence closure from
`equivalentTo`. A rule that matches requirements chooses which closure it is
allowed to use. Thus all “same-ish” variants share a discoverable superclass,
while only explicit equivalence crosses a strict semantic boundary.

Use ordinary Egglog relations for this first. The present kernel represents
resource identities as `String` relation values; it does not use e-class union
for them. Applying Egglog `(union ...)` to correspondence would erase the
separate Markdown, Sigil, and code anchors and their witnesses. Relational
closure preserves provenance and allows the kernel to say *why* two anchors are
connected.

## Saturation and comparison

Saturation remains local, finite, and compiler-owned. It is never aware of a
“cycle”; it sees an asserted world and derives permitted consequences. The
current behavior is defined by:

- [kernel.egg](../sigilc/src/kernel.egg), the shared closure rules;
- [design.egg](../sigilc/src/design.egg), authored-contract interpretation and
  obligations;
- [comparison.egg](../sigilc/src/comparison.egg), the third, independent
  obligation matcher;
- [kernel.rs](../sigilc/src/kernel.rs), which creates a fresh EGraph for every
  Design or Implementation saturation; and
- [comparison.rs](../sigilc/src/comparison.rs), which intentionally does not
  feed Design facts into the Implementation closure.

The kernel keeps that separation. Current Design facts establish obligations;
current Implementation facts establish actual behavior; a third fixed matcher
decides `Closed`, `Converged`, or `Drift`. Last-known stale correspondence facts
may appear in an impact report, never in the matcher that proves a current
obligation.

Saturation and comparison use canonical `sigil:` types, contract kinds, and
predicates. `denotes` closure follows typed source anchors across the chain;
fixed bridge laws then normalize eligible fresh anchor observations into
semantic facts. Raw labels and hashes are never comparison keys.

An `impact` operation therefore has a different contract from `compare`:

```text
changed or missing target binding
  -> last-known target correspondence
  -> correspondence closure
  -> affected typed source anchors
  -> affected Sigil Facets and origin anchors
```

It reports a repair surface and witnesses. It does not declare the origin
source's bytes stale, alter the current world, or manufacture a semantic
verdict.

### Deferred precision: Facet-granular anchors

The initial binding is source-scoped: a file's accepted anchors become the
external incoming set for a downstream source. A later capability should select
and bind incoming anchors at Facet granularity rather than at file granularity.
That can let one saturation pass distinguish a genuinely broken Facet from the
broader “this file once denoted these Facets” repair surface. It must remain a
binding/freshness refinement, not a task queue or a relaxation of the rule that
stale assertions never establish current truth.

## Numerical laws are ranking, never truth

The initial seed already demonstrates the right numerical pattern:

- `distance` is a minimum-cost dependency path;
- `peak-risk` is a maximum propagated risk;
- path arithmetic is bounded; and
- latency budgets are crisp pass/fail obligations.

See the functions and rules in [kernel.egg](../sigilc/src/kernel.egg), numeric
validation in [turtle.rs](../sigilc/src/turtle.rs), and the numeric matcher in
[comparison.egg](../sigilc/src/comparison.egg). Egglog's function merge laws
make `min` and `max` good fixed-point operators because their results are
monotone and independent of source fact arrival order. The local Egglog guide
is [egg.md](../../egg.md).

Correspondence can use the same safe pattern:

- `impact-distance`: minimum crossover/path cost from a changed target to an
  origin anchor;
- `impact-risk`: maximum declared risk along an affected path; and
- `coverage-count`: observed mapped targets, used for diagnostics only.

No score can make an obligation true. Hash/binding freshness and crisp logical
relations determine semantic validity. Numbers rank or explain the repair
surface after validity has been determined.

## The seven Sigil contracts are first-class

`Goal`, `Interface`, `State`, `Logic`, `Constraint`, `Decision`, and `Case` are
the seven canonical contract kinds. They are all available to Design and
Implementation semanticization through the same Sigil vocabulary. `State` is
already present in the frontend section model, the Turtle classes,
`initialState` and `transitionsTo` predicates, and Design rules for
required-state ownership. See [frontend.rs](../sigilc/src/frontend.rs),
[turtle.rs](../sigilc/src/turtle.rs), and [design.egg](../sigilc/src/design.egg).

The kernel extension makes every contract's Facets correspondence-aware. For
example, an origin lifecycle section, its State Facet, and an implementation
state-machine or persistence anchor can be related and included in impact
closure. This adds traceability without weakening required-owner and
exclusive-owner laws.

## Opaque semanticization boundary

`prepare` writes copied semantic inputs and an immutable `binding.json`.
`ingest --binding binding.json` accepts Turtle only when it describes those
current inputs and can publish at the binding's expected generation.

```text
sigilc prepare -> immutable semantic inputs + binding.json
independent LLM semanticizer -> Turtle
Turtle -> sigilc ingest --binding binding.json -> accepted projection
```

The LLM invocation is opaque to Sigil. Sigil neither validates nor records its
model, provider, prompt, worker, attempt, retry, log, execution receipt, or
Turtle-production history.

Freshness depends only on source identity, semantic input binding, ontology,
projection format, incoming anchor set, and publication generation. A better
model or prompt never makes an accepted projection stale; an external caller
may reconstruct unchanged inputs whenever it chooses.

The binding is compiler correctness, not a job or lifecycle. It prevents Turtle
for `foo.rs@H1` from publishing as `foo.rs@H2`, prevents a projection built for
incoming anchor set `A1` from becoming current under incompatible `A2`, and
prevents an old preparation from overwriting a newer generation. The current
implementation of this boundary is [Job in store.rs](../sigilc/src/store.rs); it will be renamed
to `PreparedBinding` as part of the breaking simplification.

## Migration boundary

The implementation follows this order:

1. Create this Rust package, move the exact current kernel program and runtime
   wrapper into it, and make `sigilc` depend on its library without behavior
   change.
2. Preserve all current kernel, Design, Implementation, comparison, scope,
   source, catalog, and store tests while extracting the package.
3. Remove artifact evidence, all `--evidence` handling, generated
   `evidence.json`, process/attempt fields, and worker-provenance reports.
   Rename `Job`/`job.json` to `PreparedBinding`/`binding.json` without changing
   source binding, freshness, or atomic publication rules.
4. Extend the ontology, catalog, frontend observations, and Turtle validation
   with the canonical Sigil contract/Concept/Facet vocabulary, LLM-authored
   typed hashed anchors, and the typed correspondence family.
   Do not add implementation-language parsing, adapters, resolvers, LSPs,
   language-specific anchor formats, Git history, or fuzzy matching.
5. Persist accepted correspondence assertions in the existing per-source world
   projections; add current-vs-last-known inspection without allowing stale
   assertions into current compilation.
6. Add an impact report and its bounded witnesses, then add optional monotone
   numeric ranking.
7. Remove the request/workflow ledger and all related CLI, contracts, docs, and
   tests. Scope remains; artifact evidence does not.

The existing native command and worker protocol is described in
[packages/sigilc/README.md](../sigilc/README.md) and the repository-owned
[Sigil skill](../../integrations/skills/sigil/SKILL.md). Those documents must be
updated alongside the implementation so that no instruction continues to treat
the compiler as a queue, task ledger, worker protocol, or provenance recorder.
