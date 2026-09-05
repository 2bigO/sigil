<!-- @sigil uses packages/compiler/_module.sigil::SigilCompiler::Compiler interface -->

# @qoherent/sigil-compiler

Sigil compiles asserted semantic worlds with a fixed egglog kernel. Ordinary RDF
1.1 Turtle stores facts; a real N3 parser validates and normalizes the versioned
Sigil vocabulary. The pinned native egglog engine derives consequences, numerical
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
locations and rule/premise witnesses. Canonical state is assertion-only Turtle,
with a source-bound atomic receipt; every compile recomputes closure.

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

`projectGreenSemanticWorld` returns paired canonical Turtle and a parser-validated
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
[CLI usage](../cli/README.md). Automatic implementation collectors, code candidate
execution, bundled proposal formats and native release packaging remain migration
work. Legacy evaluator APIs remain available to existing adapter packages, but
ordinary compilation never invokes them.
