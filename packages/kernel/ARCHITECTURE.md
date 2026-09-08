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

The external semanticizer interprets a source language. It may be an LLM, a
human, a script, or a future deterministic tool. It observes a source file and
returns Turtle. `sigilc` validates the Turtle as a graph under the fixed
ontology and exact source/input binding; it does not validate Rust, Python,
TypeScript, Deno, or another source language's AST or symbol table.

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

external environment
  -> opaque production of Turtle

sigilc ingest --binding binding.json
  -> validated, atomically published source projection
```

The binding is compiler correctness, not a job. It includes the normalized
source path and captured source identity, the ontology and projection-format
versions, and the semantic input needed for the projection side. An
Implementation binding also includes the frozen Design entity-catalog
fingerprint. The expected publication generation prevents an old preparation
from overwriting a newer projection.

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
| Frozen Design catalog changes | Bound Implementation projection is stale. |
| Model, prompt, producer, retry, or execution environment changes | Projection remains fresh; external code may choose to reconstruct it. |

Publication must reject a stale source binding, an incompatible catalog, or an
outdated generation. Interrupted publication leaves no projection that can be
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

source bytes + frontend/catalog
             |
             v
  prepare -> immutable binding.json -> external semanticizer -> Turtle
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

The structural Sigil frontend exports authored units, imports, ownership, and
other allowed structure. An external semanticizer turns the selected source
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
| 🔴 `Disjoint` | Current Design facts contradict a hard invariant. No usable catalog or comparison result exists. |
| 🟡 `Loose` | Design is non-contradictory but one or more required Design obligations remain unresolved. A provisional catalog may be exported. |
| 🟢 `Coherent` | Design has no contradiction and all required Design obligations are satisfied. Its catalog is authoritative. |

`Loose` is deliberately not green: even if the Implementation happens to cover
every currently derivable obligation, the final comparison cannot be `Closed`.
If a `Loose` Design becomes `Coherent` without a catalog identity change,
compatible fresh Implementation projections may be reused and only the
closures, obligations, and comparison recomputed.

## Implementation world

Each Implementation projection is source-local. Its semanticizer receives only
the exact target source bytes, fixed ontology, and frozen Design entity catalog
needed to name canonical targets. It does not receive Design relationships,
Design obligations, neighboring implementation bodies, or comparison feedback.

```text
one implementation source + ontology + frozen catalog
            |
            v
independent external semanticization
            |
            v
one accepted local projection of direct observations
```

All fresh selected local projections are assembled as `I`, then
`saturate_implementation(I)` derives the permitted global consequences. A
change to one implementation file invalidates that file's projection, not its
neighbors merely because they import it or expose a changed name. Global
meaning is recomputed from the reusable fresh projections plus the reconstructed
one. A catalog change invalidates the projections built against the old catalog.

The compiler has no implementation-language adapter, AST parser, symbol
resolver, LSP dependency, Git symbol history, or fuzzy name matcher. A comment
or lexical similarity does not independently establish an implementation fact.

## Opaque local anchors and canonical identity

An external semanticizer may observe a source-language construct such as a Rust
method and give it an opaque local placeholder:

```turtle
<urn:sigil:local:a1>
  a sigil:Implementation ;
  sigil:label "Person::age_years" ;
  sigil:implements <urn:sigil:entity:design:Age> .
```

During ingestion, the compiler validates the reserved placeholder form and
rewrites it mechanically into the accepted projection namespace:

```text
urn:sigil:projection:<binding-fingerprint>#a1
```

The placeholder is opaque and projection-local. Its label and optional source
span are documentary. They are not identity, and Sigil makes no promise that a
later reconstruction will use the same `a1` for the same source-language
symbol. This is sufficient for current correspondence and conservative
last-known impact. A source-scoped stable hash adds no required capability
without either language understanding or an author-maintained stable key, so it
is intentionally absent.

Canonical entities are distinct, catalog-controlled Design identities. Origin
anchors, Sigil anchors, and Implementation anchors stay distinct from those
entities. An explicit authority—often an origin document or glossary—chooses
canonical terminology; source-local labels such as `age`, `Age`, and
`age_years` remain local presentation until accepted correspondence maps them.

## Typed correspondence

Correspondence is accepted Turtle in the source projection that asserted it.
It preserves the mapping rather than hiding it in an LLM interpretation.

| Relation | Meaning | Impact closure | Obligation matching |
| --- | --- | ---: | ---: |
| `correspondsTo` | Broad correspondence family | yes | no |
| `denotes` | Local anchor names a canonical entity | yes | only by an explicit rule |
| `implements` | Local target anchor realizes a canonical entity | yes | only by an explicit rule |
| `specifies` | Sigil material gives structured meaning | yes | no by itself |
| `refines` | Narrower representation | yes | only where a rule opts in |
| `aliasOf` | Terminology synonym | terminology only | no |
| `equivalentTo` | Explicit semantic equivalence | yes | only where a rule opts in |

The kernel derives broad correspondence/impact reachability from the permitted
relations. It derives a separate symmetric, transitive closure for explicitly
asserted `equivalentTo`. It must not use Egglog e-class `union`, RDF `sameAs`,
or an equivalent blanket identity mechanism: doing so would erase source
attribution and allow a weak lexical relation to satisfy an unrelated
obligation.

An obligation can be satisfied only by an explicit compiler-owned bridge rule.
For example:

```text
anchor implements A + anchor provides C
  -> actual A provides C
```

The resulting `actual` fact may match a `requires` obligation under the fixed
comparison law. By contrast, `anchor implements A` alone neither proves every
capability required by `A` nor transfers every Design relationship to the
anchor. `denotes`, `specifies`, `aliasOf`, and broad correspondence never
silently satisfy an obligation. Any future exception must be named as a
finite rule in the kernel and tested as such.

`State` remains first-class: existing `initialState`, `transitionsTo`, owner,
and exclusivity laws continue to work. State anchors may participate in typed
correspondence and impact without weakening those existing laws.

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
  -> affected canonical entities, Sigil units, and origin anchors
```

Last-known data may say that an edited Rust file *might affect* a concept or an
origin Markdown section because the prior accepted projection mapped it there.
It cannot enter `D`, `I`, saturation, obligation derivation, comparison, or a
current status. Reconstructing the source gives it new projection-local anchors
and a new current mapping; the older mapping remains only historical cache
context until eviction or `clean`.

An impact report returns affected surfaces and bounded path witnesses. It does
not call the affected source stale, assert that documentation is wrong, or
change any semantic verdict.

## Scope, finiteness, and numerical analysis

Scope is semantic selection: Design roots plus closure, selected Implementation
sources, and deterministic reporting priority. It is not a request queue,
predecessor graph, completion record, or scheduling instruction. The external
environment decides what to reconstruct and when.

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
- A source edit, deletion, incompatible ontology/format change, catalog change,
  or publication race prevents obsolete projection assertions from becoming
  current.
- A source edit may use its prior projection only to report last-known impact.
- Design import closure invalidates affected Design inputs; Implementation
  freshness is local to its source binding and frozen catalog.
- A mixed-language repository works without compiler language adapters.
- Unknown canonical identities, malformed local-anchor placeholders,
  catalog mutation attempts, wrong-side assertions, path escapes, Egglog rules,
  includes, and non-finite numeric input are rejected at ingestion.
- Typed correspondence retains distinct nodes; no alias or `implements` edge
  silently proves a requirement.
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
