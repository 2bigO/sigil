# Semantic worlds implementation

## Architecture inspection and migration plan

The language parser retains seven sections (`goal`, `interface`, `state`,
`logic`, `constraints`, `decisions`, `cases`), named concepts, prose units,
literal blocks, imports, and physical ranges. Resolution already collects
expansions, public concept identities, imports, and dependency boundaries.
`ownedImplementationTargetsFor` resolves `implements`, `uses`, and `tests`
comments to actual declarations and contract sections. These are reusable
structural observations, not proofs of the prose they reference.

Before migration, the compiler resolved a workspace and covering boundary, executes a
structural stage, and called `AgentAdapter.evaluate` for semantic readiness,
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
5. Add proposal adapters and retained semantic-slice handoffs. An external coding
   agent returns code and untrusted receipt claims; independent compiler/test/static
   observations establish witnesses checked by the same kernel. Code-patch search,
   application and ownership of the coding agent's repair loop are out of scope.
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

## Candidate-search decisions

Candidate ranking measures satisfied obligations against the established intent
world. Counting every obligation introduced by each candidate would let a model
earn credit by adding easy requirements; the regression suite includes that
attack. Contradictions are pruned before comparing lexicographic objectives.
Established facts can be retracted only when the caller explicitly includes
their identities in the mutable intent scope. All patch applications check the
base fingerprint.

Tied architectures remain a beam. A binary semantic proposition with maximum
partition entropy identifies a precise intent difference; answering it filters
the beam and yields a Turtle delta. Wording-only differences do not create extra
worlds. Anonymous RDF entities are skolemized into document-scoped IRIs with
deterministic local identifiers, preserving identity across Turtle saves.
Sibling hypotheses share an ingestion scope while remaining isolated worlds.

Beam checkpoints store asserted Turtle and intent answers. On resume, the
compiler validates the base fingerprint and reruns egglog and ranking. Persisted
diagnostics or quality scores cannot establish correctness. Fifteen tests now
cover the vertical kernel, persistence identity, candidate pruning/ranking,
ambiguity resolution, patch integrity, and beam replay.

## Executable contracts and coverage

Required Goal, Interface, Logic, Constraint, Decision, Case, Contract, and
Proposition entities derive interpretation obligations. Their executable shape
uses `from`, a vocabulary-checked `relation` literal, `target`, and an
`expected` boolean. A positive proposition must follow from the world; a
negative one establishes a prohibition. Opposed required propositions are
contradictory even before either behavior is observed. Missing structure remains
YELLOW. There is no model-writable `interpreted` or verified-status property.

The same kernel derives implementation obligations for propositions,
capabilities, and exclusions. Specification facts cannot satisfy these
obligations. Host observations enter separate typed tables and carry evidence
identities. Positive obligations require a matching observation. Negative
obligations require an explicitly complete subject/predicate scope and no
contrary observation after closure. A matching prohibited observation is RED.
Generated Evidence entities with `passes true` remain untrusted assertions.

Nineteen tests exercise these boundaries. The native engine's observation input
is the trusted host boundary; concrete source analyzers and execution receipts
still need to be connected before the implementation-search workflow can claim
mechanical end-to-end verification.

## Source bridge and projections

`projectSigilIntent` reuses resolved component/expansion/import identities and
extracts every prose unit as a required Contract. Its source-binding sidecar
retains component, section, concept, physical range, and original literal
blocks. It deliberately does not guess executable predicates from prose. The
actual `SigilParser` file now exercises this bridge in a test: every prose unit
is represented and remains unresolved until interpreted.

Green worlds project to a human `.sigil` view with optional Turtle interchange and
an entity/component mapping. The existing parser and formatter validate the
generated view. Text containing braces, long tokens, or fences uses Sigil's
existing literal blocks, preserving the value without permitting source
injection. Lossless canonical `.egg` assertions retain complete semantic fidelity.

Implementation slices select one component's capabilities, delegation,
exclusions, dependencies, routing invariants, related contracts, and explicit
coverage obligations. They omit unrelated components and RDF syntax.
Projection and source-binding tests cover these properties alongside the kernel
and search behavior. Installing generated views and tracking their drift remain
integration work; ordinary compilation already uses the source bridge.

## Ordinary compiler migration

The default compile API and CLI now execute structural validation, semantic
closure, and implementation coverage without invoking an evaluator. Existing
target selection, events, reports, exports, source subjects, and diagnostic history
remain in use. Old stage names resolve to the deterministic stage dependency
closures. Legacy provider configuration is tolerated but contributes no verdict.
An unresolved or stale design leaves implementation coverage
`skipped-by-dependency`, with no implementation execution interval. The final
status remains yellow unless an error or failed execution makes it red.

