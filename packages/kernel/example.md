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

## 7. Concrete `SemanticBridge`: fresh Design to `Closed`

This final walkthrough applies the preceding computation to one concrete
component. Every identity below is a typed, source-scoped hashed anchor in the
actual projection; short names make the derivation readable.

### Fresh Design source and Design generators

The selected Design source is authored afresh. Its interface says what the
component must provide, not how a Rust or Deno implementation will do it:

```sigil
component SemanticBridge {
  goal {
    Compare a Design world with an independently saturated Implementation world.
  }

  interface {
    SemanticBridge {
      Accept a DesignExport and an ImplementationExport, then produce a
      ComparisonReport.
    }

    ComparisonReport {
      Report unresolved obligations, contradictions, and closure state.
    }
  }
}
```

The fresh Design semanticizer introduces:

```text
C_bridge = SemanticBridge     [Concept]
F_report = ComparisonReport   [Interface Facet]
```

It emits only the irreducible Design facts it observed:

```text
facetOf(F_report, C_bridge)
provides(C_bridge, F_report)
```

The Design kernel, not the semanticizer, computes:

```text
D_bridge  ── saturate_design ──>  D_bridge*

O_bridge = obligation(C_bridge, provides, F_report)
```

Assume the rest of this fresh Design scope is internally complete and
non-contradictory. Its status is therefore 🟢 `Coherent`: `O_bridge` is a
complete requirement to compare, not a fact already established by code.

### Immutable Implementation binding

`sigilc prepare` captures the selected implementation source bytes and creates
an immutable binding. Its external semantic input is exactly these descriptors:

| Hash-shortened anchor | Type | Permitted direct target roles |
| --- | --- | --- |
| `C_bridge` | `Concept` | `denotes`, `implements` |
| `F_report` | `Interface Facet` | `denotes`, local `provides` observation |

The binding does not contain `D_bridge`, `D_bridge*`, `O_bridge`,
`facetOf(F_report, C_bridge)`, or any comparison result. The independent LLM
gets its captured implementation bytes, this small typed input, and the fixed
ontology—nothing that can tell it what answer comparison wants.

### Fresh implementation source and direct observations

For this example, the captured Rust source has the following relevant shape:

```rust
pub struct SemanticBridge {
    kernel: Kernel,
}

impl SemanticBridge {
    pub fn compare(
        &self,
        design: DesignExport,
        implementation: ImplementationExport,
    ) -> ComparisonReport {
        self.kernel.compare(design, implementation)
    }
}
```

The LLM interprets that Rust. It chooses local anchor keys for the struct and
method; ingestion hashes and scopes them to this source binding:

```text
S_bridge = local `SemanticBridge`          [Concept anchor]
M_compare = local `SemanticBridge::compare` [Interface Facet anchor]
```

Its accepted Turtle projection contributes these direct Implementation
generators and nothing terminal:

```text
denotes(S_bridge, C_bridge)
denotes(M_compare, F_report)
implements(S_bridge, C_bridge)
factorsThrough(M_compare, S_bridge)
provides(M_compare, F_report)
```

The facts have a concrete source-language reading:

```text
the struct denotes and implements SemanticBridge
the compare method denotes ComparisonReport
the method factors through the struct
the method provides the report behavior
```

They are still not a comparison result. In particular, the LLM has not
asserted `realizes(C_bridge, provides, F_report)`.

### Independent Implementation saturation

The fresh Implementation world is only its local generators plus the typed
external-anchor identities. It does not receive the Design `facetOf` or
`provides` facts. The fixed law from section 3 fires entirely within `I_bridge`:

```text
factorsThrough(M_compare, S_bridge)
+ denotes(S_bridge, C_bridge)
+ implements(S_bridge, C_bridge)
+ denotes(M_compare, F_report)
+ provides(M_compare, F_report)
------------------------------------------------------
  realizes(C_bridge, provides, F_report)
```

```text
I_bridge  ── saturate_implementation ──>  I_bridge*

I_bridge* contains realizes(C_bridge, provides, F_report)
```

Correspondence alone still proves nothing. Removing the direct local behavior
`provides(M_compare, F_report)` prevents the theorem even though all anchor
mappings, the role claim, and method containment remain available.

### The one permitted cross-world check

Only now does the comparator join the independently produced surfaces:

```text
D_bridge*                               I_bridge*
     │                                       │
     ▼                                       ▼
obligation(C_bridge, provides, F_report)  realizes(C_bridge, provides, F_report)
                      \                   /
                       \                 /
                        └── compare ────┘
                               │
                               ▼
                     satisfied(O_bridge)
```

With every other finite Design obligation in the selected scope likewise
matched by a fresh terminal realization and no contradiction, comparison is:

```text
🟢 Closed
```

This outcome is not a claim that the LLM, compiler driver, or an external
worker is trustworthy in the abstract. It is the precise theorem that the
accepted fresh source observations compose under fixed kernel laws into each
required realization.

### After a source change

If `SemanticBridge::compare` changes, the captured source bytes no longer
match this projection's binding. `I_bridge*` and its terminal theorem leave
current truth immediately:

```text
fresh D_bridge* + missing/stale implementation projection
  -> O_bridge has no fresh matching realization
  -> 🟡 Converged, never Closed
```

The old projection may still explain the repair surface:

```text
changed Rust source
  -> last-known M_compare
  -> denotes(M_compare, F_report)
  -> corresponding ComparisonReport Facet
  -> upstream SemanticBridge and origin anchors
```

That is impact only. It cannot retain `Closed`, prove `Drift`, or be imported
into a new `I_bridge*`. A fresh reconstruction repeats the direct-observation
and saturation steps above against the new binding.
