# Task: Replace LLM-as-a-Judge Compilation with Semantic Worlds

Study the existing Sigil codebase first, including the language/compiler, current compile/review workflow, contract concepts (`goal`, `interface`, `constraints`, `decisions`, `cases`, etc.), implementation anchoring/evidence mechanisms, and agent harnesses.

Then design and implement the architecture below, reusing existing Sigil machinery wherever possible.

## Goal

Replace Sigil's current LLM-as-a-judge compilation/review loops with a deterministic semantic reasoning core.

The central model is:

**LLMs propose semantic worlds. Lossless `.egg` assertions store accepted facts. Compiler-owned egglog rules compute what follows. Deterministic evaluation selects valid worlds. Humans are asked only about genuine unresolved intent.**

The same engine verifies a returned codebase against the green semantic world slice handed to a coding agent, optionally exported as Turtle. The agent returns receipts claiming which triples or obligations are implemented at which code locations. Sigil checks those claims using independent observations and egglog coverage closure.

**Implementation scope:** Sigil prepares the handoff and verifies the returned implementation. The coding agent owns writing and repairing code. Generating, ranking, applying or merging multiple code patches, scheduling coding agents, and owning their implementation/repair loop are out of scope. Intent-world candidate search in phases 1–5 remains in scope.

Do not treat this as a conventional knowledge graph or retrieval system. The important property is computational closure: asserted facts enter the system, rules derive new facts/properties/obligations, and those consequences drive compilation.

## Core architecture

Use only two semantic technologies:

1. **RDF Turtle** for model-facing fact proposals and optional import/export.
2. **egglog** for canonical persisted assertions and for compiler-owned inference, computation, constraints, closure, numerical analysis, and derived obligations.

Persist the accepted merged world only as a lossless, data-only `.egg` assertion file. Turtle is an interchange format; there is no requirement to keep a second canonical Turtle copy. A fresh checkout must be able to load and compile the accepted world using its `.egg` assertions, manifest and compiler-owned kernel without the original Turtle proposals or any derived cache. The compiler owns declarations and rules separately from each project world.

Do not introduce JSON-LD, RDF 1.2 triple-term/reification machinery, N-Quads, TriG, OWL, SHACL, or another intermediate semantic language unless existing code creates a compelling technical requirement.

Use the mature ordinary Turtle subset. We deliberately want a representation that current LLMs already generate extremely reliably.

The conceptual boundary is:

```text
Turtle proposals/imports → normalized assertions → canonical .egg world
compiler-owned egglog kernel + assertions → consequences and obligations
```

LLMs propose assertions, typically in Turtle. Sigil deterministically encodes accepted assertions as `.egg` data. Sigil owns the egglog declarations and rules; the world file cannot define or override them.

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

Separate two deterministic transformations: lossless encoding of normalized assertions for storage, then analysis-specific lowering into typed egglog tables. The second transformation need not preserve everything needed to reconstruct the accepted world; it must never replace the first.

For example:

```turtle
@prefix s: <https://sigil.dev/ontology/1#> .
@prefix ex: <urn:example:> .

ex:InstalledSigil s:owns ex:Compilation .
```

is retained in the canonical world as:

```lisp
(assert-iri "urn:example:InstalledSigil" "https://sigil.dev/ontology/1#owns" "urn:example:Compilation")
```

Under the compiler-owned declarations, that assertion might lower to an execution table such as:

```lisp
(owns InstalledSigil Compilation)
```

The LLM must not control either transformation. Reloading an accepted `.egg` world starts from the same normalized assertions and bypasses Turtle parsing.

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
Turtle proposal/import OR accepted .egg assertions
  ↓
parse selected format / normalize
  ↓
validate Sigil ontology
  ↓
normalize canonical .egg assertions / lower trusted tables
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
canonical .egg assertions
        ├──→ .sigil
        ├──→ implementation projections
        ├──→ documentation
        ├──→ diagrams
        ├──→ tests/obligations
        └──→ Turtle interchange
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

### Handoff artifact

Package the implementation slice with stable canonical assertion identities plus a readable work-unit summary. Offer ordinary Turtle as a model-facing export; retained handoff state can use the canonical `.egg` assertion representation. Preserve the normalized fact identities and derive a fixed list of implementation obligations from the green world. Include enough related assertions and boundary context to verify that slice without giving the coding agent the entire graph.