A source prose unit becomes a required contract with a stable content identity.
This deliberately leaves arbitrary prose yellow until a proposal supplies its
structured meaning. Current source requirements are always retained when loading
proposals. Canonical assertions use an immutable `.egg` revision and an atomic
pointer bound to the source intent fingerprint; source edits invalidate old
interpretations. Every compile runs closure again. Component/source locations stay
in sidecars. Returned verification uses its independently retained assignment and
rejects protected input drift instead of changing the required work.

The native boundary now checks every fixed output table and cell before
interpreting absence as satisfaction. IPC is bounded at 16 MiB, stderr at 1 MiB;
failed I/O, timeout and cancellation kill and reap the single engine process.
Configured elapsed budgets cap native execution. Repeated identical source
contracts preserve every physical origin. Immutable snapshots are published before
the atomic head and are never rewritten merely to refresh a receipt. The compiler
suite passes 55 tests, including malformed protocols, process cleanup, custom
cancellation, budget exhaustion, and persistence failure paths on Linux.

## Intent generation and durable ambiguity

`proposeSemanticIntent` creates a required intent contract before calling a
`SemanticProposalProvider`. A no-op proposal therefore remains yellow. Providers
return a strict JSON transport envelope containing Turtle additions and
retractions; verdicts, scores, extra fields and generated vocabulary are rejected.
The generator is prompted to return one interpretation unless consequential
ambiguity warrants more. The deterministic search prunes and ranks the candidates.
An optional question-rendering call receives only the exact selected proposition
and its context; the machine proposition remains visible beside the wording.

`CommandSemanticProvider` uses a stdin-prompt/stdout-envelope executable protocol,
with Sigil's existing adapter process coordinator and a disposable working
directory. Applications can also implement the provider interface directly.
Named beam checkpoints persist only asserted Turtle deltas and answers under
`.sigil/beams`, with schema validation, atomic replacement and revision checks.
Replay runs the real kernel again. The 60-test compiler suite includes a real
command-provider exchange, durable yes/no selection, malformed envelopes and
checkpoints, protected new intent, and hard-conflict pruning. Built-in provider
CLI formats and user-facing intent commands are still integration work.

## CLI intent workflow

`sigil semantic intent/status/answer/accept/project/slice` now connects the proposal,
beam, persistence and projection APIs. A prepared candidate-envelope file or a
generator executable supplies hypotheses. Viable beams carry source and canonical
fingerprints; acceptance refreshes both receipts and requires a uniquely selected
green world. Answering uses the exact currently discriminating fact identity and
keeps the original candidate set for reproducible replay. Canonical acceptance
preserves existing source files. Projection prints a paired human Sigil/Turtle
artifact; installing generated views as new authoritative workspace files remains
separate work.

The integration passes 73 CLI tests and 60 compiler tests. An accepted interpretation
reaches green through ordinary design compilation, remains yellow in implementation
focus without mechanical evidence, produces a parser-valid human projection, and
returns a focused coding slice. Ambiguity, stale questions and source edits prevent
premature acceptance. Compiler cancellation codes retain CLI exit 130.

The kernel also rejects multi-valued contract endpoints and predicates, dependency
endpoints, and numeric properties. This closes a satisfaction-lattice loophole:
two propositions sharing one contract identity could previously close the same
obligation when only one matched. These are fixed egglog laws with premise
witnesses, including when assertions arrive in separate candidate patches. The
compiler suite passes 61 tests after this change.

## TypeScript 7 evidence boundary

The implementation analyzer pins TypeScript 7.0.2 and uses its shipped experimental
async API and AST decoder. It obtains native syntax/type diagnostics, resolved
imports and call declarations, distinguishes lexical shadows from global API
references, and records computed imports/access and unresolved calls as incomplete
analysis. Source content and effective compiler options identify the snapshot.
The adapter owns timeout, cancellation and native-process cleanup; the rest of
Sigil does not depend on the SDK's internal transport. Four native integration
tests pass, including resource sanitization on cancellation and timeout.

