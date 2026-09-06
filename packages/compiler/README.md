<!-- @sigil uses packages/compiler/_module.sigil::SigilCompiler::Compiler interface -->

# @qoherent/sigil-compiler

Sigil compiles asserted semantic worlds with a fixed egglog kernel. Ordinary RDF
1.1 Turtle provides interchange; a real N3 parser validates and normalizes the
versioned Sigil vocabulary. The pinned native egglog engine derives consequences, numerical
properties, invariants and explicit obligations. Models generate possibilities;
they do not supply compiler verdicts, rules, or trusted implementation evidence.

`compile` retains workspace/component/file/location selection, versioned events,
reports, export, source subjects and diagnostic history. Its required stages are
`deterministic-foundation`, `semantic-closure`, and `implementation-coverage`.
Legacy stage names alias the corresponding deterministic stage. Both built-in
profiles work without a model provider.

- Red: a contradiction or hard invariant violation.
- Yellow: required interpretation or implementation evidence remains unresolved.
- Green: the selected modeled obligations are closed.
- Operational failure: rejected invocation, with no fabricated semantic result.

Each existing source clause becomes a required contract and remains yellow until
its meaning is supplied as structured assertions. Diagnostics retain source
locations and rule/premise witnesses. Canonical state is lossless assertion-only egglog in `.sigil/world`,
with a source-bound atomic revision; every compile recomputes closure. Turtle
remains an import/export format. The native parser accepts only fixed assertion
forms and cannot execute project rules from a stored world.

`proposeSemanticIntent` records a new natural-language request as a protected
required contract, calls a `SemanticProposalProvider`, then uses deterministic
candidate search. `CommandSemanticProvider` implements a stdin-prompt/stdout-JSON
transport for generators in a disposable directory. A strict envelope contains
Turtle additions and retractions, never scores or findings. Applications may
implement the provider interface directly. Search prunes hard violations before
lexicographic ranking and keeps tied architectures in a resumable world beam.
Exact proposition answers filter the beam; optional model wording never replaces
the proposition itself. Named checkpoints use atomic revision checks and replay
assertions through the kernel rather than storing proof.

`projectGreenSemanticWorld` exports normalized Turtle paired with a parser-validated
human `.sigil` view. `implementationSlice` and `renderImplementationSlice` expose
focused duties, exclusions, contracts and obligations for coding agents. Positive
implementation coverage requires a host observation; negative obligations require
an explicitly complete observation scope. Model-proposed Evidence entities and
source anchors alone cannot close those obligations.

Build and test from the repository root:

```bash
deno task build:semantic
deno task test:compiler
```

Rust 1.91 or newer is required for the local native build. The native bridge accepts
only fixed typed tables and checks every output table before deriving status.
IPC is bounded, and timeout, cancellation or I/O failure kills and reaps the
engine. `tools.compile.budgets.elapsedTimeMs` caps execution. Source metadata stays
outside the ontology, and derived facts are never silently reasserted.

See [the architecture and migration record](../../docs/semantic-worlds.md) and
[CLI usage](../cli/README.md). Retained receipt verification and bundled
proposal formats use strict compiler-owned transports. Native release packaging
ships the pinned runtime separately from target projects. The external coding
agent owns implementation and repairs. Legacy evaluator APIs remain available
to existing adapter packages for compatibility, but ordinary compilation and
retained verification never invoke them.

Implementation analysis uses the pinned native TypeScript 7.0.2 API. Supply
`CompileOptions.implementationPolicy` or `.sigil/implementation.json` to select a
TypeScript project, exact component file inventories and semantic API bindings.
`collectImplementationEvidence` returns documentary Turtle, trusted observations,
typecheck results, existing ownership claims and source/hash receipts. Ordinary
implementation compilation feeds those observations to the same egglog kernel.
`sigil semantic verify` exposes the full evidence bundle for inspection.

A native type error is a failed mandatory check, even if every call obligation is
covered. Passing the typecheck proves only that check. Direct imports and resolved
call sites can establish `dependsOn`, `invokes` and `uses`; explicit API catalog
bindings can also classify `reads` or `writes`. These describe static code
relationships, not execution of every path. Negative dependency coverage requires
an exhaustive host inventory with no missing files, compiler errors, opaque calls
or unresolved imports. Other behavioral absence remains unresolved. Ownership
annotations remain claims and never become blanket implementation proof.

Completed semantic stages are recorded under `.sigil/cache/<id>` and result
reports under `.sigil/runs/<id>`. The report exposes these IDs in `artifacts`;
Markdown includes their workspace-relative paths. Each manifest binds payload
hashes to the world, relevant source, kernel and mechanical inputs. Completed
stages survive a later failure and identical stage artifacts reuse their IDs.
The stored report omits its own bundle ID to avoid a circular content hash.
Artifact data never restores trusted observations or skips verification.

`initializeCompileArtifacts` creates the layout and scoped Git ignore policy.
`writeCompileArtifact` and `readCompileArtifact` publish and integrity-check
versioned bundles, including untrusted receipt submissions. Retained handoffs and strict
receipt ingestion are available through `createImplementationHandoff`,
`readImplementationHandoff`, `writeReceiptSubmission` and `readReceiptSubmission`.
Handoff reads reparse assertions and recompute the complete boundary obligations;
`validateHandoffSnapshot` checks protected specification/configuration/oracle
fingerprints while allowing implementation changes. Raw receipt claims remain
separate from host observations. `resolveReceiptLocations` checks file hashes, frozen component inventories,
native callable selectors and optional exact ranges. The TypeScript snapshot
records each call's enclosing callable, separating sibling functions, nested
functions and anonymous callbacks. A located pointer alone proves no behavior.
Fixed egglog receipt-support joins and verification-command integration remain
the next implementation step.