A versioned sidecar manifest identifies:

* the canonical world fingerprint and exact slice fingerprint;
* the selected components, exported fact and obligation identities, and verification boundary;
* the semantic kernel and verifier-policy identities;
* host-owned component inventories, API bindings and required compiler/test checks;
* the baseline code identity and protected specification, policy and test-oracle fingerprints.

This manifest is transport and provenance metadata, not a third semantic language. Sigil retains the original handoff. A returned manifest cannot replace its authority.

## Phase 9: coding-agent handoff and returned receipts

Hand the slice to a coding agent with this task:

> Implement this handed-off semantic world slice in the codebase. Use its readable summary or optional Turtle export to understand the retained `.egg` assertions and obligations. Return the code and receipts identifying the exact handed-off facts or obligations you claim to implement, together with their code anchors and suggested supporting tests. Report work you could not establish. Do not return a verification verdict.

The agent owns implementation. Sigil resumes when the codebase is handed back with the claim that the work is complete. Verification does not require knowing how many edits the agent made, which model it used, or how it organized its work.

A receipt is an untrusted claim connecting a handed-off proposition to implementation locations. Use ordinary Turtle and existing `Evidence`, `covers`, `from`, `relation` and `target` vocabulary where possible. For example, if the handoff exports O72 as the obligation that CompilationDiagnostics invokes SigilSemanticBridge:

```turtle
@prefix s: <https://sigil.dev/ontology/1#> .
@prefix ex: <urn:example:> .

ex:Receipt17
    a s:Evidence ;
    s:covers ex:O72 ;
    s:from ex:CompilationDiagnostics ;
    s:relation "invokes" ;
    s:target ex:SigilSemanticBridge .
```

`ex:O72` stands for an identity exported by the handoff, not an identifier the agent may invent. If a receipt names a normalized fact instead, Sigil resolves it to the associated implementation obligations. An asserted design triple can require multiple implementation obligations; claiming the triple does not bypass any of them.

Keep paths, symbol selectors, source ranges, file-content hashes, test selectors and producer details in a sidecar keyed by the receipt identity. Reuse existing Sigil implementation anchors when they resolve the claimed locations. Allow one proposition to have several receipts and one receipt to name several obligations only when its exact proposition and evidence scope match each obligation.

Validate receipt syntax, identifiers, proposition shape and handoff identity before checking evidence. Reject unknown obligation references, conflicting duplicate receipt identities and attempts to change the handed-off world or verifier policy. Missing or stale code anchors cannot establish coverage. A source range alone is insufficient if it no longer identifies the expected symbol and file content.

Do not merge returned receipts into canonical design assertions. Agent-written `passes true`, `covers`, an implementation annotation, or a claimed code location is never a trusted observation. The agent may suggest where to look; it cannot choose what counts as sufficient proof.

## Phase 10: returned code and receipts → independent evidence

Capture the returned codebase as a verification snapshot. Bind every result to that code identity, the retained handoff and the verifier policy. Detect changes during verification and invalidate affected results. Disposable copies may be used to run tools without modifying the returned codebase; this is verification isolation, not code-candidate search.

Use receipts to locate claimed implementations and provide useful provenance. Independently discover and analyze the governing component inventory and relevant dependencies. Do not restrict analysis to files the agent chose to mention: an omitted file or prohibited call must not disappear from verification. Use the existing ownership/boundary machinery to identify affected components and required context; if the verification boundary is incomplete, keep coverage unresolved.

Collect evidence using real tools:

* **TypeScript 7** compiler diagnostics, ASTs and resolved symbols;
* imports, dependency edges and direct call sites;
* call paths and filesystem/API access where the analyzer can establish them;
* independently executed host-required tests and compiler checks;
* existing Sigil anchors as location/ownership claims;
* other deterministic, explicitly supported repository checks.

Preserve three separate inputs to the fixed egglog kernel:

| Input | Authority and role |
|---|---|
| Handed-off semantic world and obligations | Accepted meaning and the work that must be verified |
| Returned receipts | Untrusted claims about where that meaning is implemented |
| Host-produced observations, check results and scope certificates | Mechanically established evidence about the returned snapshot |

Record observed semantic relationships separately from accepted assertions, using the lossless `.egg` encoding with optional Turtle export. Keep tool versions, commands, exit codes, source spans, input/output hashes and receipt-resolution details outside the ontology. Only independently collected host evidence may populate trusted observation/check/scope tables through deterministic lowering. Re-reading an exported evidence file as an agent submission must not restore that trust.