This uses TypeScript 7 as requested. The [TypeScript release guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
notes that the API is still evolving, so the exact version and adapter tests are
part of the compatibility boundary. Plain semantic compilation does not load the
Node-based analysis SDK. The analyzer requires environment permission because the
SDK spawns its native process through Node's child-process API.

The first implementation collector is now wired into ordinary compile and
`semantic verify`. Host-owned code bindings select exact component inventories,
module names, resolved declaration symbols and ambient global API paths. Native
TypeScript observations become ordinary documentary RDF plus separate trusted
observation/check inputs; code locations and hashes remain in sidecar receipts.
Existing core ownership anchors are exposed as claims without closing coverage.
The collector certifies absent direct dependencies only for an explicitly
exhaustive closed inventory. It leaves runtime behavior and API absence open.
A mandatory failed typecheck is red independently of positive call coverage.

Canonical persistence now uses lossless `.egg` assertions under
`.sigil/world/<revision>/assertions.egg`. Real egglog parsing permits only the fixed
assert-iri/assert-literal data forms; typed literals and language tags retain their
RDF identities, and Turtle is available as interchange. Project files cannot define
or execute rules. Content-addressed bundle manifests cover source and binding
metadata, and atomic heads compare the complete revision under OS file locks.
Legacy semantic.json/worlds state remains readable. Accepted world state and policy
are tracked; handoffs, receipts, runs and caches have scoped ignore rules. Native
responses include a fingerprint of the compiled kernel/bridge/dependency sources.


## Retained handoffs and receipt ingestion

A full implementation handoff now retains the accepted world and exact scoped
assertions in lossless `.egg`, with a versioned manifest recording every boundary
coverage obligation, its native kernel identity and contributing fact identities.
The caller retains the content-derived handoff ID independently of the external
coding agent. Loading the bundle reparses assertions and recomputes obligations;
unknown versions, changed kernels, fabricated obligations and altered protected
inventories are rejected. Baseline code is fingerprinted independently of the
expected implementation changes. Specification, configuration and host-selected
test-oracle changes prevent certification against that assignment.

`semantic slice` creates this handoff using host implementation policy.
`semantic receipts` validates ordinary Turtle claims and a strict location
sidecar against the retained obligation/fact set, then stores ignored untrusted
receipt artifacts. Successful ingestion does not establish implementation
coverage. Empty receipt submissions do not remove any required obligations.
A documentary `passes true` cannot populate trusted tool tables.

Native receipt-location resolution now checks exact source hashes, callable
selectors, optional ranges and frozen component ownership. TypeScript 7 indexes
native symbols and each call's actual enclosing callable; sibling and nested
functions cannot establish evidence for another receipt location. The handoff
records the extractor version alongside the native compiler identity. Fixed egglog
rules join these independently observed primitives with exact obligations.
Per-receipt outcomes remain distinct from coverage found independently elsewhere.

## Verify an external agent's returned implementation

Retain the original handoff identity before giving the coding agent the work.
Import its claims after it returns the code, then verify against that identity:

```sh
sigil semantic slice . --component Application
sigil semantic receipts . --handoff <saved-handoff-id> --claims <claims.ttl> --locations <locations.json>
sigil semantic verify . --handoff <saved-handoff-id> --receipts <imported-receipt-id>
sigil compile . --component Application --exact-target --focus implementation --handoff <saved-handoff-id> --receipts <imported-receipt-id> --format markdown
```

`--handoff-root` can locate the retained assignment in the original workspace when
the returned code is a separate checkout. Receipt bundles live in the returned
workspace. Omitting `--receipts` still verifies every obligation. Ordinary compile
requires its selected component identities to match the assignment and rejects
replacement semantic documents, verifier policy or injected proof tables.

The shared verifier validates protected inputs, analyzes the full host-owned
component inventory with TypeScript 7, resolves receipt pointers and executes
mandatory host commands. Each command receives a fresh disposable snapshot;
modifying existing input bytes, file kinds or executable modes invalidates its
result. Actual nonzero exit codes are failed checks. Cancellation, timeout,
launch failure and output-limit failure return no completed verdict. Native input
hashes and the returned snapshot are checked again after tool execution.

Current-world `semantic verify` and ordinary compile use the same snapshot-bound
evidence collection and execute declared host checks even without `--handoff`.
They also reject canonical revision changes during verification. API policy
objects are cloned before execution so caller mutations cannot change a running
check's requirements. Accepted handoffs continue to impose their additional
original-assignment and protected-oracle checks.

One elapsed deadline spans each verification and its sequential checks. Ordinary
compile supplies the remaining overall profile budget; standalone verification
defaults to 120 seconds and exposes a total `timeoutMs` API option. Individual
engine and command limits can shorten that budget. Expiry cancels active tools
and awaits cleanup without returning a verdict. Completed native extraction and
individual checks retain separate ignored artifacts even when a later check or
freshness validation fails.

Fixed egglog rules report supported, contradicted or unresolved claims separately
from covered, violated or unresolved obligations. A wrong-function receipt can
remain unresolved while independent coverage is green. An observed prohibition,
failed mandatory check or complete analysis proving a required relation absent
is red. Incomplete scope stays yellow. Passing a host command proves that check;
it does not automatically prove arbitrary behavior.

Both commands expose scope, snapshot identity, obligations, claim outcomes and
check results. `semantic verify --format markdown` and ordinary compile share a
readable projection. Detailed runs retain source and rule witnesses in ignored
`.sigil/runs` and `.sigil/cache` bundles. Reading these bundles never restores
trusted evidence. Accepted-world reconstruction and semantic closure work after
optional Turtle files and derived caches are removed.

The current snapshot copier excludes generated directories and `node_modules`.
Checks that need installed local dependencies require further dependency staging;
the disposable copy is filesystem work isolation, not an operating-system sandbox.
Broader behavioral proofs, installed projections, provider migration and release
packaging remain unfinished.
