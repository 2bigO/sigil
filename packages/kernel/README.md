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
units and origin sections.” That is impact explanation, not stale semantic
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
external caller decides which selected stale projections to reconstruct and may
do independent ones concurrently.

## Correspondence is asserted Turtle

The desired transitive property comes from semantic correspondence assertions
accepted into source-bound `.egg` projections. It does not come from a hidden
cycle record.

```text
Markdown section anchor
  --originates--> canonical Concept or Unit

Sigil concept / unit
  --specifies--> canonical Concept or Unit

Rust or Deno symbol anchor
  --implements--> canonical Concept or Unit
```

Workers may propose these assertions during their isolated Turtle pass. Native
ingest validates them against the fixed ontology and source binding, then the
projection store persists the accepted assertions in the corresponding world.
The assertions remain attributable to the file that produced them.

An Implementation semanticizer uses opaque local placeholders, never a
language-specific symbol identity:

```turtle
<urn:sigil:local:a1>
  a sigil:Implementation ;
  sigil:label "Person::age_years" ;
  sigil:implements <urn:sigil:entity:...:Age> .
```

At ingestion, Sigil scopes each placeholder to the accepted projection binding,
for example `urn:sigil:projection:<binding-fingerprint>#a1`. The token is
projection-local; the label and any optional span are documentary. Sigil need
not parse Rust, Python, TypeScript, or any other implementation language to
perform this rewrite or validate the resulting graph.

### Worked chain: README.md → Sigil → Rust/Deno

Consider a repository whose original product statement lives in `README.md`:

```markdown
## Semantic bridge

The semantic bridge accepts a design export and produces a comparison report.
```

The Markdown semanticizer gives that section a projection-local anchor and
records that it denotes the canonical concept. The rendered anchor below is
already compiler-scoped; the semanticizer itself submitted only `local:readme-1`.

```turtle
<urn:sigil:projection:README-binding#readme-1>
  a sigil:OriginAnchor ;
  sigil:label "Semantic bridge" ;
  sigil:denotes <urn:sigil:entity:docs%2Farchitecture.sigil:SemanticBridge> .
```

In a later pass, `architecture.sigil` gives that concept its structured
meaning. Its unit and concept are ordinary canonical Design identities; the
Sigil projection adds a typed correspondence rather than collapsing the
Markdown anchor with either identity.

```turtle
<urn:sigil:entity:architecture.sigil:SemanticBridgeContract>
  a sigil:Contract ;
  sigil:specifies <urn:sigil:entity:architecture.sigil:SemanticBridge> ;
  sigil:from <urn:sigil:entity:architecture.sigil:SemanticBridge> ;
  sigil:target <urn:sigil:entity:architecture.sigil:ComparisonReport> .

<urn:sigil:entity:architecture.sigil:SemanticBridge>
  sigil:provides <urn:sigil:entity:architecture.sigil:ComparisonReport> .
```

The selected target scope may contain both Rust and Deno sources. Their
semanticizers independently observe local implementation anchors and connect
them to the same canonical identity:

```turtle
<urn:sigil:projection:rust-binding#r1>
  a sigil:Implementation ;
  sigil:label "SemanticBridge::compare" ;
  sigil:implements <urn:sigil:entity:architecture.sigil:SemanticBridge> ;
  sigil:provides <urn:sigil:entity:architecture.sigil:ComparisonReport> .

<urn:sigil:projection:deno-binding#d1>
  a sigil:Implementation ;
  sigil:label "exportComparison" ;
  sigil:implements <urn:sigil:entity:architecture.sigil:SemanticBridge> ;
  sigil:provides <urn:sigil:entity:architecture.sigil:ComparisonReport> .
```

The fixed kernel may contain an explicit bridge law that normalizes the local
observation into a canonical actual fact:

```text
anchor implements A + anchor provides C
  → actual A provides C
```

It does **not** infer that every requirement of `A` is satisfied merely because
an anchor implements `A`.

If the Rust source changes, its old `r1` anchor is not reused as current truth.
The impact report may read its last accepted correspondence and produce:

```text
changed packages/kernel/src/bridge.rs
  → last-known Rust anchor r1
  → SemanticBridge
  → README.md section “Semantic bridge”
```

That report means “this origin section may need freshening after the downstream
change.” It does not mean the README bytes are stale, and it cannot satisfy or
invalidate a current comparison. Reconstructing the changed Rust source creates
new projection-local anchors and replaces the current correspondence surface.