Evidence requirements belong to Sigil's stable kernel and host verifier policy. Start with supported, precise properties and leave the rest unresolved:

* A matching resolved call or dependency can establish its corresponding static relation. A function name or nearby text match cannot.
* A call to a bridge alone does not prove delegation or that every route crosses the bridge. Those require explicit composition/path rules and adequate path coverage.
* The existence of a function or an `implements` anchor does not prove a capability's behavior.
* A passing command satisfies that mandatory check. It satisfies a behavioral obligation only where a fixed evidence rule explicitly connects that independently trusted check to that obligation, with its actual scope.
* Agent-added tests and suggested commands remain proposals. They cannot replace the protected oracle or lower an obligation's evidence requirements. Record changes to protected test/policy inputs and withhold affected certification.
* Negative or universal obligations require an independently established complete scope for the exact subject, relation and target, including relevant transitive behavior when the obligation requires it. Missing receipts or absent matches do not prove absence. Dynamic dispatch, opaque effects and unmodeled dependencies keep that scope open.

### From receipt locations to checkable witnesses

A receipt proposes a witness for a particular obligation. The compiler defines what would establish that obligation before inspecting any receipts.

| Obligation | Evidence required by a fixed Sigil rule |
|---|---|
| A statically invokes B | A native-resolved direct call between symbols belonging to A and B |
| A depends on B | A resolved dependency matching the obligation's dependency semantics |
| A never accesses a forbidden API | Complete relevant effect analysis with no prohibited access |
| A passes designated case T | Independent execution of the designated host check |
| A correctly implements a parser | An executable specification or another explicitly supported stronger analysis; an AST location is insufficient |

For Receipt17 pointing to `diagnostics.ts::compile`, first resolve the actual symbol in the returned snapshot and check its ownership and handoff binding. Resolving a location establishes where the claim points, not that the claim is true. Agent-proposed ownership mappings are not automatically authoritative bindings.

TypeScript 7 and other host tools then emit primitive observations. For example, these illustrative rows all belong to one independently identified code snapshot:

```text
obligation(O72, A, invokes, B)             // from the retained handoff
receipt(R17, O72)                         // untrusted submitted claim
located(R17, CallerSymbol)                // independently resolved location
ownedSymbol(A, CallerSymbol)              // validated governing binding
ownedSymbol(B, CalleeSymbol)              // validated governing binding
directCall(CallerSymbol, CalleeSymbol, CallSite42) // native observation
```

A fixed egglog rule joins the exact obligation, receipt, resolved location, symbol bindings and call observation to derive:

```text
supportedReceipt(R17, O72, CallSite42)
covered(O72, CallSite42)
```

A call elsewhere in the file cannot automatically validate the claimed symbol. Each derived result retains the primitive observations and source locations that support it. A wrong receipt location can coexist with independent coverage found elsewhere; report both accurately.

For negative obligations, compute observation/effect closure before evaluating absence. Only then combine an exact complete-scope certificate with the absence of a prohibited observation. Unknown call targets or effects prevent completeness. A possible runtime violation is not a proven execution counterexample unless the obligation itself prohibits that static possibility.

Egglog verifies consequences of established observations. It does not infer arbitrary program correctness from a code pointer. The implementation work is to build sound extractors and sufficiency rules for supported properties, leaving everything beyond their demonstrated scope unresolved.

## Phase 11: egglog receipt checking and coverage closure

Derive the full required obligation set from the retained green slice before considering any receipts. The returned receipt list never defines the work to be checked. Receipts are proposed witnesses, not additional behavioral obligations: an omitted or unsupported receipt leaves its obligation open unless sufficient independent evidence establishes it. Report receipt quality separately from implementation coverage.

The kernel joins claims to exact obligations, independently resolved source anchors, trusted observations and evidence-sufficiency rules. It should derive at least:

* which receipt claims are supported, contradicted or unresolved;
* which required obligations have sufficient evidence;
* which required obligations remain uncovered, including obligations omitted from all receipts;
* violations found anywhere in the relevant verification scope, even without a receipt;
* stale/mismatched evidence dependencies and the specific additional evidence needed.

