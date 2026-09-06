
# Task: Radically simplify Sigil around independent Semantic Worlds verification

The goal of this refactor is a **large net deletion of code and concepts**.

Backward compatibility and migration are explicitly out of scope. Sigil has no external users yet. Prefer deleting obsolete systems and restoring known-good pre-semantic-compiler code over preserving transitional abstractions.

Use commit:

`08c22e0a088407f94b1dd6999c044334b0190552`

as the known-good reference point for the old whole-spec coding-agent handoff and related flows. When current files were changed only to support semantic compiler architecture that this plan removes, prefer restoring the relevant implementation from that commit instead of rewriting equivalent behavior. Removing parts of older implementation prior to that commit is also okay, e.g. needing to configure harnesses may become completely obsolote and that whole code can be removed if so.

Do not mechanically reset unrelated improvements.

## Codebase findings informing this plan

Reviewed against the working tree on 2026-09-06. This document describes the
target refactor; the existing authored contracts still describe the previous
architecture and must be updated during implementation.

| Area | Actual implementation | Consequence for this refactor |
| --- | --- | --- |
| Native engine | `packages/compiler/native/src/main.rs` is a JSON-stdin bridge around egglog, named `sigil-semantic-engine` in `Cargo.toml`. | A standalone `sigilc` needs command parsing, RDF ingestion, source identity, projection storage, and comparison; renaming alone does not implement it. |
| Language frontend | `packages/core/src/resolver.ts` owns imports, module reexports, expands, and public Concept identities. | Preserve this implementation and its tests. Explicitly define the frontend-to-Rust boundary instead of quietly duplicating the parser/resolver. |
| Structural Design | `packages/compiler/src/semantic/source.ts::projectSigilIntent` already creates component identities and required interpretation units from prose and literal blocks. | Retain this coverage principle. A model must not omit a difficult contract and thereby make Design green. Partition units by physical source, including expands. |
| RDF and assertion files | `semantic/turtle.ts`, `ontology.ts`, and `egg-world.ts` implement validation and serialization in TypeScript. Native `main.rs` restricts assertion ASTs to `assert-iri` and `assert-literal` with string arguments. | Port the relevant behavior and fixtures to Rust; retain the restricted data reader. Never execute cached `.egg` as arbitrary egglog programs. |
| Kernel | `native/src/kernel.egg` already implements reachability, delegated capabilities, required interpretation, contradictory propositions, minimum distance, and maximum risk. `schedule.egg` stages closure, evidence, and diagnostics. | Reuse suitable laws, but split Design and Implementation execution and remove receipt-specific rules. Missing-row diagnostics must run after closure. |
| Current verification | `semantic/typescript7.ts`, `verification.ts`, `verify-return.ts`, `implementation-workspace.ts`, `handoff.ts`, and `receipt*.ts` implement the architecture being replaced. | Delete their obsolete callers, protocols, config, tests, and release dependencies together. |
| Current persistence | `semantic/store.ts`, `views.ts`, `projections.ts`, `beam*.ts`, and `artifacts.ts` support accepted worlds, managed views, and retained workflows. | Disposable worlds change authority as well as storage. Remove generated-view authoring and accepted-world workflows across CLI, editor, docs, and skills. |
| Historical baseline | The referenced commit has implementation coverage/retrieval and ownership-comment guidance in `integrations/skills/sigil/`, plus evaluator adapters. Inspection did not identify a dedicated whole-spec coding-agent launcher. | Restore useful behavior selectively. Whole-spec delivery is a harness requirement; do not promise a simple restoration of a launcher or restore the old evaluator architecture wholesale. |
| Snapdir | `repos/snapdir/crates/snapdir-core` at `5fef1d97e0cbf073fb5b443f8e7e26d147625e98` exposes `walk`, `WalkOptions`, `Manifest`, `Blake3Hasher`, and `HashFile`. | Use these APIs, subject to the identity, filtering, and portability details in section 10. `repos/` is ignored and is not a distributable dependency path. |
| Egglog reference | `repos/egglog` is at `90635860397ce710f8c0a4eeb04154a8ebc3ac05`, the same revision pinned by the native crate. | `egg.md` applies to this checkout. Its relative source links resolve under `repos/egglog/`. No egglog upgrade is needed for this refactor. |
| Distribution | `scripts/build-cli-release.ts` ships the bridge and TypeScript analyzer, including a Windows target. | Update runtime lookup, release staging, installers, and smoke tests. Snapdir's current walker imports `std::os::unix` unconditionally; Windows needs an explicit portability solution. |

Baseline inspection: `sigil check . --format json` reported zero errors,
one warning and eleven informational diagnostics. Both `semantic status` and
`semantic project --check` failed with “Turtle document exceeds 1,000,000
characters.” This is an existing inspection limitation, not evidence of a green
accepted world. Per-file ingestion needs separate per-document and aggregate
limits so assembling a large workspace does not recreate that failure.

## Correctness decisions

1. Implementation freshness binds only the target source, ontology/schema and
   projection format, and frozen Design
   catalog. Design separately binds its resolved import/frontend inputs.
   Neither side binds the process that produced Turtle.
2. Missing behavior is unknown. Removing mechanical completeness evidence does
   not make absence a negative fact. Unsupported negative obligations remain
   `Converged`; section 27 defines the initial conservative policy.
3. All required authored units must be inventoried independently of model output.
   All selected source files must be inventoried independently of coder triggers.
4. Current `Loose` Design permits a provisional frozen catalog and implementation
   work. `Disjoint` Design permits neither a coding catalog nor implementation
   comparison. `Closed` requires `Coherent` Design, fresh complete selected
   inputs, completed closure, and satisfied implementation obligations. An operational failure has
   no completed semantic verdict.
5. Determinism starts at fixed validated assertions. A new model reconstruction
   of unchanged source can differ; deleting the cache is safe but is not a promise
   of identical model output.

## Refactor assessment and size estimate

The architecture is ready to implement as a bounded refactor, not as a claim
that semantic reconstruction will be complete. Its strengths are the two
separate worlds, local Implementation objects, explicit unknowns, and removal
of orchestration. The principal remaining risk is implementation scope leaking
back through adapters, runtime packaging, or generic compiler infrastructure.

Keep the platform feasibility check early:

* Snapdir's Unix-specific filesystem code is a real packaging constraint.
  Verify the required surface on retained platforms before building on it.
  Limit changes to the necessary library surface; a broad snapdir port/fork is
  outside this refactor. If the bounded approach cannot preserve the release
  matrix, report that concrete blocker rather than silently expanding scope or
  removing a platform.

Expect many real projects with prohibitions or dynamic wiring to remain
`Converged`. That is the intended conservative result, not an acceptance failure
to solve by adding whole-program analysis or negative-proof infrastructure.
Structural unit coverage does not prove faithful interpretation of every sentence.
Implementation name-to-catalog mapping is also model judgment, not a compiler
guarantee. Ambiguous local references remain unknown. Do not add a language
resolver to improve that mapping or force a green result.

Current-code audit: the proposed Implementation identity-table mechanism has
not been implemented. The current native binary is still
`sigil-semantic-engine`; TS7 symbol analysis serves the old mechanical verifier.
Delete that verifier during the refactor, with no exception for supplying
Implementation mappings. No new symbol-map schema or resolver subsystem needs
to be retained from the proposal.

Measured from tracked working-tree `.ts`, `.tsx`, `.js`, `.mjs`, `.rs`, and `.egg`
files on 2026-09-06, counting physical lines including comments and blanks:

| Current area | Lines |
| --- | ---: |
| Compiler semantic TypeScript source | 9,517 |
| Other compiler TypeScript source | 6,508 |
| Native Rust/egglog engine | 607 |
| Four provider-adapter packages, source | 1,513 |
| Compiler and adapter tests | 6,515 |
| Compiler/adapter subtotal | 24,660 |
| Entire repository, same tracked code extensions | 58,609 |

The repository total comprises 39,631 production/tooling lines and 18,978 lines
under test/fixture/eval directories. This excludes `.sigil` contracts, Markdown,
JSON, lockfiles, ignored `repos/`, and other extensions; it is a reproducible
size baseline, not a count of executable statements.

Planning estimate: **10,000–16,000 net code/test lines removed**, about **17–27%**
of that repository baseline. Approximately 7,000–11,000 of the reduction should
be production/tooling lines; the rest comes from replacing obsolete tests.
The compiler/adapter footprint should shrink roughly 40–60%, with some extra
deletion in CLI/config/release callers. These are estimates, not additive quotas.

The estimate assumes roughly 18,000–23,000 old lines disappear or are replaced
across affected source/tests/callers, offset by roughly 7,000–11,000 lines of
Rust, thin frontend integration, and new tests. Those independent ranges are
uncertain; the net range above is a central planning expectation, not a bound.
A larger platform effort or richer diagnostics could lower the reduction.
Do not count moved native code, dependency code, or avoided unwritten features as
deletions. Preserve useful language tooling and correctness tests regardless of
the estimate.

---

# 1. Final conceptual architecture

Sigil has two real sources of truth:

```text
DESIGN SOURCE OF TRUTH
*.sigil files

IMPLEMENTATION SOURCE OF TRUTH
actual source code
```

Semantic worlds are **derived, disposable projections**:

```text
.sigil source
     ↓ semantic reconstruction
Design graph D

source code
     ↓ independent semantic reconstruction
Implementation graph I
```

Both are stored as data-only `.egg` assertions under `.sigil/worlds/`.

The semantic compiler performs:

```text
D* = saturate(D)
I* = saturate(I)

O = obligations(D*)

compare O against I*
```

Where **saturate** means:

> Repeatedly apply Sigil's compiler-owned egglog laws until no new semantic facts, consequences, obligations, violations, numerical properties, or other derived relations can be produced.

This is the central Semantic Worlds model:

```text
sparse asserted graph
        ↓
fixed semantic laws
        ↓
richer graph
```

Examples:

```text
A dependsOn B
B dependsOn C
→ A reachable C
```

```text
A requires X
→ obligation that X be available to A
```

```text
A excludes X
A uses X
→ violation
```

```text
A → B cost 4
B → C cost 6
→ distance(A,C) = 10
```

