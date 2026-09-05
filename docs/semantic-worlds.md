# Semantic worlds implementation

## Architecture inspection and migration plan

The language parser retains seven sections (`goal`, `interface`, `state`,
`logic`, `constraints`, `decisions`, `cases`), named concepts, prose units,
literal blocks, imports, and physical ranges. Resolution already collects
expansions, public concept identities, imports, and dependency boundaries.
`ownedImplementationTargetsFor` resolves `implements`, `uses`, and `tests`
comments to actual declarations and contract sections. These are reusable
structural observations, not proofs of the prose they reference.

The compiler currently resolves a workspace and covering boundary, executes a
structural stage, and calls `AgentAdapter.evaluate` for semantic readiness,
architecture, standards, and compatibility. Agent findings determine the report
color. Reports, history, cancellation, export, and event settlement are useful
host infrastructure; the evaluator pipeline and judge prompts must be replaced.
The four provider packages already own subprocess lifecycle and telemetry. They
should supply hypotheses, never authoritative quality judgments.

The initial vertical experiment uses the existing `SigilParser` contract in
`packages/core/src/parser.sigil`: parsing is owned by the parser, diagnostics
are delegated to `SigilDiagnostics`, and filesystem access is excluded. Turtle
interpretations are explicitly model proposals, with their source context kept
in a provenance sidecar. This experiment precedes changing ordinary compile.

## Representation and kernel

Use ordinary RDF 1.1 Turtle, parsed by N3 in Turtle mode. A versioned namespace,
`https://sigil.dev/ontology/1#`, declares the allowed classes and predicates.
Entities can be introduced freely; new vocabulary is rejected. Contract classes
correspond to the existing sections, with Component, Capability, Artifact,
Implementation, Evidence, Dependency, and Proposition for referenced entities.
Relations cover ownership, provision, requirements, dependencies, delegation,
exclusion, state, authority, trust, and evidence. Numeric properties carry
nonnegative costs, latency budgets, and risk. A relationship needing attributes
is a Dependency or contract entity, not an RDF triple term.

N3 terms are normalized and deduplicated. Blank nodes are document-scoped;
literal datatype and language remain intact. Source paths/ranges and producer
identity remain outside the ontology. Asserted Turtle is never overwritten by
closure. Candidate patches contain separate Turtle additions and retractions,
applied to parsed terms, with optimistic base fingerprints.

A small Rust subprocess embeds the real egglog library at a pinned upstream
revision. It accepts typed fact tables over JSON IPC (transport only), embeds
Sigil's fixed `.egg` kernel, saturates closure, and returns structured rows. It
accepts no generated programs or project-defined rules. This avoids a JavaScript
approximation of egglog and avoids parsing its human stdout. Build the cloned
upstream tooling separately when inspecting native behavior.

Closure derives availability, dependency reachability, exclusive-ownership
conflicts, capability/exclusion contradictions, obligations, and numeric path
costs. Diagnostics run after closure, using explicit finite obligation domains
and monotone satisfaction functions; absence is unresolved, not false. Witness
rows link derived identities to rule names and premise identities.

RED means a contradiction or hard violation. YELLOW means a consistent world
with unresolved required propositions or implementation evidence. GREEN means
the modeled required obligations are closed. Operational failure is never a
successful semantic result. Untranslated prose remains YELLOW; neither an anchor
nor an LLM's assertion that code is correct closes its obligation.

## Delivery sequence and completion evidence

1. Build and verify the vertical kernel: real parsing and egglog, derived facts,
   green/yellow/red examples, numerical closure, and ambiguity discrimination.
   Record results here before the broad compiler migration.
2. Add deterministic candidate pruning, lexicographic ranking, semantic diffs,
   information-seeking propositions, and a bounded resumable world beam.
3. Replace ordinary compilation with semantic closure while retaining target,
   diagnostics, report/export/history, and cancellation behavior. Preserve old
   APIs only where they cannot reinstate an LLM judge as the default compiler.
4. Project green worlds into existing `.sigil` syntax and focused implementation
   slices, including explicit obligations and provenance.
5. Add proposal adapters and implementation candidate execution in isolated
   workspaces; feed compiler/test/static/anchor observations into Turtle and
   verify coverage through the same kernel. Proposed evidence stays distinct
   from mechanically observed evidence.
6. Update CLI, editor/skill integration, packaging, documentation, and tests.
   Audit every phase and architectural invariant in `compile.md` against actual
   source and executed checks before declaring completion.

## Limits to preserve during implementation

The kernel establishes consequences of modeled facts, not truth of arbitrary
natural language. Translating prose requires a proposal and can expose
unresolved intent. Static call/dependency/filesystem analysis must state its
language and completeness scope; dynamic dispatch and untested behavior cannot
become proven negative facts. A passing test establishes its declared
observation, not every contract attached to its file. Candidate search must not
resolve consequential architectural differences merely by sorting identifiers.

## Vertical prototype results

`deno task test:semantic` builds the pinned Rust bridge and currently passes
eight tests with real egglog. `parser-green.ttl` derives the parser's diagnostic
capability through delegation, without inserting it into asserted RDF.
`parser-yellow.ttl` derives an unresolved required diagnostic capability.
`parser-red.ttl` derives a filesystem-exclusion violation. Both diagnostic
statuses include named rules and premise identities. Other cases demonstrate
transitive reachability, required state ownership, exclusive ownership, boolean
contradictions, latency-budget violations, minimum weighted path cost (5 versus
10), and maximum reachable risk (0.7). Input tests reject invented vocabulary,
named graphs, triple terms, malformed literals, and unsafe integers. Escaped
Turtle content cannot become executable egglog.

These fixtures were authored by the coding model from the existing parser
contract. They demonstrate selected architectural propositions, not automatic
translation or verification of every prose paragraph. At this checkpoint the
ordinary compile entrypoint is unchanged. Candidate search, normal compilation,
implementation evidence and projections remain subsequent delivery work.
