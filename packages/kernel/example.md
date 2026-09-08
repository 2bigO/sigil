# Canonical end-to-end example

This is the normative, end-to-end computation for the redesigned kernel. It
does not describe the stale Rust implementation or a compatibility path from
it.

> LLMs emit irreducible, source-bound generators. The kernel computes finite
> closure under fixed composition laws. Comparison checks terminal
> realizations.

For one selected scope:

```text
D   = direct generators from fresh Design projections
I   = direct generators from fresh Implementation projections
D*  = saturate_design(D)
I*  = saturate_implementation(I)
O   = obligations(D*)
R   = compare(O, I*)
```

The central invariant is absolute:

```text
Never: saturate(D union I)
Never: let D or D* enter Implementation saturation
Never: let I or I* rewrite Design obligations
Always: compare the two independently saturated worlds
```

## 1. Design creates a finite requirement

Suppose a Design source introduces these typed, source-scoped anchors:

```text
C = PreparedBinding    [Concept]
F = ImmutableBinding   [Interface Facet]
```

The Design semanticizer supplies only direct Design generators:

```text
facetOf(F, C)
provides(C, F)
```

`facetOf(F, C)` says that `F` is a named Interface contribution to `C`.
`provides(C, F)` is Design meaning: `PreparedBinding` is required to provide
that interface. Neither fact says that an implementation already does so.

Design saturation and obligation projection are compiler-owned:

```text
D  ── Design composition ──>  D*  ── obligation projection ──>  O

O42 = obligation(C, provides, F)
```

The semanticizer does not emit `O42`, and it never chooses a Design status.
`Coherent` means that Design has no contradiction and has determined its full,
finite requirement surface; it does **not** mean that Implementation has
satisfied that surface.

## 2. The Implementation binding exposes anchors, not Design

An Implementation semanticizer receives its exact captured source bytes, the
fixed Sigil ontology, and an immutable incoming-anchor set containing `C` and
`F`. It does **not** receive `D`, `D*`, `O42`, `facetOf(F, C)`,
`provides(C, F)`, any other Design relationships, or comparison feedback.

The relevant binding descriptors are intentionally small:

| External anchor | Sigil type | Direct assertions it may target |
| --- | --- | --- |
| `C` | `Concept` | `denotes`, `implements` |
| `F` | `Interface Facet` | `denotes`, typed local behavior such as `provides` |

The semanticizer creates opaque local anchor keys. Ingestion hashes each key
inside the captured source namespace, so the resulting anchors are safe local
identities without parsing Rust, Python, TypeScript, or any other source
language. Labels and spans are documentary, never identity.

For an illustrative future implementation source, the semanticizer observes:

```text
S = local struct PreparedBinding         [local Concept anchor]
M = local PreparedBinding::write_binding [local Interface Facet anchor]
```

It emits only these direct Implementation generators:

```text
denotes(S, C)
denotes(M, F)
implements(S, C)
factorsThrough(M, S)
provides(M, F)
```

Their roles are deliberately distinct:

- `denotes` is a direct local-to-external anchor mapping. It is never
  transitive.
- `implements(S, C)` is a direct typed role claim: this local struct implements
  the supplied Concept.
- `factorsThrough(M, S)` is a local structural observation: the method's
  behavior belongs to the struct's implementation surface.
- `provides(M, F)` is the LLM's direct source-language observation that the
  method provides the supplied Interface Facet.

The LLM never asserts `correspondsTo` or `realizes`. The kernel derives
`correspondsTo` as broad correspondence closure for impact, and derives
`realizes` only as a terminal theorem.

## 3. The two worlds stay separate

Before either closure has finished, the worlds look like this:

```text
DESIGN: D                              IMPLEMENTATION: I

F ───── facetOf ─────> C               M ── factorsThrough ──> S
C ───── provides ────> F               M ── denotes ─────────> F
                                        M ── provides ────────> F
                                        S ── denotes ─────────> C
                                        S ── implements ──────> C
```

The identical `C` and `F` labels on each side denote the same immutable
external anchors. They do not copy the Design edges into `I`: in particular,
`facetOf(F, C)` stays in `D*` and is never an Implementation-saturation input.

The fixed Implementation composition law is therefore entirely local to `I`:

```text
factorsThrough(M, S)
+ denotes(S, C)
+ implements(S, C)
+ denotes(M, F)
+ provides(M, F)
----------------------------------------------
  realizes(C, provides, F)
```