Supporting an individual receipt is not the same as closing the whole slice. Duplicate receipts do not increase coverage. Evidence for one proposition, target, snapshot or analysis scope cannot discharge a different one. A positive observation of prohibited behavior is a violation even when another receipt claims that behavior is absent.

For example:

```text
Handed-off O72: CompilationDiagnostics invokes SigilSemanticBridge
    + Receipt17 points to diagnostics.ts::compile
    + host resolves that symbol in the returned snapshot
    + TypeScript 7 resolves its call to the bound bridge implementation
    → O72 covered, with Receipt17 and the observed call as provenance

Handed-off O73: no relevant component uses the forbidden API
    + receipts mention no such API
    + analyzer cannot close the relevant effect scope
    → O73 unresolved, not proven
```

The verification result describes the declared slice and verification boundary:

* **GREEN:** every required implementation obligation and mandatory check is satisfied by sufficient current evidence, with no hard violation or unresolved required scope.
* **YELLOW:** required evidence, interpretation, receipt resolution needed for proof, or scope completeness remains unresolved. Unsupported behavior stays yellow even if the agent claims completion.
* **RED:** independent evidence establishes a violated prohibition, contradictory implementation property or failed mandatory check.
* **Invalid submission / operational failure:** malformed receipt protocol or failed tool execution is reported distinctly; neither can produce a green verdict. A test executing and failing is a check failure; a tool that could not run has not supplied a result.

Expose a navigable provenance chain:

```text
user intent → canonical fact → slice obligation
                                   ↓
                         receipt claim and code anchor
                                   ↓
                       independent source/test observation
                                   ↓
                        egglog rule and coverage result
```

Return the report and unresolved obligations to the caller. A coding agent may use them in its own repair loop, but Sigil does not generate or apply repairs, select code candidates, or orchestrate that loop.

## Final architecture

### Intent search

```text
human intent → LLM → Turtle candidate worlds → egglog
                                         → select / clarify / repair
                                         → GREEN SEMANTIC WORLD
```

### Implementation handoff and verification

```text
green world → versioned .egg slice + obligations + handoff manifest
          → optional Turtle export for the coding agent
          → external coding agent owns implementation
          → returned codebase + untrusted receipt claims
          → independent analysis, checks and scope certificates
          → fixed egglog receipt checking + coverage closure
          → scoped GREEN / YELLOW / RED report with witnesses
```

## Incremental compile artifacts in the target codebase

Keep durable compilation artifacts inside the target codebase's `.sigil` directory. Separate accepted meaning from submitted claims and recomputable operational state:

```text
.sigil/
  .gitignore                         # committed ignore policy
  config.json                        # committed workspace configuration
  implementation.json                # committed host verifier bindings/policy
  world/                             # COMMIT: accepted semantic state
    current.json                     # atomic pointer to an immutable revision
    <revision>/
      manifest.json                  # hashes, source identity, component bindings
      assertions.egg                 # sole canonical merged ASSERTIONS
  handoffs/<id>/                     # ignored: retained task/slice bundles
  receipts/<id>/                     # ignored: returned untrusted claim bundles
  runs/<id>/                         # ignored: reports, evidence and provenance
  cache/<id>/                        # ignored: completed stage artifacts
  cache/locks/                       # ignored: writer coordination
  cache/tmp/                         # ignored: unpublished temporary bundles
  beams/                             # ignored: intent-search checkpoints
```

**Commit the accepted `.egg` world and authoritative verifier policy.** They are part of the codebase's specification and should travel with branches, reviews and checkouts. No parallel canonical `.ttl` file is needed. Turtle can always be imported or exported through deterministic conversion. Closure results, observed code facts and receipt claims do not become accepted assertions merely because compilation derived or received them.

### Lossless canonical `.egg` assertions

The reason `.egg` can replace persisted Turtle is that it can encode the complete accepted fact model. It is not a claim that egglog is a higher-order superset of the Turtle serialization format. The persisted representation must preserve information that execution-oriented lowering may discard: normalized resource identities, literal lexical values, datatypes, language tags and stable fact identities. Anonymous resources must have stable normalized identities. Source/producer provenance stays in the manifest or sidecars.

Use a versioned restricted assertion vocabulary with fixed arities and literal arguments. An initial lossless encoding is:

```lisp
(assert-iri "urn:example:A" "https://sigil.dev/ontology/1#invokes" "urn:example:B")
(assert-literal "urn:example:A" "https://sigil.dev/ontology/1#label" "Bridge" "http://www.w3.org/2001/XMLSchema#string" "")
```