LLMs propose semantic facts.

The compiler owns semantic laws.

---

# 2. Compiler and harness are completely separate

Keep the TypeScript `sigil` CLI and the existing TypeScript language frontend.
Create the standalone Rust crate/binary at `packages/sigilc`, named `sigilc`.
Move useful native implementation from `packages/compiler/native` into that
crate, then delete the old `sigil-semantic-engine` binary, its JSON bridge
protocol, and its obsolete TypeScript wrappers. There is no permanent third
binary and no compatibility bridge.

The current bridge is useful as implementation material, not as an enduring
interface. Preserve its egglog embedding, restricted assertion AST reader,
correct string escaping, useful kernel laws, and actual-runtime fingerprint
checks. Replace receipt/observation inputs and output tables with the new
Design/Implementation interfaces. JSON remains appropriate for machine-readable
commands; that does not require retaining the old JSON protocol.

Use this ownership boundary:

| Owner | Responsibilities |
| --- | --- |
| TypeScript `sigil` / `packages/core` | Workspace/config discovery, parsing, imports, expands, Concept/glossary resolution, authored-unit inventory, deterministic export context, formatting, retrieval, LSP/editor integration. A thin compile command may prepare frontend inputs and invoke `sigilc`. |
| Rust `sigilc` | Snapdir-backed input identity, immutable input preparation support, Turtle validation, assertion encoding, projection metadata/publication, catalog freezing, isolated egglog closure, comparison, freshness, and deterministic reports. |
| External harness / coding environment (outside this repository's implementation scope) | Whole-spec coding context, model calls, reconstruction isolation, scheduling, retries, and implementation/repair work. |

The frontend emits a small versioned resolved Design input bundle containing only
structural information Rust cannot recover without understanding Sigil syntax:

* selected source files and exact source bytes/identities;
* parser/resolution diagnostics and resolved imports/reexports;
* canonical Component/System/Concept identities supported by language resolution;
* ownership/source bindings needed for those identities;
* the required authored interpretation-unit inventory;
* public/exported identity and authored context needed by importers;
* relevant glossary/config inputs that affect interpretation.

Bind the bundle to the exact source/config/glossary bytes and frontend version.
`sigilc` validates its schema and input fingerprints. These structural records
are compiler-frontend output, never model-authored Turtle or trusted model claims.

Hard architectural rule: **If a field can be deterministically derived by
`sigilc` from normalized semantic assertions or belongs to Sigil's semantic laws,
it does not belong in the frontend bundle.**

Exclude semantic closure, derived facts, egglog obligations, implementation
requirements/results, inference results, semantic validation laws, candidate
ranking, and Design-vs-Implementation comparison logic. The authored-unit
inventory identifies source that needs interpretation; Rust derives obligations
from it under fixed laws. Do not send precomputed obligations from TypeScript.
Use a closed schema that rejects unknown fields. Keep it easy to replace/delete;
do not grow a shadow AST, second compiler IR, extension framework, or rule
transport. Do not port the full TypeScript compiler or duplicate its parser and
resolver in Rust.

Define the bundle as an explicit input to `sigilc` preparation/Design operations.
Rust can operate directly on prepared inputs without invoking TypeScript or a
model. User-facing `sigil compile` can prepare the bundle automatically using
the existing frontend. Do not advertise `sigilc` as a second parser for arbitrary
`.sigil` text. Reusing the TypeScript frontend is the deliberate language/compiler
boundary, not an unfinished Rust port.

`sigilc` is the single owner of content hashing and artifact freshness. The
frontend passes the exact source buffers it parsed to preparation; a source edit
between frontend reading and preparation invalidates that attempt. Retain only
the transport needed to invoke these new Rust commands and decode their results.
Do not port all of `packages/compiler` to Rust merely because it has that name.

The surrounding skill/harness treats `sigilc` like any other command-line tool.

**`sigilc` validates semantic assertions, not their author. It binds a projection
to the source world it describes, not to the process that produced it.**

Model, provider, prompt, conversation, temperature, producer, agent identity,
and semanticizer recipe are not compiler freshness or provenance fields. Do not
persist them in projection metadata or require them in preparation/ingestion.
An improved external model or prompt does not invalidate valid projections.
An external caller may explicitly reconstruct unchanged inputs and submit new
Turtle under the same semantic input identity and atomic-publication rules.

## Hard boundary

`sigilc` must not know how to invoke:

* Claude
* Codex
* OpenCode
* Pi
* any other model
* any agent harness

It must not:

* select models
* start agents
* manage conversations
* perform model fallback
* schedule semanticization agents
* schedule coding agents
* own prompt retry loops
* own implementation/repair loops

Conceptually:

```text
external harness / coding environment
        │
        ▼
prepared semanticization inputs
        │
        ▼
model produces Turtle
        │
        ▼
      sigilc
        │
        │ deterministic
        ▼
validated semantic world
        ↓
egglog closure / comparison
```

Model orchestration remains outside Sigil, not merely outside `sigilc`.

This refactor does not implement a generic harness adapter, independent
semanticizer launcher, whole-spec coding workflow, background-agent runtime,
model scheduler, provider abstraction, evaluator framework, or orchestration
layer anywhere in the repository. Document the external protocol and keep
lightweight skill instructions where useful. Implement only deterministic
preparation/ingestion and compiler behavior at that boundary.

Sections describing agents, concurrency, isolation, and retries specify external
environment responsibilities; they are not Sigil implementation milestones.
Fixed Turtle fixtures or simple test doubles exercise the model boundary in CI.
No live agents or repository-owned orchestration are needed for acceptance.

Delete provider/orchestration machinery whose only purpose was allowing the semantic compiler itself to invoke models.

---

# 3. Restore whole-spec coding

This section specifies guidance for external coding environments. Implementing
the delivery workflow or a coding-agent launcher is out of scope for Sigil.

Restore the implementation handoff behavior used around:

`08c22e0a088407f94b1dd6999c044334b0190552`

The coding agent receives the **whole human-readable Sigil specification**.

Do not hand it:

* one component at a time
* one contract at a time
* semantic slices
* obligation bundles
* RDF fragments
* verifier work packets
* receipt protocols

We have empirically found that coding agents implement better when they can reason globally over the complete specification.

Reuse known-green old code where appropriate.

The coding agent owns:

```text
implementation
repair
refactoring
its own work sequencing
```

Sigil does not own:

```text
code candidate generation
code candidate ranking
patch merging
repair orchestration
coding-agent scheduling
```

---

# 4. Pointer comments may remain, but they are not evidence

Restore or retain lightweight comments identifying which Sigil component/section/contract a code entry corresponds to.

These are for:

* navigation
* debugging
* editor integration
* helping the coding agent maintain context

They are **not implementation proof**.

The independent semantic reconstruction pass must not trust or derive facts merely from these comments.

Keep the captured target bytes exact. The worker instructions explicitly exclude
pointer comments as evidence; do not introduce a source-rewriting/sanitizer
identity into compiler freshness.

---

# 5. Independent implementation semanticization runs alongside coding

The following is an external protocol, not a repository-owned background runtime.

This is the key verification design.

The coding agent does **not** author Implementation Turtle itself.

Instead, when the coding agent judges that a coherent piece of code is finalized, it triggers an **independent background semanticization agent** and immediately continues its own work.

The reconstruction result is none of the coding agent's concern.

Conceptually:

```text
CODING AGENT
    │
    │ "src/foo.ts is ready for semanticization"
    ▼
HARNESS
    │
    ├── captures exact current source snapshot
    ├── identifies the target source file
    ├── supplies fixed Sigil ontology
    ├── supplies frozen Design entity catalog
    ├── supplies only the exact target implementation file bytes
    └── launches independent semanticizer
                │
                ▼
        Implementation Turtle
                │
                ▼
             sigilc
                │
        validate + normalize
                │
                ▼
 .sigil/worlds/implementation/src/foo.ts.egg
```

Meanwhile:

```text
coding agent → continues implementing other work
```

The coding agent must not see or influence the reconstruction result.

Treat this as an enforced harness boundary: use a separate conversation and an
isolated read-only set of the three inputs in section 6, with results outside the coder's readable
workspace while coding is active. A prompt instruction or ordinary read-only
access to the same checkout does not hide `.sigil`, `.sigil/worlds`, `AGENTS.md`,
Git history, or design copied into documentation. Do not fork the coding
conversation into the semanticizer. Disable unrelated filesystem, shell, and
network access in that worker.

The `semanticize` response acknowledges job scheduling only. The final report
can go to the human or a later repair session; that ends the current blind
evaluation. A later repair gets a new independent reconstruction. This boundary
reduces answer leakage; code names, comments, and catalog labels can still convey
intent, so it is not a guarantee of unbiased observation.

---

# 6. Independent semanticizer context

The implementation reconstruction agent receives:

1. the exact target source file bytes
2. Sigil's fixed ontology
3. the frozen Design entity catalog

It must **not** receive:

* `.sigil` source
* Design Turtle
* D
* D*
* Design obligations
* intended relationships
* coding-agent explanations of what should be implemented
* previous implementation semantic results
* receipt claims
* neighboring implementation files, imported module bodies, or repository browsing access

Its job is only:

> Describe only semantic relationships directly evidenced by this source file.
> You are given this file, Sigil's fixed ontology, and the frozen Design catalog.
> Use your knowledge of the local programming language, including import/export
> and module syntax, to map local names or external references onto catalog
> entities. Name similarity is supporting evidence only, never sufficient
> evidence by itself. Map only when usage and context in this source file make
> the identity semantically credible. Do not map by lexical similarity alone.
> Refer only to entities already in that catalog. Do not invent aliases,
> substitute names, or new semantic entities. Do not inspect neighboring files
> or infer or summarize the behavior of imported modules. If this file clearly
> imports or references a known Design entity, use its canonical identity. If
> the mapping is ambiguous from this file alone, omit the relation rather than
> guessing. Emit only direct facts attributable to this file. Cross-file and
> transitive consequences are computed later by sigilc/egglog.

This is a hard semantic boundary, not an optional context optimization.

The coding agent writes code from Design.

The semanticizer independently reconstructs Implementation.

Those are separate model calls with different information.

---

# 7. Implementation projections are local semantic object files

Use strictly one Implementation source file → one mirrored `.egg`:

```text
src/foo.ts
→ .sigil/worlds/implementation/src/foo.ts.egg
```

Each semantic object describes only direct facts attributable to its source.
For `a.ts` importing `compile` from `b.ts` and calling it from `run`, A may assert
`A invokes B` and `A provides Run`. It must not assert `A invokes InstalledSigil`
merely because B calls InstalledSigil. That direct fact belongs to `b.ts.egg`.
Only compiler-owned laws may derive further consequences after linking.

The model understands the local programming language. The frozen Design catalog
supplies the shared semantic identities. For example:

```ts
import { Foo as Bar } from "./foo";
export function run() {
  Bar.compile();
}
```

If the catalog contains canonical Foo and this file justifies the mapping, the
model may emit a direct relationship to Foo. It must not invent a Bar semantic
entity or inspect `foo.ts` to learn what Foo does. Name similarity alone is never
sufficient; source usage/context must make the mapping semantically credible.
Omit an uncertain relationship.

There is no compiler/host-generated Implementation identity table, symbol map,
module resolver output, resolver callback, resolution cache, or language plugin.
Do not substitute another abstraction or preserve TS7 machinery for this purpose.
The identical three-input protocol applies to TypeScript, JavaScript, Python,
Rust, Go, Java, C/C++, shell, mixed-language repositories and other languages.
Neither `sigil` nor `sigilc` resolves Implementation programming-language symbols.

```text
source files → independently semanticized local .egg objects
            → union/link using shared identities → I → saturate → I*

a.ts.egg: A dependsOn B
b.ts.egg: B dependsOn C
I*:       A reachable C
```

Reflection, dynamic imports, dependency injection, plugin registries,
configuration-driven wiring, monkey patching, global registration, generated
code, and runtime lookup by string may hide relationships from this boundary.
Do not sacrifice simple local objects for fuzzy whole-program LLM analysis.
Relationships unsupported by local bytes plus the frozen catalog remain unknown;
unestablished obligations produce `Converged`, not fabricated certainty.

This restriction is Implementation-specific. Design retains Sigil frontend
context and conservative transitive importer invalidation from section 14.

---

# 8. Snapshot binding prevents races

Because the coding agent continues working while reconstruction runs, every semanticization job must be bound to the exact source snapshot it read.

Use `snapdir-core` inside `sigilc` for deterministic source hashing and manifests.
External environments consume its deterministic preparation results.

At semanticization start:

```text
foo.ts hash = H1
```

The independent agent reconstructs H1.

Capture immutable target bytes, fixed ontology/schema, projection format, and
frozen Design catalog. Hash the copied
source bytes; do not substitute a live checkout after hashing. No neighboring
implementation bodies or arbitrary repository-context snapshot are involved.

Use deterministic versioned encoding of the complete Implementation input key:

```text
hash(target normalized path + source bytes,
     ontology/schema version,
     projection-format version,
     frozen Design entity-catalog fingerprint)
```

Before publication, compare each of those inputs with its current counterpart.
Any change to another Implementation source file leaves this projection fresh,
including changes to that neighbor's imports, exports, or implementation. That
file's own semantic object must be refreshed. Only this target's path/bytes,
the frozen Design catalog, or incompatible ontology/schema/projection format
changes invalidate this projection. There is no Implementation dependency graph.
Selection controls world membership and report scope, not the reusable per-file
projection key. An unrelated selected-source change may change the assembled
world and comparison result without invalidating this projection.

If yes:

```text
publish foo.ts.egg
```

If the coder edited the file meanwhile and it is now H2:

```text
discard or mark result stale
```

Never publish semantic results for an outdated source snapshot as current.

Design uses its own deterministic key: target Design source identity, resolved
import/export identity context and source dependencies, relevant frontend
structural/config/glossary input identity, ontology/schema and projection-format
versions. Preserve conservative Design importer invalidation. Neither key contains
LLM-production metadata.

Under a writer lock, compare the expected projection generation, publish assertions and
metadata, then commit their index entry atomically. Older duplicate jobs must not
overwrite a newer accepted result for the same inputs. The lock serializes
compiler writers; it cannot prevent the coding agent from editing source.
Therefore compile validates freshness again and labels every report with its
captured input identity. A report never claims to describe an indefinitely live
working tree.

---

# 9. Semantic worlds are disposable projections

Use this layout:

```text
.sigil/
  worlds/
    design/
      _module.sigil.egg
      folder/
        file.sigil.egg

    implementation/
      __init__.py.egg
      folder/
        another_file.py.egg
```

Mirror source paths and append `.egg`.

Examples:

```text
_module.sigil
→ .sigil/worlds/design/_module.sigil.egg

architecture/foo.sigil
→ .sigil/worlds/design/architecture/foo.sigil.egg

src/__init__.py
→ .sigil/worlds/implementation/src/__init__.py.egg

src/client.ts
→ .sigil/worlds/implementation/src/client.ts.egg
```

Retain original source extensions to avoid collisions in heterogeneous repositories.

Keep a small disposable `worlds/index.json` alongside the mirrored assertions.
An Implementation entry contains only:

```text
side = implementation
normalized source path
source checksum
ontology/schema version
projection-format version
Design entity-catalog fingerprint
assertion checksum
minimal index/publication generation metadata
```

Design entries retain resolved Design import/frontend source dependencies and
authored-unit coverage instead of the Implementation catalog field.
Keep source attribution outside the domain ontology. No model, provider, prompt,
temperature, conversation ID, producer, agent identity, or equivalent production
metadata belongs in the index. No arbitrary Implementation context manifest or
semanticizer read dependencies, neighbor hashes, symbol maps, resolver versions,
or other language-resolution metadata belong there either. Source binding and publication
metadata are not a coding receipt protocol.

Readers use only entries whose assertion hash and full input binding validate.
An interrupted assertion/index update must be rejected as incomplete, never
accepted using mismatched metadata. Use a temporary file and atomic replacement
under the writer lock; a crash may require regeneration, which is acceptable for
a disposable cache. Assembly follows the index, not a recursive union of every
`.egg` found on disk. Corrupt, stale, deleted, and unindexed files contribute no
current facts.

## Git policy

Ignore:

```text
.sigil/worlds/
```

These are cache/build artifacts.

Sources of truth remain:

```text
*.sigil      → Design
source code  → Implementation
```

Deleting `.sigil/worlds/` must always be safe.

A fresh checkout can reconstruct it.

Delete the architecture where generated `.egg` assertions were committed as canonical meaning.

No migration is required.

---

# 10. Use snapdir-core for source identity and incremental invalidation

Do not invent another filesystem hashing system.

Add Rust dependency on `snapdir-core`.

Use its directory walking / manifest / BLAKE3 machinery for deterministic source identity.

Do not shell out to Git.

Do not assume the repository uses Git.

For selected source scope track at least:

```text
relative path
file type
BLAKE3 checksum
size where useful
```

Use normalized path + content checksum to decide freshness.

File permission-only changes do not need to invalidate semantic projections unless existing Sigil semantics require them.

Concrete integration details from the checkout:

* `snapdir_core::walk(root, &options, &Blake3Hasher)` supplies sorted manifest
  entries; `hash_file::HashFile` also exposes per-file hashing. Reuse the library
  for content hashes and directory discovery. Do not adopt its backup/catalog,
  cloud-store, or SSH layers.
* `directory_checksum` sorts and deduplicates child checksums without names. It
  is not a source-tree identity: rename and duplicate-file changes can preserve
  it. `snapshot_id` hashes full manifest text, including permissions. Retain that
  raw identity if useful, but derive Sigil's semantic input key from a versioned,
  unambiguous encoding of selected `(path, type, checksum)` rows using the same
  BLAKE3 implementation. This is application identity, not another file hasher.
* Snapdir excludes are regex matches on absolute paths, not Sigil globs. Define
  Sigil selection once, normalize to workspace-relative paths, and apply its
  documented glob rules; do not pass globs directly to `ExcludeMatcher`.
* Set `FollowMode::NoFollow` explicitly. Snapdir otherwise follows symlinks;
  no-follow drops them entirely. Diagnose explicitly selected symlinks and
  unsupported special files rather than silently claiming they were analyzed.
  Reject escaping paths and symlinked artifact parents. Keep object-store hash
  recovery disabled for source identity.
* The local dependency path is useful for a development spike only. Pin a
  distributable Git revision or a verified published version in the final
  manifest and lockfile. Snapdir's workspace requires Rust 1.91.1; Sigil currently
  declares 1.91. Align the declared MSRV and build environment.
* Preserve existing release platforms. First isolate/port the small required
  snapdir-core filesystem surface for Windows and verify it on the release
  matrix. Do not silently remove Windows support or ship a release dependent on
  the ignored `repos/` checkout. This is an early feasibility milestone.

---

# 11. Incremental Design and Implementation worlds

Do not regenerate every projection after every edit.

Conceptually:

```text
previous source manifest
        Δ
current source manifest
        ↓
Added
Deleted
Modified
Unchanged
```

For each source file:

## Added

No projection exists.

Semanticization required.

## Modified

Existing projection becomes stale.

It must not participate in current compilation.

After fresh Turtle is validated, atomically replace only that file's `.egg`.

## Deleted

Delete the mirrored `.egg`.

Its semantic facts disappear from the world.

## Unchanged

Reuse the current `.egg`.

No new model call.

The main optimization is avoiding unnecessary LLM semanticization.

It is acceptable initially to recompute egglog closure from the union of all fresh projections.

Do not introduce a persistent saturated e-graph cache unless later profiling justifies it.

---

# 12. Sigil imports already provide Design context

Per-file Design projection does not mean isolated Design semanticization.

Sigil already has imports.

Reuse existing import resolution.

A selected `.sigil` file may refer to exported entities from imported files.

The semanticization harness should provide:

```text
current .sigil file
resolved imports
canonical IDs/types/labels of imported exported entities
fixed Sigil ontology
```

The resulting Turtle may reference entities defined in imported files.

Thus:

```text
one source file → one .egg projection
```

while the union of all projections forms Design graph D.

---

# 13. Reuse existing export semantics

Do not invent a new semantic export mechanism.

Reuse the current Sigil language semantics around:

* `Concept` grouping
* contract glossaries
* interface exports
* imports
* existing resolver behavior

Concepts/glossary terms exposed through a component `interface` are part of that component's semantic export surface according to the existing language.

Use parser/resolver behavior rather than textual grep.

Specifically, `resolver.ts::localConceptGroups` groups component and expand
occurrences by normalized identifier, and marks a Concept public when an
occurrence is in `interface`. `publicConcepts` and resolved import identities
provide the reusable export mechanism. The resolver's internal
`namespaceFingerprint` contains occurrence paths/line numbers and is a convergence
aid, not a semantic-export checksum; do not reuse it as one.

`packages/core/src/glossary.ts` separately resolves configured glossary context.
Do not assume every glossary term is an interface export. Include applicable
glossary/config bytes in Design context identity when they affect interpretation.

---

# 14. Design dependency invalidation

For v1, use the existing resolved Sigil import/reexport graph and a conservative
reverse-reachability walk:

```text
Design source changes
→ invalidate its own projection
→ invalidate every transitive importer

Design source added/deleted/renamed
→ invalidate the affected import closure
```

Use the old and newly resolved graphs when membership changes so deleted edges
do not erase knowledge of affected importers. Treat rename as deletion plus
addition. If unresolved imports prevent identifying the affected closure safely,
invalidate the selected Design set. A visited set handles cycles; reuse the
existing resolver's language-resolution behavior without adding semantic SCC
stabilization. Applicable glossary/config changes invalidate their consumers
and transitive importers; conservatively invalidate all Design if uncertain.

Do not distinguish private edits from public edits. Do not compute semantic
export diffs, model-output-dependent export fingerprints, special public-expand
semantic checks, or selective importer reuse. Public identity/context extraction
in the frontend supports language resolution and interpretation, not an export
optimization engine. Design frontend/config/glossary inputs outside the import
graph remain bound under section 8; a changed input invalidates its consuming
Design projection. This does not introduce extra Implementation context.

This may regenerate more Design projections than necessary. One source file
still maps to one `.egg`, and Implementation source/catalog freshness remains
unchanged. Finer Design invalidation is future work only if profiling shows that
conservative import-closure invalidation is materially expensive.

---

# 15. Turtle remains the model-facing language

Use ordinary RDF 1.1 Turtle and Sigil's fixed ontology.

Do not introduce:

* JSON-LD
* RDF 1.2 triple terms
* N-Quads
* TriG
* OWL
* SHACL
* another semantic DSL

Models emit facts only.

Example:

```turtle
@prefix sigil: <https://sigil.dev/ontology/1#> .
@prefix ex: <urn:sigil:project:> .

ex:SigilDX
    a sigil:Component ;
    sigil:dependsOn ex:InstalledSigil .

ex:InstalledSigil
    sigil:provides ex:Compilation .
```

Models may not emit egglog rules.

---

# 16. sigilc owns deterministic Turtle ingestion

`sigilc` receives Turtle produced externally.

It performs:

```text
Turtle
  ↓
real RDF parser
  ↓
validate fixed Sigil ontology
  ↓
normalize assertions
  ↓
deterministically encode data-only .egg
  ↓
atomically replace mirrored projection
```

Use a mature Rust RDF/Turtle parser.

Do not parse Turtle manually.

Reject:

* unknown Sigil predicates
* unknown classes
* named graphs
* RDF-star/triple terms
* malformed literals
* project-authored rules
* attempts to populate compiler-owned relations

Do not implement `--fix`/`--autofix` in v1. Reject malformed input with precise
diagnostics. Wrapper cleanup, such as removing Markdown fences, and semantic
repair belong to the external environment. No facts, predicates, or entities
may be invented by ingestion.

---

# 17. sigilc never launches semanticizer agents

Keep orchestration outside Sigil entirely.

`sigilc` may report stale work:

```text
sigilc stale design
sigilc stale implementation
```

with reasons such as:

```text
missing
modified
deleted
dependency-invalidated
entity-catalog-invalidated
```

The external environment may respond by launching semanticizer agents.

Parallelism belongs to that environment; no launcher is implemented in Sigil.

---

# 18. Design semanticization is open-world over entities

During Design semanticization, models may introduce semantic entities using the fixed Sigil ontology.

This is where the entity universe is created.

Across files, identity must remain consistent.

Use imports/exports to preserve canonical identity.

The frontend reserves component and Concept IDs deterministically from resolved
owner/path/name identities. Retain the path-qualified approach of
`semanticComponentId`; examples using short `ex:` names are illustrative, not an
identity allocation algorithm. New model-created domain entities must be owned
by the current Design source and explicitly named. Reject collisions and
conflicting declarations; another file references the owning identity instead
of redeclaring a synonym. Avoid anonymous entities in the initial accepted
profile so blank-node relabeling does not destabilize catalog identity.

Preserve a compiler-generated inventory of required authored interpretation units
using the existing `projectSigilIntent` behavior as the starting point. Empty or
partially interpreted model output leaves inventoried units unresolved. Separate
interpretation obligations from obligations on code; satisfying the former does
not satisfy the latter. Structural coverage still cannot prove that a model
faithfully captured every sentence; reports must retain that limitation.

The full Design graph is:

```text
D =
union of every fresh
.sigil/worlds/design/**/*.egg
```

---

# 19. Freeze the Design entity universe

Once Design graph D is current, derive a deterministic frozen entity catalog.

It contains identity information only:

```text
canonical IRI
type
label
language-defined exported aliases/names where applicable
```

Example:

```text
urn:sigil:project:SigilDX
  type: Component
  label: SigilDX

urn:sigil:project:SigilSemanticBridge
  type: Boundary
  label: SigilSemanticBridge

urn:sigil:project:Compilation
  type: Capability
  label: Compilation
```

Fingerprint this catalog deterministically.

Implementation projections are valid only against the exact Design entity catalog fingerprint they were generated with.

Initially any catalog change invalidates all Implementation projections, because
each worker receives the entire catalog. Selective invalidation requires scoped
catalog inputs and their own fingerprints; do not claim it for the initial design.

Freeze identity from current, non-`Disjoint` Design:

| Design state | Catalog / implementation behavior |
| --- | --- |
| `Disjoint` | No catalog suitable for coding; no implementation comparison. |
| `Loose` | Provisional frozen catalog; coding and Implementation semanticization/comparison allowed; `Closed` impossible. |
| `Coherent` | Authoritative current catalog; Implementation may become `Closed` when all remaining conditions hold. |

“Frozen” means immutable for that captured identity set, not permanently complete
Design. Unresolved semantic meaning does not prevent a provisional catalog;
malformed or ambiguous entity identities are not exposed as validated identities.
Missing/stale Design inputs must first be refreshed; provisional does not mean
that stale assertions can supply a current catalog.

Keep provisional/authoritative status and the current Design fingerprint in the
catalog response metadata, outside the identity catalog fingerprint. The identity
fingerprint hashes only the sorted identity/type/label/exported-alias content.
Thus a transition from Loose to Coherent with identical catalog content can reuse
I and recompute comparison; it does not require new semanticizer calls merely
because the catalog's status changed.

Catalog output excludes Design relationships, contract propositions, obligations,
expected values, intended endpoints, descriptions revealing relationships, and
other relationship-bearing records. Keep domain identities distinct from internal
interpretation/provenance IDs. Validate every domain resource reference in
Implementation against the catalog; ontology class IRIs and datatype IRIs are
vocabulary, not missing project entities. Do not feed the catalog wholesale into
I as evidence that its entities are implemented.

A Design relationship change that preserves catalog bytes still invalidates the
comparison result and regenerates obligations, but can reuse Implementation
projections whose other inputs remain unchanged.

---

# 20. Implementation semanticization is closed-world over semantic identity

This is a hard rule.

The independent implementation semanticizer may use **only entities already present in the frozen Design entity catalog**.

It may not invent new semantic entities or aliases.

If Design defines:

```text
urn:sigil:project:SigilSemanticBridge
```

Implementation Turtle may not create:

```text
SemanticBridge
sigil-semantic-bridge
MyBridge
BridgeV2
```

as substitutes.

The Implementation graph is deliberately:

> a projection of actual code behavior onto the semantic identity universe defined by Design.

It is not a complete ontology of every helper function or internal class.

If a code concept does not map confidently to a Design semantic entity, omit it rather than inventing a new semantic identity.

Record that omission as an unresolved reconstruction diagnostic outside the
domain assertions. A valid empty Turtle document distinguishes a completed
zero-fact reconstruction from a missing job, but cannot establish total semantic
coverage. Out-of-catalog behavior is a deliberate blind spot; `Closed` speaks only
about the selected scope and modeled obligations, not every behavior in the code.

This gives D and I deterministic identity alignment.

---

# 21. The independent semanticizer must not see Design relationships

Passing the frozen entity catalog is allowed.

Passing Design relationships is not.

Allowed:

```text
SigilSemanticBridge
  type: Boundary
  label: SigilSemanticBridge
```

Forbidden:

```text
SigilDX routesThrough SigilSemanticBridge
```

because that is the answer the independent semanticizer is supposed to reconstruct from code.

The only intentional information shared from Design into implementation reconstruction is:

```text
fixed ontology
frozen identity/type/label catalog
```

---

# 22. Implementation output is locally attributable

For target source file:

```text
src/a.py
```

the resulting:

```text
src/a.py.egg
```

should contain assertions attributable to that file.

It may reference Design entities implemented elsewhere.

For example:

```text
A invokes B
A provides X
```

where B may live in another source file.

Do not copy arbitrary downstream facts about B into `a.py.egg`.

Cross-file consequences emerge from the union of all fresh projections and egglog closure.

Its source attribution and facts remain local. Changed neighboring behavior is
represented in the neighbor's own object, not copied into or used to invalidate
this one, even when the neighbor's exported names change. A later change to this
target or the frozen Design catalog is a separate invalidating input.

```text
I = union of every fresh .sigil/worlds/implementation/**/*.egg
I* = saturate(I)
```

The union includes only validated current index entries as specified in section 9.
It links local semantic objects; closure creates global/transitive meaning.

---

# 23. Independent background semanticization workflow

An external coding environment may expose an action conceptually like:

```text
semanticize src/foo.ts
```

The coding agent invokes this when it judges a file/piece is stable.

That action:

1. captures the exact target source path and file bytes
2. records the snapdir source checksum
3. determines the frozen Design entity catalog fingerprint
4. launches an independent semanticizer agent
5. gives it only target file bytes as implementation context
6. gives it the fixed ontology and frozen identity-only Design catalog
7. receives Turtle
8. invokes `sigilc ingest implementation --source ...`
9. publishes the `.egg` only if the full job input identity and expected projection generation still match
10. otherwise discards/marks the result stale

The coding agent immediately continues work after triggering semanticization.

It does not wait for, review, repair, or approve the semanticizer's result.

Coder triggers are latency hints, not the source inventory. At completion the
harness enumerates all stale/missing selected files, schedules any the coder did
not trigger, waits for its jobs, then runs comparison against a fresh captured
manifest. Bounded parallelism, deduplication, cancellation, and retry are harness
responsibilities. A failed or omitted job cannot disappear from coverage.
Sigil implements no part of that scheduling runtime. Its deterministic stale,
preparation, ingestion, and comparison commands are sufficient to exercise this
protocol with fixed fixtures.

---

# 24. Delete language-specific verification

Remove the TypeScript 7-specific semantic verifier and other programming-language-specific proof machinery introduced by the previous design.

Sigil no longer operates at programming-language semantic level.

It operates at Semantic Worlds level.

Delete architecture centered around:

* TypeScript 7 semantic observations
* TS AST proof machinery
* TS-specific call graph verification
* symbol ownership proof tables
* source-location sufficiency rules
* implementation receipt verification
* installed-dependency capture/staging
* language-specific implementation adapters

Retain generic source discovery and filtering where useful.

Keep ordinary project build/test/lint checks in the external implementation
workflow and report them separately from semantic status. Removing the TS7 proof
adapter does not establish that the new worlds comparison detects syntax errors,
type errors, or failing tests.

Implementation source selection must support heterogeneous repositories without adding language adapters to `sigilc`.

---

# 25. Delete receipt verification

Remove the implementation receipt protocol as a verifier architecture.

The coding agent no longer says:

```text
O72 is implemented at symbol X
```

Instead:

```text
independent semanticizer reads code
→ produces I
```

Then:

```text
D* = saturate(D)
I* = saturate(I)

O = obligations(D*)

check O against I*
```

No receipt layer is needed.

---

# 26. Never merge D and I before comparison

This is a hard correctness invariant.

Wrong:

```text
saturate(D ∪ I)
```

because intended Design assertions could satisfy their own implementation obligations.

Correct:

```text
D* = saturate(D)

I* = saturate(I)

O = obligations(D*)

compare(O, I*)
```

Keep Design and Implementation graphs separate through saturation.

Use separate `EGraph` instances. Export only the finite obligation table from D*
to a comparison phase alongside I* results. Design facts must never populate
Implementation `known`, satisfaction, or evidence tables. The comparison may
use a third fixed ruleset/instance with distinct input relations; host code handles
freshness, operational errors, and final status reduction. Add a regression where
Design states a positive fact and I is empty: it must not satisfy itself.

---

# 27. Keep the egglog kernel small and compiler-owned

Retain useful fixed-point laws from `kernel.egg`.

Delete old receipt/mechanical verifier machinery that no longer serves D-vs-I comparison.

The kernel exists to perform:

```text
graph → richer graph
```

Important rule families include:

## Relation closure

```text
A dependsOn B
B dependsOn C
→ A reachable C
```

## Obligation generation

```text
A requires X
→ obligation that X be available to A
```

## Satisfaction

```text
obligation R
+
matching semantic fact in closure
→ R satisfied
```

## Contradiction

```text
A excludes X
A uses X
→ violation
```

## Required positive and negative propositions

```text
Contract says:
A invokes B = true
→ obligation
```

```text
Contract says:
A uses X = false
→ prohibition
```

## Numerical propagation

```text
A → B cost 4
B → C cost 5
→ distance(A,C)=9
```

Competing candidates may merge under appropriate algebra:

```text
distance → min
risk → max
```

Models never define these laws.

### Absence, negation, and numerical bounds

As `egg.md` explains, a missing row is not a negative fact. Fresh source coverage
also does not prove that an LLM enumerated every behavior. The old kernel's
`complete-scope` mechanism supported negative checks; deleting it removes that
capability and requires an explicit replacement policy.

Initial policy: a prohibited positive behavior in I* produces `Drift`; its absence
alone leaves the prohibition unresolved and therefore `Converged`. Negative
satisfaction requires a compiler-owned rule deriving a negative proposition from
explicit supported facts, with a precisely defined scope. Until such a law is
implemented for a predicate, that negative obligation cannot contribute to
`Closed`. Never let a worker declare an entire repository complete, or reuse a
Design `expected false` declaration as an Implementation witness. Do not re-create
the old receipt protocol to hide this limitation.

Define one fixed obligation-lowering table for predicates. Reuse current
`requires -> provides`, `provides -> positive implementation obligation`, and
`excludes -> uses prohibition` semantics where intended. Distinguish structural
metadata, descriptive relations, and required propositions. An ontology entry
alone does not specify whether an edge is required or which evidence satisfies
it; acceptance tests must cover that mapping.

Keep fixed-point rules finite and monotone. Reuse minimum-distance functions with
finite nonnegative costs, not a relation enumerating all path sums through cycles.
Retain conflicting raw observations rather than hiding them with `min`/`max`.
Reject non-finite numbers and define numeric ranges/units; arithmetic overflow or
undefined arithmetic cannot silently establish a result. Bound input size,
iterations, rows, elapsed time, and memory as supported by the runtime. Hitting a
bound produces an incomplete operational result, never a green fixed point.

Run missing-obligation checks only after saturation. Do not assert permanent
absence facts during a growing closure. Use stable collision-resistant tuple IDs
for facts/obligations and bounded provenance; avoid delimiter-concatenated IDs
whose input strings can collide and recursively expanding proof-path strings.

---

# 28. Aggressively remove obsolete kernel relations

Review and delete old relations whose purpose was the discarded mechanical verifier, including where obsolete:

```text
observation
complete-scope
required-check
check-result
receipt-claim
receipt-location
symbol-owner
scoped-observation
receipt-result
implementation-mode
```

Retain only what is needed to:

```text
build D*
build I*
derive obligations from D*
compare obligations against I*
produce diagnostics/provenance
```

The desired outcome is major net deletion.

---

# 29. Design states

Use these exact Design states.

## `Disjoint` — RED

Design closure contains a hard contradiction or impossible set of required semantic propositions.

Example:

```text
A invokes B = true
A invokes B = false
```

both required.

## `Loose` — YELLOW

No hard Design contradiction exists, but required Design meaning remains unresolved or underspecified.

This is a usable working state. Current Loose Design may expose a provisional
frozen entity catalog, and implementation coding, semanticization, and comparison
may proceed. Implementation can be `Drift` or `Converged`, never `Closed`.

## `Coherent` — GREEN

Design closure has:

```text
no hard contradiction
no unresolved required Design obligations
semantic closure under the current kernel
```

The status is deterministic.

No LLM chooses it.

---

# 30. Implementation states

Use these exact names.

## `Drift` — RED

Implementation closure positively disagrees with Design.

Examples:

```text
Design:
A excludes X

Implementation:
A uses X
```

or another directly contradictory semantic relation.

Drift requires actual disagreement, not merely missing information.

## `Converged` — YELLOW

Implementation closure contains **no known contradiction with Design**, but total semantic closure has not been established.

Examples:

* one or more Design obligations are not established by I*
* a selected implementation file has stale/missing semanticization
* implementation semanticization is incomplete
* the reconstructed world lacks enough information to decide an obligation

Converged is deliberately positive.

It means:

> The implementation is semantically moving with Design and currently shows no known disagreement, but full synchronization has not been established.

It is an acceptable working state.

## `Closed` — GREEN

All of the following hold:

```text
all required implementation projections are fresh
Design is Coherent and all selected Design projections are fresh
all obligations derived from D* are satisfied by I*
no Design prohibition is contradicted by I*
no hard implementation semantic contradiction exists
```

Closed means:

> Design and independently reconstructed Implementation worlds are synchronized under the current ontology and kernel.

It does not mean arbitrary runtime behavior has been formally proven.

Return Design and Implementation statuses separately. If Design is `Loose`,
Implementation cannot be `Closed`. If Design is `Disjoint`, comparison reports
Design as the blocker and leaves Implementation status unset rather than blaming
code for impossible intent. A completed current contradiction takes precedence
over unknowns, but stale facts cannot establish that contradiction. Invalid input,
I/O failure, cancellation, or exhausted closure limits are operational outcomes
with no completed status. An intentionally empty scope must be explicit and
visible in the report; accidental empty selection must not pass vacuously.

---

# 31. Snapdir-driven compile freshness

Before compile/compare, use snapdir-derived manifests to classify source projections.

Example:

```text
source              status
─────────────────────────────
a.py                fresh
b.py                modified
c.py                deleted
new.py              missing
```

For Design additionally support:

```text
dependency-invalidated
```

For Implementation additionally support:

```text
entity-catalog-invalidated
```

`Closed` is impossible while required selected implementation source projections are stale or missing.

A known contradiction may still produce `Drift` even if unrelated files are stale.

Otherwise incomplete semanticization contributes to `Converged`.

---

# 32. Source filtering

Do not assume implementation file extensions.

Provide deterministic configurable selection such as:

```text
--path <file>
--dir <directory>
--include <glob>
--exclude <glob>
```

Exact syntax should follow existing CLI conventions.

Always exclude generated/internal trees such as:

```text
.sigil/
.git/
node_modules/
build output
configured vendor trees
```

Design naturally targets `.sigil`.

Implementation may contain arbitrary languages.

---

# 33. Minimal sigilc CLI

Keep the binary focused.

Conceptually:

```text
sigilc ontology

sigilc stale design [selection]
sigilc stale implementation [selection]

sigilc entities

sigilc ingest design \
  --source architecture/foo.sigil \
  --job <captured-input-id> \
  --turtle -

sigilc ingest implementation \
  --source src/foo.py \
  --job <captured-input-id> \
  --turtle -

sigilc compile design

sigilc compile implementation

sigilc compare

sigilc clean
```

`sigilc ingest implementation` must reject publication if:

```text
current source hash != expected source hash
```

or:

```text
current Design entity catalog fingerprint != expected fingerprint
```

This prevents stale asynchronous semanticization results from becoming current.

Implementation preparation produces exactly the target source snapshot,
frozen Design catalog, fixed ontology/schema and
projection format, and captured semantic input identity. `--job` names that
immutable descriptor, not a model invocation or scheduler record. Publication
also rejects incompatible ontology/schema or projection format. No language
resolution or Implementation context fields/options exist. Conceptually,
`sigilc prepare implementation --source src/foo.ts` produces those inputs; use
the preparation surface already required by this plan, not an extra subsystem.

The descriptor binds only the side-specific source-semantic inputs in section 8.
It is created before reconstruction; ingestion must not
invent expected hashes from the current filesystem after receiving Turtle.
Expose a deterministic `sigilc` preparation operation, with TypeScript frontend
input where needed, to create these descriptors and immutable inputs. Descriptors
contain no coding-agent claims or LLM-production metadata. No arbitrary
Implementation context bundle is prepared. Design preparation retains its
resolved Sigil frontend/import inputs.

An external caller may prepare and reconstruct an already-fresh projection;
`stale` need not list it first. Ingestion replaces it only with the matching
semantic input identity and expected publication generation. A different model
or prompt alone never marks it stale and requires no compiler option or field.

`stale` and compile are inspections; neither invokes models or silently refreshes
projections. Give `entities` a machine-readable catalog/fingerprint result with
provisional status for Loose Design and authoritative status for Coherent Design;
reject Disjoint or stale Design. `clean` targets generated worlds only. Keep
JSON output versioned, sort diagnostics deterministically, and distinguish
completed yellow/red from usage and runtime failure in exit codes.

No provider/model flags belong in sigilc.

Preparation additionally accepts the resolved Design bundle from `sigil`; define
the exact flag schema when implementing the small frontend protocol in section 2.
The job descriptor pins its identity. CLI examples above assume that preparation
has completed. The TypeScript CLI remains separately useful for parse/check/fmt,
context/retrieval, graph/glossary, and editor services when no semantic world exists.

---

# 34. Candidate search is outside scope

Implement no candidate search, ranking, beam store, or semantic-diff UI. External
callers may evaluate separate disposable inputs with ordinary commands. An intent
choice must be recorded in authored `.sigil` before publishing current Design;
never make a disposable world its only record or overwrite live projections
during speculation.

---

# 35. Restore old code aggressively

Before reimplementing behavior that the final architecture retains:

1. inspect current code
2. inspect the same file at `08c22e0a088407f94b1dd6999c044334b0190552`
3. determine whether current complexity exists solely for the architecture being removed
4. restore/reuse old known-good behavior where appropriate

Do not rewrite old functionality merely because it is easy to regenerate.

For a subsystem being deleted outright, inspect its current callers and remove
it; a historical restoration exercise is unnecessary. The old commit is a reuse
reference, not a requirement to resurrect old code before deleting it again.

Expected result: **large net code deletion**.

## Implementation order and deletion map

1. Establish the TypeScript frontend → standalone Rust `sigilc` boundary at
   `packages/sigilc`. Preserve the TypeScript CLI and parser/resolver. Sketch the
   minimal versioned input schema; do not create another compiler IR. Check
   snapdir dependency distribution and platform feasibility early.
2. Move/reuse the native egglog engine and restricted assertion handling. Preserve
   useful laws and fixtures; remove the old JSON bridge protocol.
3. Implement Turtle ingestion, canonical per-source `.egg` projections,
   deterministic input preparation, snapdir-backed source/catalog freshness for
   Implementation, separate Design frontend inputs,
   atomic publication, and disposable world assembly. Exercise races and corrupt
   inputs with fixtures, not agents.
4. Implement isolated D and I closure and deterministic obligation comparison.
   Prove positive satisfaction, contradictions, unresolved negatives, and failure
   behavior using fixed assertions.
5. Add the minimal resolved Design frontend bundle from existing TypeScript
   language APIs. Enforce its closed schema and forbidden semantic fields.
6. Implement conservative Design import-closure invalidation from the existing
   resolved import/reexport graph, including membership changes. No semantic
   export analysis or new SCC stabilization.
7. Implement provisional catalogs for current Loose Design and authoritative
   catalogs for Coherent Design; reject Disjoint Design. Invalidate all I
   projections when the supplied full identity catalog changes. Preserve reuse
   for relationship/status-only changes with identical identity content.
8. Wire deterministic statuses and reports into existing CLI/editor surfaces.
   Preserve ordinary language tooling without worlds or model configuration.
9. Delete obsolete receipt, TS7 verifier, accepted-world, managed-view,
   semantic-slice, beam, provider/evaluator orchestration, and migration systems,
   including their protocols, configuration, callers, tests, and dependencies.
10. Update authored contracts, docs and lightweight skills to describe the external
    harness protocol and allowed/forbidden context. Implement no harness adapter,
    coding workflow, launcher, scheduler, or background runtime. CI uses fixed
    Turtle fixtures or simple model-boundary test doubles.
11. Finish packaging, installers, platform validation, and the net-deletion audit.
    Verify `sigil` and `sigilc` from a clean checkout without `repos/`. Temporary
    development scaffolding must be gone in the completed refactor.

Use this concrete audit list rather than directory-wide restoration/deletion:

## Mandatory removals

These systems must be absent at completion, including public exports, command
routes, schemas/config keys, manifests, packaging, docs and obsolete tests.
Extract a small useful deterministic helper first if necessary, but do not leave
the old subsystem callable, renamed, dormant, or behind a compatibility alias.

| Remove completely | Concrete current targets |
| --- | --- |
| Provider/evaluator packages | `packages/compiler-adapter-claude/`, `packages/compiler-adapter-codex/`, `packages/compiler-adapter-opencode/`, `packages/compiler-adapter-pi/`; remove their workspace/build/test/publish entries. |
| Compiler orchestration | Under `packages/compiler/src/`: `adapters.ts`, `adapter-execution-coordinator.ts`, `adapter-subprocess.ts`, `evaluation.ts`, `evaluation-capabilities.ts`, `evaluation-execution.ts`, `evaluation-request.ts`, `evaluation-skills.ts`, `evaluator-retrieval.ts`; remove old exports from `mod.ts`. |
| Bundled evaluator-stage skills | `packages/compiler/skills/semantic-readiness/`, `architecture-design/`, `current-code-compatibility/`, `standards-risk/`, including `compile.json` registration. Useful general instructions may survive only as lightweight docs without an evaluator runtime. |
| Model proposals and beams | Under `packages/compiler/src/semantic/`: `proposal.ts`, `proposal-protocol.ts`, `provider-config.ts`, `search.ts`, `beam.ts`, `beam-store.ts`. |
| Receipts, handoffs and mechanical verification | Under that semantic directory: `handoff.ts`, `receipts.ts`, `receipt-locations.ts`, `receipt-witnesses.ts`, `verify-return.ts`, `verification.ts`, `typescript7.ts`, `implementation-workspace.ts`, `evidence.ts`, `checks.ts`; remove the TS7 analyzer dependency and installed-package verification staging. Ordinary external project tests remain useful. |
| Accepted-world and managed-view workflows | `semantic/store.ts`, `views.ts`, `view-model.ts`, `projections.ts`; remove accepted-state migration, managed-view editing/recovery, and generated `.sigil/views` authority. |
| Retained semantic artifact framework | `semantic/artifact-recording.ts` and the retained-bundle machinery in `artifacts.ts`; replace only the necessary path/hash/atomic publication behavior with the small disposable world store. No retained runs, receipt bundles, or stage-result database. |
| Legacy compiler profiles/history/events | Remove the old profile inheritance/stage aliases in `profile.ts` and `semantic/profile.ts`, persisted diagnostic history in `history.ts`, and old stage-event protocol/reader/writer infrastructure in `event-protocol.ts`, `event-reader.ts`, `event-writer.ts`. Keep only concrete limits, current diagnostics, and thin reporting needed by the new commands. |
| Old CLI semantic surface | Replace `packages/cli/src/semantic-commands.ts` with only any needed thin new-command routing; remove old intent/answer/accept/beam/slice/receipt/verify/project/migrate routes. Delete `semantic-providers.ts` and the compatibility facade `compiler-adapters.ts`; update callers directly. Remove provider/evaluator/migration authoring branches, not generic config functionality. |
| Old native bridge and duplicate semantic pipeline | Remove `packages/compiler/native/` after moving useful engine code into `packages/sigilc`. Remove the old `sigil-semantic-engine` protocol, runtime lookup/staging and TS ingestion/lowering/closure copies after Rust replaces them. No third binary or duplicate ontology authority. |

Do not delete language semantic tokens, authored semantic units, Concept
resolution, generic ownership/navigation links, normal CLI config, or report
formatting merely because their names contain “semantic”, “profile”, or
“implementation”. The table names obsolete systems, not a keyword-based purge.

No new resolved Implementation identity tables, symbol-map protocols,
module-resolution caches, resolver callbacks/plugins, or Implementation dependency
tracking are allowed. None is currently implemented for the new architecture;
remove any introduced scaffolding and do not salvage the old TS7 verifier for
mappings. Preserve Sigil Design-language resolution.

## Preserve or replace narrowly

* Preserve `packages/core` parser/resolver, source ranges, import/Concept/export
  tests, generic navigation/ownership comments, and useful CLI/LSP/editor behavior.
  Remove only semantic-view and proof-specific coupling from those surfaces.
* Move useful behavior from `native/src/main.rs`, `kernel.egg`, and `schedule.egg`
  to `packages/sigilc`. Delete the old bridge `Input` protocol and receipt tables.
* Port relevant validation cases from `semantic/turtle.ts`, `ontology.ts`, and
  `egg-world.ts`, then delete duplicate TypeScript ingestion/lowering and native
  bridge plumbing in `engine.ts` and obsolete runtime/protocol code. Export the
  ontology from Rust for prompts so TypeScript does not maintain another copy.
* Reuse the structural inventory/identity behavior in `semantic/source.ts`, but
  separate frontend structure from semantic assertions. Review its automatic
  import-to-`dependsOn` lowering: a language import establishes name visibility,
  not necessarily an architectural runtime dependency. Keep that distinction in
  the frontend bundle and require explicit domain semantics for obligations.
* Remove obsolete `typescript7.ts`, `verification.ts`, `verify-return.ts`,
  `implementation-workspace.ts`, `handoff.ts`, `receipts.ts`, `receipt-*.ts`, and
  mechanical evidence/check adapters after auditing any generic helpers they hold.
* Remove accepted-world store/migrations, managed-view authoring/projection,
  semantic slices, beams, proposal-provider orchestration and their retained
  artifact layers. Replace the useful path/checksum/atomic-write principles with
  the small disposable store; do not carry the generic receipt bundle framework.
* Audit `evaluation*.ts`, `adapter*.ts`, `packages/compiler-adapter-*`, provider
  configuration, and evaluation skills. Delete obsolete execution machinery and
  its Deno workspace/task/import/lock entries. Do not relocate it to a new Sigil
  harness package. Preserve only useful deterministic helpers with identified
  final callers; lightweight instructions are not a reason to keep a runtime.
* Avoid/delete semantic export-fingerprint caches, private/public edit analysis,
  model-derived export transport, and semantic SCC stabilization. Use the
  resolved graph plus a visited-set traversal. Record avoided planned work
  separately from code actually deleted; do not claim unimplemented systems as
  deletions.
* Keep the frontend bundle restricted to the structural allowlist in section 2.
  Avoid duplicated inferred-fact, obligation, rule, ranking, and implementation
  result fields/modules. Rust owns their derivation and interpretation.
* Update `scripts/build-semantic-engine.ts`, `build-cli-release.ts`, published
  runtime tests, CLI config/schema, install scripts, CI, editor tests and docs.
  Stop packaging TS7 and `sigil-semantic-engine`; ship `sigil` and `sigilc`.
* Update root/compiler/core/CLI/editor `.sigil` contracts where ownership changes,
  `integrations/skills/sigil/` guidance, compatibility metadata, and skill evals.
  The globally installed skill still describes accepted worlds and receipts;
  change the repository-owned sources, not the global copy.

Count net changes against the refactor's starting revision, including Rust,
TypeScript, tests, and workflow code. Report moved files separately so moving the
bridge into `sigilc` is not presented as deletion. Removing useful language
features to manufacture a lower line count is not acceptance.

## Additional v1 simplifications

* Use one preparation descriptor shape for both sides, with only necessary
  side-specific fields. Preparation is deterministic data capture, not a job
  database: no queued/running/retry states, worker registry, daemon, polling,
  callbacks, or scheduler. External callers retain descriptors until ingestion.
* Share ingestion, assertion encoding, input validation and disposable storage
  code between D and I. Explicit side-specific validation preserves catalog and
  trust boundaries; avoid language/provider plugins or generic pipeline stages.
* Use separate D/I instances of the existing egglog embedding and one comparison
  path. `sigil compile` delegates to it; CLI/editor surfaces do not each compute
  their own semantic statuses. Recompute closure from fresh projections; no
  persistent saturated graph or retained stage-result framework in v1.
* Use source-local Implementation objects with only target bytes, ontology, and
  the frozen Design catalog supplied to the model. Keep whole-catalog invalidation
  because the full catalog is supplied. Neighbor changes invalidate only their
  own projections. No Implementation dependency tracking, language resolution,
  repository-context machinery or selective catalog dependency system is needed.
* Keep strict Turtle input and precise diagnostics; omit autofix, built-in
  candidate search, ranking, beams and candidate stores. External callers can
  evaluate fixtures or candidates in disposable separate directories using the
  ordinary commands. No special speculative compilation protocol is required.
* Use one fixed compiler pipeline and a small limits configuration. Drop legacy
  profile inheritance, evaluator-stage aliases, configurable stage DAGs, persisted
  diagnostic history, and replayable stage-event machinery. Emit one versioned
  final JSON result plus human-readable formatting; ordinary process progress
  and cancellation need no retained event framework. Update existing consumers
  to this final result rather than preserving the old report protocol.
* Preserve useful existing reachability, obligation, contradiction and numerical
  laws with their regression cases. Do not add a generic numerical analysis
  framework, new proof mode, all-derivations explorer, or new negative-proof
  system. Retain bounded fact/source and rule witnesses sufficient to explain
  diagnostics; an elaborate provenance UI is outside this refactor.
* Use the current runtime's practical bounds and reliable process termination.
  Do not create a resource-governance framework, custom egglog scheduler, or
  cross-platform accounting service. Limits and cancellation remain failures
  rather than completed green results.

These reduce implementation surface without removing source freshness,
provenance, atomic publication, isolation, or conservative unknown handling.

---

# 36. No migration or compatibility layer

There are no external users.

Therefore:

* no dual stores
* no legacy world reader
* no old receipt support
* no old handoff support
* no TypeScript verifier compatibility
* no installed-package semantic capture
* no semantic-format migration
* no feature flag preserving both architectures

Delete obsolete tests together with obsolete code.

---

# 37. Acceptance cases

The refactor is incomplete until these pass.

## A. Graph enrichment

Given:

```text
A dependsOn B
B dependsOn C
```

derive:

```text
A reachable C
```

## B. Disjoint Design

Required:

```text
A invokes B = true
A invokes B = false
```

Result:

```text
DesignResult = Disjoint
```

## C. Loose Design

Required Design obligation unresolved, with no contradiction:

```text
DesignResult = Loose
```

For current valid inputs, `entities` returns a provisional frozen identity
catalog. Fixed Implementation Turtle using that catalog can be ingested and
compared. The result may be `Drift` or `Converged`, but never `Closed`, even if
all currently known implementation obligations are satisfied.

## D. Coherent Design

All required Design obligations satisfied and no contradiction:

```text
DesignResult = Coherent
```

The catalog is authoritative for the current Design. If the preceding Loose
Design becomes Coherent without changing catalog identities or Implementation
inputs, reuse its I projections and recompute D*, obligations, and comparison.
Implementation may now become `Closed` when all remaining conditions hold.
Disjoint Design exposes no catalog suitable for coding and no Implementation
comparison status.

## E. Frozen semantic identity

If Design contains:

```text
urn:sigil:project:SigilSemanticBridge
```

the implementation semanticizer may not introduce:

```text
SemanticBridge
sigil-semantic-bridge
MyBridge
```

as substitutes.

## F. Independent implementation reconstruction

The implementation semanticizer must not receive Design relationships or obligations.

It receives only:

```text
exact target source file bytes
ontology
frozen Design entity catalog
```

A preparation fixture verifies that no Design relationships or neighboring
implementation bodies are included. Only the three inputs from section 6 are
exposed to the external worker.

## G. Asynchronous source race

Start semanticization of:

```text
foo.py @ H1
```

Edit the file to H2 before the result returns.

The H1 reconstruction must not publish as current.

## H. Incremental implementation

Given fresh:

```text
a.py
b.py
c.py
```

Modify only `b.py`. This holds even when A imports B, and even when B changes
its exported names. A and C remain bound to their own unchanged source files.

Then:

```text
a.py.egg reusable
c.py.egg reusable
b.py.egg stale
```

After fresh independent semanticization:

```text
only b.py.egg replaced
```

Recompute global egglog closure. A and C are invalidated only if their own
source path/bytes, the frozen Design catalog, or compatible-format requirements
change; no neighboring source dependency is part of their freshness keys.

## I. Deleted source

Delete `c.py`.

Its `c.py.egg` must disappear from I.

## J. Design import invalidation

Given:

```text
a.sigil imports b.sigil
c.sigil imports a.sigil
```

Any source change to B, including private content, produces:

```text
b.sigil.egg stale
a.sigil.egg dependency-invalidated
c.sigil.egg dependency-invalidated
```

No semantic export-diff analysis is required. Addition, deletion, rename,
reexports, and cycles invalidate affected import closure using resolved graphs.

## K. No Design leakage

Never use:

```text
saturate(D ∪ I)
```

for implementation evaluation.

Always use:

```text
D* = saturate(D)
I* = saturate(I)
O = obligations(D*)
compare(O, I*)
```

## L. Drift

Design:

```text
A excludes X
```

Implementation:

```text
A uses X
```

Result:

```text
ImplementationResult = Drift
```

## M. Converged

Design requires:

```text
A provides X
```

I* does not contradict it but does not establish it.

Result:

```text
ImplementationResult = Converged
```

## N. Closed

All Design obligations are satisfied by fresh independently reconstructed I*, with no contradiction.

Result:

```text
ImplementationResult = Closed
```

## O. Entity catalog drift

Implementation projection generated against Design entity catalog fingerprint X.

Design entity universe changes to Y.

Old implementation projection must become stale.

## P. Heterogeneous repository

A project containing at least two implementation languages must work without adding language adapters to sigilc.

## Q. Disposable worlds

Delete:

```text
.sigil/worlds/
```

Reconstruct worlds.

Equivalent input semantics must produce equivalent results.
This assertion uses fixed normalized Turtle fixtures. A fresh model run is not
required to reproduce the same interpretation. Compiler determinism and model
repeatability are separate claims.

## R. Pointer comments are not proof

A code comment claiming implementation of a contract must not independently satisfy any Design obligation.

## S. Semanticizer isolation

The coding agent must not be asked to approve or edit independent semanticizer output.

The independent semanticizer must not receive coding-agent reasoning beyond actual source code.

## T. Major net deletion

Completion report must show:

```text
files deleted
files restored from 08c22...
files added
lines added
lines deleted
obsolete subsystems removed
```

A roughly neutral line-count refactor has missed the goal.

Treat that as a scope warning to investigate, not permission to remove useful
features or tests. Use the measured baseline and estimated range near the start
of this plan; explain deviations. A deletion number alone is not correctness.
The mandatory-removal table must be checked against public exports, dependencies,
CLI help/routes, release payloads and tests, not just against missing filenames.

## U. Source/catalog and publication races

Change the target bytes or frozen Design catalog while a job is outstanding.
The old job cannot publish as fresh. Change only an imported module while
target bytes/catalog remain unchanged: the target projection remains fresh.
Two results for the same source cannot overwrite out of generation order.
A crash between assertion
and index publication leaves an incomplete cache entry, not a current world.

## V. Missing information cannot manufacture green

Empty Design Turtle leaves required authored units unresolved. Empty I does not
satisfy a Design prohibition. A model's complete-scope claim is rejected. Loose
Design, skipped source files, and exhausted closure limits cannot yield `Closed`.

## W. Input and platform boundaries

Reject `.egg` rules/includes, catalog mutations, path traversal, symlink escapes,
non-finite arithmetic input, and wrong-side assertion forms. Build distribution
artifacts without `repos/` on every retained release platform. Permission-only
changes preserve semantic identity; a rename or added duplicate file changes it.

## X. Catalog and import boundaries

A relationship-only Design change with identical catalog leaves I reusable but
recomputes D*, obligations, and comparison. Any Design source change invalidates
transitive importers regardless of unchanged exported names. Reexports, cyclic
imports, and relevant glossary changes participate in graph/context dependency
tests without semantic export checks. Catalog context contains no proposition
endpoints, expected values, or copied Design descriptions.

## Y. Minimal frontend bundle

Check the closed frontend schema against the section 2 structural allowlist.
Reject semantic closure, obligations, inferred facts, implementation requirements
or results, semantic laws, comparison/ranking fields, and egglog rule output.
Inventory entries bind authored units only; they do not encode obligations.

## Z. No repository-owned orchestration

Acceptance completes using fixed Turtle fixtures or simple test doubles, with no
live/background semanticizer implementation in Sigil. Inspect final runtime
dependencies and command paths: there is no provider/evaluator framework, model
launcher, scheduler, or generic harness adapter relocated into another package.
Context tests inspect deterministic preparation output; asynchronous race tests
edit fixture files between preparation and ingestion without starting agents.

## AA. Local semantic object and cross-file closure

Given target `a.ts`:

```ts
import { B } from "./b";
B.run();
```

With canonical B in the frozen Design catalog, the expected local Turtle fixture
may assert `A invokes B` where the source justifies that mapping. No host symbol
table is involved. It must not summarize what B invokes/provides from B's
implementation. Preparation includes only A's bytes, ontology and catalog, never
B's body merely because A imports B. Check the
documented worker instructions as well as the preparation allowlist. Compiler
schema/identity validation does not prove that a model faithfully described code;
do not add a language-specific behavioral verifier to enforce this fixture.

Link fixed objects `a.ts.egg: A dependsOn B` and `b.ts.egg: B dependsOn C`.
Closure derives `A reachable C` without modifying/regenerating `a.ts.egg`.
Replace only B's direct assertions after an internal edit and verify that the
global closure changes while A's object remains byte-identical and reusable.

## AB. Semantic inputs alone control freshness

After generating a projection, change the external model/prompt with compiler
inputs unchanged. The projection remains fresh; explicit reconstruction may
replace it using ordinary ingestion. No model-production fields appear in the
index or preparation protocol.

Independently change target path/bytes, incompatible
ontology/schema or projection format, or the Design entity catalog: each makes
the Implementation projection stale. Another source file's change never
invalidates this projection, even when imported. Test schema rejection of
production metadata, language-resolution metadata, and arbitrary Implementation
source-context fields.

## AC. Ambiguous local reference and no language-resolution subsystem

A source reference ambiguous against the frozen catalog is omitted in the
expected Turtle fixture and leaves any affected obligation unresolved. Unknown
entities are rejected; no aliases are invented to manufacture satisfaction.
Include a misleading-name fixture: a local `semantic_bridge` variable with an
unrelated purpose must not map to catalog entity `SigilSemanticBridge` merely
because the names resemble each other. Expected Turtle omits that mapping;
source usage/context must support identity beyond lexical similarity. This is
a semanticizer instruction/fixture expectation, not a new compiler name-matching
heuristic or language-analysis subsystem.
This tests protocol expectations and deterministic ingestion, not live model
accuracy. The completion audit confirms no Implementation-language resolver,
symbol-map protocol, module-resolution cache, identity-table mechanism, callback
or language-adapter system survives in either CLI/compiler. Sigil Design-language
parsing, imports/reexports, expands, Concept identities, glossary context and
authored-unit inventory remain intact.

---

# 38. Tests

Keep/add tests for:

* ontology validation
* Turtle parsing/normalization
* restricted `.egg` encoding
* kernel closure
* Design states
* Implementation states
* D-vs-I separation
* frozen entity enforcement
* semanticizer context isolation
* snapdir source hashing
* async stale-result rejection
* added/modified/deleted source handling
* incremental projection replacement
* Design import invalidation
* conservative transitive importer invalidation, including private edits
* entity-catalog invalidation
* heterogeneous source selection
* world deletion/reconstruction
* CLI behavior
* cancellation/error handling where still relevant
* the resolved TypeScript frontend bundle and Rust command boundary
* immutable target/catalog inputs and stale source/catalog publication rejection
* local semantic objects linked by global closure without importer regeneration
* internal imported-file changes preserving importer freshness
* neighbor export-name changes also preserving importer freshness
* local import/alias interpretation fixtures without symbol maps
* ambiguous-reference omission and absence of Implementation-language resolution
* model/prompt changes preserving freshness and explicit fresh-input reconstruction
* interrupted publication, duplicate jobs, and assertion/index mismatch
* missing authored interpretation units and unsupported negative obligations
* ordinary TypeScript CLI functionality without worlds or model configuration
* two-binary distribution without the old bridge or ignored local dependencies
* provisional Loose catalogs, Coherent catalog status, and Disjoint rejection
* identical-catalog reuse across Loose-to-Coherent transitions
* frontend schema rejection of semantic fields and absence of model orchestration
* absence of every mandatory-removed command, package and runtime dependency
* one final-report path working for CLI/editor without legacy profiles or history

Delete tests whose only purpose was:

* receipt verification
* TypeScript 7 proof observations
* installed-package snapshots
* old canonical world persistence
* old handoff bundles
* removed migrations

---

# 39. Completion report

At completion report:

1. final architecture
2. final `sigilc` crate/binary location
3. systems deleted
4. files restored from `08c22e0a088407f94b1dd6999c044334b0190552`
5. net lines/files removed
6. final `.sigil/worlds/` layout
7. exact `snapdir-core` usage
8. how Design incremental invalidation works
9. how imports/exports affect invalidation
10. how D is assembled
11. how the frozen Design entity universe is produced
12. the documented external semanticizer protocol and deterministic compiler
    commands it consumes; explicitly confirm no Sigil-owned launcher/runtime
13. exactly what context they receive and are forbidden to receive
14. exact deterministic source-semantic keys: Implementation target path/bytes,
    ontology/schema, projection format and catalog; Design import/frontend input
    dependencies separately; publication generations and no LLM-production metadata
15. how I is assembled
16. exact computation:

```text
D* = saturate(D)
I* = saturate(I)
O = obligations(D*)
compare(O, I*)
```

17. precise definitions of:

```text
Disjoint
Loose
Coherent

Drift
Converged
Closed
```

18. test results
19. any remaining architecture that exists solely because of the discarded receipt/language-specific verifier design
20. code deleted because harness orchestration was removed, plus planned runtime
    work avoided (reported separately, not counted as deleted code)
21. code deleted because Design export-surface invalidation was simplified, plus
    avoided planned modules reported separately
22. fields/modules avoided in the frontend bundle
23. remaining model-boundary code, limited to deterministic preparation/ingestion,
    fixture/test-double support, and lightweight protocol documentation/skills
24. how source-local Implementation objects share frozen catalog identities,
    how the model interprets local names conservatively, how closure derives
    cross-file consequences, and why every neighboring source change preserves
    importer freshness; confirm no Implementation-language resolution subsystem
25. measured source/test reduction against the same tracked-extension baseline,
    new replacement code, moved code, and deviations from the planning estimate
26. mandatory-removal checklist results, including commands, public exports,
    configuration, dependencies, and release payloads

If dead architecture remains, explain exactly why.

---

# North-star principles

Keep these boundaries hard:

```text
.sigil files
    = Design source of truth

source code
    = Implementation source of truth

Turtle
    = model-facing semantic interchange

per-source .egg files
    = disposable normalized semantic projections

snapdir-core
    = source identity and incremental invalidation substrate

egglog kernel
    = compiler-owned semantic laws

coding agent
    = implementation author

independent semanticizer agent
    = implementation-world observer

sigilc
    = deterministic semantic compiler

external harness / coding environment (not implemented by Sigil)
    = model interaction, scheduling, and orchestration
```

And the central trust model is:

```text
Design says what should be true.

The coding agent writes code from that Design.

A separate semanticizer, deprived of Design relationships,
describes direct facts from one source file using frozen Design catalog identities.
Linking and egglog closure compute the cross-file consequences.

Design and Implementation graphs are independently saturated.

Design closure generates obligations.

Implementation closure is checked against those obligations.

Positive disagreement = Drift.
No disagreement but incomplete closure = Converged.
Complete obligation closure = Closed.
```

The implementation should become dramatically simpler because of this architecture, not merely different.

Final Implementation invariant:

```text
exactly one implementation source file + fixed ontology + frozen Design catalog
        ↓ independent external semanticization
one local .egg object containing only direct facts attributable to that file
        ↓ union with every other current local object
Implementation graph I
        ↓ egglog saturation
global Implementation world I*
```

The model understands the local programming language. The catalog supplies
shared semantic identity. Egglog supplies global meaning. Do not add a compiler
subsystem between those responsibilities.

**Local facts in files; global meaning in closure.**
