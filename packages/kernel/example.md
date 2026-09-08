Canonical end-to-end example

The canonical model is:

«LLMs emit generators. The kernel computes closure under composition. Comparison checks realization.»

For a selected scope:

D  = Design generators
I  = Implementation generators

D* = closure(D, Design composition laws)
I* = closure(I, Implementation composition laws)

O  = obligation projection(D*)

R  = realization(O, I*)

"D" and "I" are always saturated independently. Design facts never enter Implementation closure.

1. Design semanticization emits generators

Suppose the Design semanticizer identifies:

C = PreparedBinding       [Concept]
F = ImmutableBinding      [InterfaceFacet]

and emits direct Design facts:

facetOf(F, C)
provides(C, F)

The LLM does not emit an obligation and does not decide whether the Design is satisfied.

2. Design saturation derives the obligation

The Design kernel computes closure:

D
│
│ closure under Design composition
▼
D*

From the Design semantics, the obligation projection derives:

O42 = obligation(C, provides, F)

Conceptually:

D ──closure──→ D* ──obligation projection──→ O

The obligation is therefore a compiler-derived consequence, not an LLM judgment.

3. Implementation semanticization independently emits generators

The Implementation semanticizer receives the implementation source and permitted incoming anchors, but not "D", "D*", "O42", Design relationships, or comparison feedback.

Reading "inputs.rs", it identifies:

S = struct PreparedBinding
M = PreparedBinding::write_binding

and emits direct source observations:

implements(S, C)
realizes(M, F)
factorsThrough(M, S)
provides(M, F)

These are generators.

The semanticizer does not emit the composed statement that the Design obligation is realized.

4. Implementation saturation performs composition

The Implementation world contains this structure:

                 factorsThrough
        M ───────────────────────→ S
        │                          │
        │                          │ implements
        │                          ▼
        │                          C
        │                          ▲
        │                          │ facetOf
        ▼                          │
        F ─────────────────────────┘

        M ─────── provides ──────→ F

The kernel owns the composition law:

factorsThrough(M, S)
+ implements(S, C)
+ realizes(M, F)
+ facetOf(F, C)
+ provides(M, F)

→ realizes(C, provides, F)

Thus:

I
│
│ closure under Implementation composition
▼
I*

realizes(C, provides, F)

The important boundary is that correspondence alone is insufficient.

This:

implements(S, C)
realizes(M, F)
factorsThrough(M, S)

does not establish:

realizes(C, provides, F)

The local behavioral generator:

provides(M, F)

is also required.

5. Comparison checks realization

Design closure produced:

O42 = obligation(C, provides, F)

Implementation closure independently produced:

realizes(C, provides, F)

The fixed comparison law is simply:

obligation(s, p, o)
+ realizes(s, p, o)

→ satisfied(obligation)

Therefore:

D*                               I*
│                                │
▼                                ▼
obligation(C, provides, F)       realizes(C, provides, F)
                \                 /
                 \               /
                  ── realization ─
                         │
                         ▼
                  satisfied(O42)

If "I*" does not contain the required "realizes(C, provides, F)", the obligation remains unresolved.

If every finite Design obligation has a matching realization and no contradiction exists:

Closed

If no contradiction exists but one or more required realizations are missing or unresolved:

Converged

If Implementation closure establishes a contradiction of a Design obligation or prohibition:

Drift

Canonical computation

D* = saturate_design(D)
I* = saturate_implementation(I)

O = obligations(D*)

for each obligation(s, p, o) in O:
    require realizes(s, p, o) in I*

Or visually:

DESIGN

source
  ↓
LLM
  ↓
generators D
  ↓
closure under composition
  ↓
D*
  ↓
obligation projection
  ↓
O
                         IMPLEMENTATION

                         source
                           ↓
                         independent LLM
                           ↓
                         generators I
                           ↓
                         closure under composition
                           ↓
                         I*
                           ↓
                         realizes(...)

             O ───────────┐
                          │
                          ▼
                   realization check
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
           Drift      Converged      Closed

The governing principle is:

«Semanticizers assert irreducible source observations. The kernel owns composition. Design closure projects obligations. Implementation closure derives realizations. Comparison asks whether every required Design morphism is realized by the independently derived Implementation world.»