These are data forms in compiler-owned tables. Use egglog's real parser, then allow only the specified assertion forms and literal arguments. Reject rule definitions, schedules, includes, arbitrary expressions and attempts to populate trusted observation or satisfied-obligation tables. Loading a project `.egg` world must never execute arbitrary project-authored code. Revalidate the ontology and recompute fact/world fingerprints after parsing.

The execution representation can use smaller typed tables or discard irrelevant metadata for a particular analysis; that lowering is not automatically a lossless storage representation. Verify canonical `.egg` round trips across typed literals, language tags, anonymous identities, escaping and duplicate normalization. Check deterministic Turtle import/export against the same normalized fact identities.

Define losslessness over the normalized fact model, not the original Turtle bytes. Prefix choices, comments, whitespace, statement order and duplicate statements are not canonical meaning. Preserve distinct literal lexical forms even when a numeric analysis interprets them as the same value. Keep any original proposal text only as optional documentary provenance.

The storage contract must satisfy these acceptance conditions:

* Decoding an encoded normalized world restores the same facts, fact identities and world fingerprint.
* Encoding the restored world produces the same canonical assertion bytes under the same format version.
* Exporting Turtle and importing it again preserves that normalized world, without needing the original Turtle document.
* Removing optional Turtle exports and derived caches leaves accepted-world loading, slice derivation and recomputed semantic results unchanged under the same kernel and policy.
* A format or identity-normalization change has an explicit versioned migration. A kernel/rule/schedule change invalidates dependent closure and verification artifacts without silently rewriting accepted assertions.

Keep three artifacts distinct: committed accepted assertions, compiler-owned versioned rules, and ignored derived closure/evidence caches. Recompute closure from assertions under the actual current kernel identity, and invalidate dependent artifacts when that identity changes. Persisting only a saturated e-graph would lose the asserted/derived distinction and is not the chosen design.

The committed world directory contains immutable revisions selected by `current.json`. A revision covers metadata as well as assertions, so changing source bindings without changing the fact set still changes the revision identity. Readers resolve one published revision; they never combine files from partially written revisions. Previous accepted revisions remain available for handoffs and Git history. Existing `.sigil/semantic.json` plus `.sigil/worlds` state remains readable during migration; subsequent acceptance uses the new layout.

Handoffs retain the original task authority, while receipts store the agent's returned claims. Both are bundles that can be explicitly exported or transferred without committing them. Normalize syntactically valid receipt submissions into data-only `claims.egg` plus a location sidecar; retaining the submitted `claims.ttl` is optional. Using the same assertion encoding does not give receipts design authority or make them proof: bundle kind, retained handoff binding and host verification determine their role. Run bundles contain reports and documentary evidence. The layout creates directories and a scoped `.sigil/.gitignore` without overwriting existing ignore entries or ignoring accepted world state.

Every bundle has a versioned manifest with its kind, explicit dependency fingerprints, payload hashes and a content-derived identity. Dependencies identify the world/slice, source snapshot, receipts, kernel, analyzer/configuration and verifier policy as appropriate. Identical inputs and payloads reuse the same immutable artifact. Publish a fully written bundle atomically, then advance any current pointer with a revision comparison. Interrupted writes do not publish incomplete bundles, and a failed later stage does not erase completed earlier stages.

Record completed parsing/lowering/closure/evidence stages independently so work and provenance survive interruption. Changes invalidate artifacts whose declared dependencies changed; context-dependent analyses must include the complete relevant source inventory, imports, configuration and tool identities rather than just the referenced file. Whole-snapshot invalidation is the safe starting point where narrower dependencies are not yet established.

**A hash is an integrity/freshness check, not evidence authority.** Returned receipts and workspace caches are writable data. Reading a matching bundle must never populate trusted observation tables or restore an old green verdict on its own. Recompute semantic closure and independently establish the evidence required for current verification. Initial incremental storage reuses immutable input/representation artifacts and records completed work; skipping tool execution would additionally require a trustworthy result provenance mechanism and is not implied by cache presence.

Report artifact identities in compiler/CLI output so an agent can inspect the relevant completed stages, handoff, receipts and witnesses after compaction or interruption. Product artifacts belong in the target `.sigil`; this coding session's private progress tracker remains separate and uncommitted.