Today, the relevant limits are intentional but insufficient for this model:

- the current Turtle vocabulary is fixed in
  [`turtle.rs`](../sigilc/src/turtle.rs);
- `implements`, `denotes`, `correspondsTo`, and equivalence predicates do not
  yet exist there;
- the current frozen catalog in [catalog.rs](../sigilc/src/catalog.rs) prevents
  an Implementation worker from inventing arbitrary function identities; and
- current [comparison.rs](../sigilc/src/comparison.rs) consumes obligations and
  Implementation facts only for a one-shot verdict. It does not yet emit an
  impact graph.

The new kernel makes those limitations explicit extension points. A target
anchor is an opaque projection-local identity scoped mechanically by ingestion,
not an untracked model string and not a compiler-verified source-language
symbol. When source bytes change, its prior mapping is last-known only;
saturation may follow that mapping outward to identify the upstream repair
surface until a new projection is accepted.

## Origin, canonical terminology, and local labels

Identity and spelling are different.

Every source format first produces opaque local anchors and preserves its local
labels: `age`, `Age`, `height_cm`, or `BMI`. A designated origin or glossary
source establishes canonical Concept and Unit identities. In a simple chain the
initial source is that authority; the authority must be explicit, never inferred
from whichever file happened to be selected first.

```text
Markdown #Age             --denotes--> urn:...:Age
Python local `age`        --denotes--> urn:...:Age
Rust `Person::age_years`  --implements--> urn:...:Age
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
| `denotes` | local anchor names a canonical identity | yes | only through explicit rules |
| `implements` | target anchor realizes a canonical identity | yes | yes, through matching rules |
| `specifies` | Sigil source gives structured meaning | yes | no by itself |
| `refines` | narrower semantic representation | yes | only where a rule opts in |
| `aliasOf` | lexical/terminology synonym | terminology only | no |
| `equivalentTo` | explicitly asserted semantic equivalence | yes | only in explicitly enabled rules |

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
- [design.egg](../sigilc/src/design.egg), authored-unit interpretation and
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

An `impact` operation therefore has a different contract from `compare`:

```text
changed or missing target binding
  -> last-known target correspondence
  -> correspondence closure
  -> affected canonical identities
  -> affected Sigil units and origin anchors
```

It reports a repair surface and witnesses. It does not declare the origin
source's bytes stale, alter the current world, or manufacture a semantic
verdict.

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

## State is already a first-class seed

`State` is not absent from the current schema. It is already present in the
frontend section model, the Turtle classes, `initialState` and `transitionsTo`
predicates, and Design rules for required-state ownership. See
[frontend.rs](../sigilc/src/frontend.rs), [turtle.rs](../sigilc/src/turtle.rs),
and [design.egg](../sigilc/src/design.egg).

The kernel extension is to make state anchors participate in correspondence:
an origin lifecycle section, its Sigil State identity, and an implementation
state-machine or persistence anchor can be related and included in impact
closure. This adds traceability without weakening the existing required-owner
and exclusive-owner laws.

## Opaque semanticization boundary

`prepare` writes copied semantic inputs and an immutable `binding.json`.
`ingest --binding binding.json` accepts Turtle only when it describes those
current inputs and can publish at the binding's expected generation.

```text
sigilc prepare -> immutable semantic inputs + binding.json
external environment -> any human, model, script, retry, or parallel process
Turtle -> sigilc ingest --binding binding.json -> accepted projection
```

The middle step is opaque to Sigil. It may use one model, many models, a human,
or a deterministic future semanticizer. Sigil neither validates nor records the
producer, model, provider, prompt, worker, attempt, retry, log, execution
receipt, or Turtle-production history.

Freshness depends only on source identity, semantic input binding, ontology,
projection format, applicable catalog, and publication generation. A better
model or prompt never makes an accepted projection stale; an external caller
may reconstruct unchanged inputs whenever it chooses.

The binding is compiler correctness, not a job or lifecycle. It prevents Turtle
for `foo.rs@H1` from publishing as `foo.rs@H2`, prevents a projection built for
catalog `C1` from becoming current under incompatible `C2`, and prevents an old
preparation from overwriting a newer generation. The current implementation of
this boundary is [Job in store.rs](../sigilc/src/store.rs); it will be renamed
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
   with compiler-scoped opaque local anchors and the typed correspondence family.
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