This is the terminal theorem of `I*`. It is the only form of `realizes` in
this model:

```text
realizes(Concept, predicate, Facet)
```

No direct mapping alone proves it. If `provides(M, F)` is absent, the theorem
does not fire even when `denotes`, `implements`, and `factorsThrough` are all
present. Conversely, the law does not need to import `facetOf(F, C)` from
Design: the later comparison requires the exact same `(C, provides, F)` tuple
that Design independently projected as an obligation.

```text
I  ── Implementation composition ──>  I*

I* contains realizes(C, provides, F)
```

## 4. Comparison is the only cross-world join

The fixed comparator sees only the finite obligation surface from `D*` and the
terminal realization surface from fresh `I*`:

```text
O42 = obligation(C, provides, F)
I*  = realizes(C, provides, F)

obligation(s, p, o) + realizes(s, p, o)
----------------------------------------
                 satisfied(obligation)
```

```text
              D*                                   I*
               │                                    │
               ▼                                    ▼
  obligation(C, provides, F)          realizes(C, provides, F)
               \                                    /
                \                                  /
                 └──── fixed realization check ───┘
                                   │
                                   ▼
                            satisfied(O42)
```

There are six named semantic outcomes across the two stages:

| Stage | State | Meaning |
| --- | --- | --- |
| Design | 🔴 `Disjoint` | Current Design contradicts a hard invariant; it has no usable outgoing anchor set or comparison. |
| Design | 🟡 `Loose` | Current Design is non-contradictory but its own required structure is unresolved; no result may be `Closed`. |
| Design | 🟢 `Coherent` | Current Design is non-contradictory and has a complete finite obligation surface. |
| Compare | 🔴 `Drift` | Fresh `I*` establishes a contradiction of a Design obligation or prohibition. |
| Compare | 🟡 `Converged` | No contradiction is established, but an obligation is unresolved, Design is `Loose`, or required current input is unavailable. |
| Compare | 🟢 `Closed` | Design is `Coherent`, every finite obligation has a fresh terminal realization, and no contradiction exists. |

Thus this example becomes `Closed` only when `D*` is `Coherent`, `I*` derives
the terminal theorem above for `O42` and every other obligation in scope, and
the comparator finds no contradiction. A missing `provides(M, F)` produces
`Converged`, never `Closed`; a contradictory terminal fact produces `Drift`.

## 5. Correspondence and impact are different from truth

Across a source chain, direct mappings preserve terminology without erasing
local identities:

```text
origin anchor Age  <── denotes ──  Sigil anchor age
Sigil anchor age   <── denotes ──  Rust anchor age_years

kernel closure: correspondsTo(age_years, Age)
```

`denotes` remains exactly as asserted. The broad `correspondsTo` relation is
compiler-derived and may be transitive; it is useful for impact witnesses but
cannot satisfy an obligation. No Egglog e-class union, RDF `sameAs`, or blanket
identity merge is involved.

When a source changes, its former projection is stale. The compiler may use
its last accepted direct mappings and derived correspondence only to say what
may need repair:

```text
changed implementation source
  -> last-known local anchor M
  -> last-known denotes(M, F)
  -> last-known correspondence closure
  -> affected Interface Facet F and upstream origin anchors
```

That historical path never enters `D`, `I`, `D*`, `I*`, `O`, or `R`. Stale
anchors cannot satisfy `O42`, produce `Closed`, or prove `Drift`.

## 6. The whole computation

```text
Design source                         Implementation source
     │                                      │
     ▼                                      ▼
independent LLM                     independent LLM
     │                                      │
     ▼                                      ▼
direct generators D                 direct generators I
     │                                      │
     ▼                                      ▼
saturate_design                     saturate_implementation
     │                                      │
     ▼                                      ▼
D*                                  I* terminal realizations
     │                                      │
     ▼                                      │
obligations O ─────── compare ──────────────┘
                       │
                       ▼
             🔴 Drift | 🟡 Converged | 🟢 Closed

changed or missing source ──> last-known correspondence ──> impact only
```

The governing principle is simple: semanticizers interpret source languages
and assert irreducible local observations; `sigilc` validates bindings, anchor
scoping, types, and the fixed ontology; the kernel owns closure; and comparison
alone joins the current Design and Implementation worlds.