## Implementation plan for the revised flow

This plan replaces code-patch search and agent-loop work. Keep the existing intent-world search. Reuse the already implemented real Turtle parser, fixed egglog bridge, slice projection, native TypeScript 7 adapter, mechanical coverage rules, ownership-anchor resolver, compiler lifecycle and `semantic verify` command. The current collector provides useful observations; it does not yet implement the full handoff/receipt protocol below.

1. **Create incremental artifacts and version the handoff.** Implement the target `.sigil` bundle store, committed world revisions and ignored operational directories described above. Extend slice export with normalized fact/obligation identities, canonical `.egg` assertions with optional Turtle export, verification boundary and a fingerprinted manifest. Preserve the original world and host policy independently of the returned submission. Add round-trip and drift checks so obligations cannot change unnoticed between handoff and verification. Verify the storage acceptance conditions, including reconstruction and semantic compilation after removing all optional Turtle files and derived caches.

2. **Define and ingest receipts.** Specify the strict ordinary-Turtle receipt profile and location sidecar. Resolve references against the retained handoff, reject invented or conflicting identities, and resolve existing Sigil anchors with file/symbol/hash checks. Keep receipt claims in separate tables from accepted assertions and trusted evidence. Do not add arbitrary project rules or a general proof language.

3. **Verify the returned snapshot.** Extend the current TypeScript 7 collector to associate native observations with resolved receipt anchors while scanning the full required component boundary. Add bounded host compiler/test execution with input and output receipts. Freeze authoritative policy/test inputs, check snapshot consistency, and issue precise scope certificates only for supported analyses. Preserve partial observations and explicit unknowns.

4. **Implement receipt and coverage rules in egglog.** Add fixed relations for receipt targets, independently resolved locations, evidence scope and claim results. Match exact propositions and derive both per-receipt results and coverage over the complete handoff obligation set. Add supported composition rules deliberately; leave non-mechanical behavioral claims yellow. Ensure unclaimed violations, failed checks and contradictions dominate all claimed coverage.

5. **Integrate the handoff/return workflow.** Extend `semantic slice` to export the handoff bundle and `semantic verify` to consume the retained handoff, returned codebase and receipt bundle. Reuse this path for implementation-focused `compile`. Report scope, covered/uncovered obligations, receipt results, check outcomes and source/rule witnesses in JSON and readable output. Preserve cancellation, event delivery and diagnostic lifecycle behavior. Persist claims and evidence provenance when useful, but recompute proof for the current snapshot.

6. **Exercise the trust boundary end to end.** Verify a small real component handed to an external-agent fixture and returned with receipts. Cover a supported green implementation; omitted receipts without independent supporting evidence and opaque behavior remaining yellow; a prohibited call or failed required check turning red; stale world/slice/code identities; incorrect symbol anchors; duplicate or invented claims; forged passing evidence; changed protected oracles; and violations in relevant files absent from all receipts. Verify that replaying receipt Turtle alone cannot close coverage and that tool failures never fabricate a verdict.

7. **Finish migration and documentation.** Update architecture docs, CLI help, editor/skill workflows and packaging to describe slice handoff and returned-code verification. Remove code-candidate ranking, patch application and agent-loop orchestration from the planned product scope. Keep any in-progress utility only where it serves verification of one returned snapshot. Commit the work in these semantic groups and maintain the uncommitted operational progress record.

The first implementation milestone is one complete handoff → returned receipts → independent TypeScript 7 observations → egglog coverage report, with green, yellow and red cases. Broaden supported evidence and composed obligations only after that path is tested.

## Important architectural principles

Keep these boundaries hard:

**Lossless `.egg` stores accepted assertions. Turtle provides interchange. Compiler-owned egglog rules own laws and computation. LLMs propose possibilities.**

Do not put inference rules into generated Turtle.

Do not let generated per-project egglog replace a stable Sigil semantic kernel.

Do not use LLM confidence as a substitute for deterministic verification.

Do not generate multiple candidates when the semantic interpretation is obvious. Branch when ambiguity is consequential.

Do not silently promote derived facts into asserted facts. Preserve the distinction between what was explicitly established and what the reasoning engine derived.

Keep compiler/source-location metadata outside the semantic ontology unless there is an actual need to reason over that metadata.

Prefer deterministic transformations between representations wherever possible.

## Original first task: architecture inspection and vertical prototype

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
