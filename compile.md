# Task: Replace LLM-as-a-Judge Compilation with Semantic Worlds

Study the existing Sigil codebase first, including the language/compiler, current compile/review workflow, contract concepts (`goal`, `interface`, `constraints`, `decisions`, `cases`, etc.), implementation anchoring/evidence mechanisms, and agent harnesses.

Then design and implement the architecture below, reusing existing Sigil machinery wherever possible.

## Goal

Replace Sigil's current LLM-as-a-judge compilation/review loops with a deterministic semantic reasoning core.

The central model is:

**LLMs propose semantic worlds. Turtle stores facts. egglog computes what follows. Deterministic evaluation selects valid worlds. Humans are asked only about genuine unresolved intent.**

The same mechanism should later verify whether code actually implements a green Sigil specification.

Do not treat this as a conventional knowledge graph or retrieval system. The important property is computational closure: asserted facts enter the system, rules derive new facts/properties/obligations, and those consequences drive compilation.

## Core architecture

Use only two semantic technologies:

1. **RDF Turtle** for facts / semantic state.
2. **egglog** for inference, computation, constraints, closure, numerical analysis, and derived obligations.

Do not introduce JSON-LD, RDF 1.2 triple-term/reification machinery, N-Quads, TriG, OWL, SHACL, or another intermediate semantic language unless existing code creates a compelling technical requirement.

Use the mature ordinary Turtle subset. We deliberately want a representation that current LLMs already generate extremely reliably.

The conceptual boundary is:

```text
Turtle = What facts do we have?
egglog = What follows from those facts?
```

The LLM should not normally write egglog. Sigil owns the egglog rules.

## Sigil ontology

Create a small, stable Sigil semantic vocabulary.

It should capture concepts already present in Sigil rather than inventing a parallel language.

Likely classes include concepts such as:

```text
Component
System
Actor
Capability
Artifact
Boundary
State
Decision
Constraint
Case
Evidence
Implementation
```

Likely predicates include concepts such as:

```text
owns
provides
requires
dependsOn
implements
excludes
routesThrough
persistsAt
authorityFor
trusts
invokes
reads
writes
uses
evidenceFor
```

These names are illustrative. Derive the actual ontology from the existing Sigil language and codebase.

The ontology is effectively Sigil's semantic ISA.

LLMs may introduce new **instances/entities** freely when interpreting user intent, but should normally be prohibited from inventing new predicates/classes. Ontology evolution must be explicit rather than silently generated per specification.

Ordinary RDF literals are sufficient for values:

```turtle
:Bridge :latencyBudgetMs 50 .
:Foo :risk 0.2 .
:Requirement :required true .
```

If a relationship genuinely needs properties of its own, model it as an entity rather than introducing RDF reification. For example:

```turtle
:Dependency42
    a :Dependency ;
    :from :A ;
    :to :B ;
    :strength 0.7 ;
    :cost 14 .
```

This can lower to an n-ary egglog representation.

## Phase 1: intent → candidate semantic worlds

The user continues interacting with Sigil in normal natural language.

Instead of having the LLM immediately author the final `.sigil` file, use it as a **semantic world generator**.

Given user intent and the current semantic state, the LLM emits Turtle candidate patches.

For unambiguous information, one interpretation is sufficient.

For consequential ambiguity, ask the model to generate several **materially different semantic interpretations**, not several phrasings of the same interpretation.

Example:

```text
user intent
    ↓
LLM
    ├── candidate A.ttl
    ├── candidate B.ttl
    ├── candidate C.ttl
    └── candidate D.ttl
```

Candidates should be deltas over the current semantic state where practical, rather than repeatedly regenerating everything.

Prompt models approximately as follows:

> Produce valid Turtle using only the supplied Sigil vocabulary. You may introduce new instance identifiers but not new predicates or classes. Express semantic facts only. Do not encode inference rules or conclusions that should be derived by Sigil.

## Phase 2: deterministic RDF → egglog lowering

Parse and normalize candidate Turtle using a real RDF parser.

Do not rely on textual Turtle manipulation.

Create a deterministic lowering from the Sigil RDF ontology into egglog facts.

For example:

```turtle
:InstalledSigil :owns :Compilation .
```

might lower to:

```lisp
(owns InstalledSigil Compilation)
```

The LLM must not control this transformation.

## Phase 3: egglog is the semantic computer

Sigil owns a stable library of egglog rules encoding architectural/contract semantics.

Examples of analyses that may eventually belong here:

* ownership
* authority
* exclusivity
* boundaries
* dependencies
* reachability
* transitive relationships
* state relationships
* constraint satisfaction
* case satisfiability
* contradictions
* required capabilities
* missing ownership
* trust relationships
* numerical costs/scores/distances
* implementation obligations
* evidence requirements

Use egglog's relations/functions/lattices/arithmetic where appropriate.

Do not limit the semantic engine to Boolean validation. A major reason for choosing egglog is that facts can participate in richer computations such as min/max, costs, distances, risk measures, sets, custom merge domains, etc.

Run each candidate world to semantic closure.

## Phase 4: deterministic candidate pruning and ranking

Replace LLM-as-a-judge with deterministic evaluation wherever the semantics permit it.

Prefer a lexicographic objective rather than one arbitrary weighted quality score.

Conceptually:

1. reject contradictions;
2. reject hard constraint violations;
3. maximize satisfied contracts;
4. minimize unresolved required propositions;
5. minimize unsupported assumptions;
6. minimize unnecessary architectural complexity;
7. minimize unnecessary new concepts/dependencies/surface area.

Exact criteria should emerge from existing Sigil semantics.

A hard violation must never be compensated for by enough "quality points."

Do not ask an LLM to emit a `qualityScore` and treat that as verification.

The LLM proposes. The semantic machine evaluates.

## Phase 5: ambiguity becomes information-seeking

If one candidate deterministically dominates the others, select it.

If multiple nondominated candidate worlds remain because user intent genuinely permits different architectures, do **not** arbitrarily select one and do not ask a generic clarification question.

Compute their semantic differences.

Identify a proposition whose answer best discriminates among the surviving worlds, ideally maximizing information gain / eliminating the largest amount of meaningful uncertainty.

Then use the LLM only to render that proposition as a natural question for the user.

Conceptually:

```text
candidate worlds
      ↓
egglog closure
      ↓
prune impossible/dominated worlds
      ↓
multiple survivors?
      ↓
semantic diff
      ↓
highest-value unresolved proposition
      ↓
LLM renders natural-language question
      ↓
user answers
      ↓
Turtle patch
      ↺
```

This is intended to exploit the transformer as a cheap generator of plausible semantic hypotheses while deterministic computation collapses the hypothesis space.

Consider maintaining a small beam of viable semantic worlds rather than committing prematurely to one interpretation.

## Phase 6: real `sigil compile`

Compilation should cease to mean "ask another LLM whether this looks good."

It should become approximately:

```text
Turtle
  ↓
parse / normalize
  ↓
validate Sigil ontology
  ↓
lower to egglog
  ↓
compute closure
  ↓
evaluate invariants
  ↓
perform analyses
  ↓
derive obligations
  ↓
identify unresolved propositions
  ↓
emit deterministic diagnostics
```

Preserve Sigil's useful red/yellow/green UX, but give the statuses deterministic semantics.

Conceptually:

* **RED**: contradiction or violated hard invariant.
* **YELLOW**: semantically consistent, but required information/evidence remains unresolved.
* **GREEN**: required invariants are satisfied and no blocking semantic uncertainty remains.

Diagnostics should carry enough derivation information to explain *why* something is red/yellow and what facts/rules caused it.

## Phase 7: green semantic state → human `.sigil`

Once the semantic world is green, generate the human-readable Sigil representation from the validated semantic state.

The long-term direction is:

```text
canonical semantic state
        ├──→ .sigil
        ├──→ implementation projections
        ├──→ documentation
        ├──→ diagrams
        └──→ tests/obligations
```

The semantic state, not prose wording, becomes the source of meaning.

Reuse the existing `.sigil` syntax and contracts. Do not discard the language's human-facing value.

## Phase 8: compile green semantics into implementation slices

Do not dump the entire RDF graph into the coding agent.

Derive a **semantic slice** for the implementation task.

For example:

```text
WORK UNIT
SigilSemanticBridge

ROLE
Boundary to InstalledSigil

MUST PROVIDE
- Parsing
- Resolution
- Validation
- Compilation

MUST DELEGATE
- Compilation → InstalledSigil

MUST NOT
- Implement Sigil semantic behavior itself
- Persist harness session history

INVARIANTS
- Compilation operations cross SigilSemanticBridge

OBLIGATIONS
O17
O18
O19

RELATED CONTRACTS
C4 C11 C17
```

The projection should contain exactly the semantic context useful to a coding model, rather than RDF syntax for its own sake.

## Phase 9: implementation search

Apply the same candidate-search architecture to coding.

Given a semantic slice, the LLM may generate multiple materially different code patches.

Evaluate them using real tools:

* compiler/typechecker
* tests
* AST analysis
* dependency analysis
* call graph where feasible
* filesystem/API access analysis where feasible
* existing Sigil implementation anchors
* other deterministic evidence already available in the repository

The purpose is again:

```text
LLM proposes
machines execute
egglog evaluates
```

not:

```text
LLM writes
another LLM judges
```

## Phase 10: implementation → Turtle evidence

Convert deterministic observations about the implementation into the same semantic vocabulary.

Conceptually:

```turtle
:CompilationDiagnostics :calls :SigilSemanticBridge .

:SigilSemanticBridge
    :delegates :Compilation ;
    :implementedBy :BridgeTs .

:BridgeTest
    :covers :O18 ;
    :passes true .
```

Static analyzers and other tooling can therefore act as additional producers of Turtle/RDF facts.

Where semantic implementation properties cannot be established mechanically, an LLM may propose evidence, but distinguish this from mechanically established evidence. Do not silently turn "the LLM thinks C17 is implemented" into a proven fact.

Reuse Sigil's existing mechanism that anchors code to the contracts it claims to implement.

## Phase 11: implementation verification through the same egglog engine

Green semantic specifications should derive explicit implementation obligations.

For example:

```text
C17
  ↓
O71: no SigilDX component implements CompilationSemantics
O72: Compilation calls route through SigilSemanticBridge
O73: SigilSemanticBridge delegates Compilation to InstalledSigil
```

Implementation analysis supplies evidence.

Egglog determines whether the evidence satisfies the obligations or proves violations.

Thus the final sanity check becomes **coverage closure**, rather than an adversarial LLM rereading everything:

```text
for every required obligation:
    is sufficient implementation evidence derivable?
```

The ideal provenance chain should eventually be inspectable:

```text
user intent
   ↓
contract/fact
   ↓
derived obligation
   ↓
implementation evidence
   ↓
source code / test
```

## Symmetry of the final architecture

The design should reduce to two similar loops.

### Intent search

```text
human
  ↓
LLM
  ↓
Turtle candidate worlds
  ↓
egglog
  ↓
select / clarify / repair
  ↺
  ↓
GREEN SEMANTIC WORLD
```

### Implementation search

```text
green semantic world
  ↓
semantic slice
  ↓
LLM
  ↓
code candidates
  ↓
execute + analyze
  ↓
Turtle evidence
  ↓
egglog
  ↓
select / repair
  ↺
  ↓
GREEN IMPLEMENTATION
```

## Important architectural principles

Keep these boundaries hard:

**Turtle stores facts. Egglog owns laws and computation. LLMs propose possibilities.**

Do not put inference rules into generated Turtle.

Do not let generated per-project egglog replace a stable Sigil semantic kernel.

Do not use LLM confidence as a substitute for deterministic verification.

Do not generate multiple candidates when the semantic interpretation is obvious. Branch when ambiguity is consequential.

Do not silently promote derived facts into asserted facts. Preserve the distinction between what was explicitly established and what the reasoning engine derived.

Keep compiler/source-location metadata outside the semantic ontology unless there is an actual need to reason over that metadata.

Prefer deterministic transformations between representations wherever possible.

## First task

Do **not** immediately attempt a repository-wide implementation.

First:

1. Inspect the current Sigil architecture and relevant code paths thoroughly.
2. Map the existing Sigil concepts and compile/review flow onto this proposed architecture.
3. Identify what can be reused and what should be replaced.
4. Propose the smallest useful Sigil ontology derived from the language as it exists today.
5. Identify an appropriate egglog integration strategy for this codebase.
6. Build one thin vertical proof of concept using a real existing Sigil component/spec from the repository.

The proof of concept should demonstrate:

```text
existing/user intent
    ↓
LLM-produced Turtle facts
    ↓
real RDF parsing
    ↓
deterministic egglog lowering
    ↓
at least several meaningful Sigil semantic rules
    ↓
new derived facts
    ↓
one GREEN case
one YELLOW case
one RED case
    ↓
deterministic diagnostics with derivation/witness information
```

If practical, also demonstrate two plausible Turtle interpretations of an ambiguous requirement where egglog either eliminates one or identifies the exact semantic difference requiring clarification.

Before broad implementation, report:

* what you found in the existing architecture;
* proposed ontology;
* proposed RDF/Turtle representation;
* proposed egglog representation and rule organization;
* mapping from current compiler statuses to deterministic semantics;
* integration points;
* migration path from current LLM-as-a-judge compilation;
* the vertical prototype results;
* important limitations or places where deterministic semantics cannot yet replace LLM judgment.

Optimize for a **small semantic kernel with strong composability**, not a huge ontology attempting to formalize all software engineering at once.

