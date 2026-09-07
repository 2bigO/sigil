# sigilc

The standalone Rust compiler validates externally produced Turtle and derives
Design from disposable per-source projections. It never launches a model and
does not read `compile.md`, `track.md`, or any other temporary task document.

Build with Rust 1.91.1 or newer:

```sh
cargo build --locked --manifest-path packages/sigilc/Cargo.toml
```

Standalone releases ship `bin/sigil` and `bin/sigilc` together with the skill
catalog. The archive version follows the language CLI; `sigilc --version` reports
the Rust crate version. Both installers expose both commands on PATH.

Build and smoke-test a distribution on its matching native platform:

```sh
deno task package:cli --target x86_64-unknown-linux-gnu
```

Omit `--target` to use the host. Release CI retains Linux and macOS on x86_64
and ARM64, and Windows on x86_64. Each target builds its locked Rust binary and
compiled language CLI, exercises fixed native gate fixtures, and consumes the
archive on a matching runner without a source checkout. Cross-target `cargo
check` is not an executable distribution check. No old bridge or TypeScript proof
runtime is staged.

Design commands consume the versioned structural JSON produced by
`sigil export design .`, using core's `loadDesignInput`. Pass that bundle with
`--frontend`. The compiler checks its captured source/config/glossary bytes
against `--root` (default `.`). Regenerate the bundle after authored changes.
Export locates the complete workspace; native scope selects the comparison files.
It performs language analysis only and never invokes a model or `sigilc`.

```sh
sigil export design . > frontend.json
sigilc ontology --format json
sigilc prepare design --frontend frontend.json --source architecture/a.sigil --out job-a
# Spawn a subagent with only job-a/design.json and job-a/ontology.json.
# It writes result.ttl and evidence.json, invokes ingest, and repairs its
# temporary Turtle from each native hint until exit 0.
sigilc ingest design --frontend frontend.json --source architecture/a.sigil --job job-a/job.json --turtle result.ttl --evidence evidence.json
sigilc stale design --frontend frontend.json
sigilc compile design --frontend frontend.json
sigilc entities --frontend frontend.json
```

Ingest is the accept/reject boundary for each external reconstruction. The
coding agent must spawn a subagent with the matching tool parameters; the
subagent records every Turtle/result attempt in version-2 `--evidence` JSON,
reads each emitted `hint:`, repairs only its temporary Turtle and repeats the
same tool call until exit 0 publishes or it reports a blocker. Never edit source
bytes or `job.json`; recapture and prepare a fresh isolated round when a bound
input changes. An accepted evidence record is written into the native projection
index and surfaced by expanded-world reports, while entries accepted without
`--evidence` remain explicitly incomplete artifact evidence.

Scope `focus_order` prioritizes work and reporting; it does not require serial
subagent setup for independent nonfresh sources in one released request item.
Prepare those rows in distinct directories and use bounded concurrency for their
temporary Turtle construction. Keep native ingestion authoritative, retry only
an unchanged ingest when the writer is busy, and wait for the full item gate
before moving to a dependent ordered item.

`--out` must name a new directory. Do not place prepared inputs in selected
source scope. Preparation can replace an already-fresh projection through a new
job, but duplicate jobs cannot overwrite an accepted generation. `--turtle -`
reads standard input. The generated `.sigil/worlds/` cache is ignored and
can be discarded. Its index keeps one canonical source-path publication and
may retain accepted superseded projections at keys ending in the complete
binding fingerprint, for example
`implementation/src/main.rs~<fingerprint>.egg`. These entries preserve exact
semantic bindings across ordered scope items; they are disposable projection
cache data, never request/task history. `sigilc clean [--root DIR]` removes generated worlds even
when the index is corrupt, retaining only the writer lock file. It preserves
sources, config and external preparations. Descriptors and external worker orchestration are not stored
in a compiler job registry.

The optional `--evidence FILE` input records the external worker boundary without
putting process metadata in Turtle. It is version 2 JSON with `preparation`,
`job`, `worker`, `ingest`, and an ordered `attempts` array; each attempt names a
Turtle reference and an ingest-result reference. Rejected attempts carry their
actual nonzero exit. The final submitted attempt names the supplied `--turtle`
and has `"exit": null`; native publication records its actual accepted exit `0`.
adds the source binding, job fingerprint, generation and `.egg` projection path. Compile reports
expose the same records under `artifacts` and identify the expanded-world report
with `artifact_report`. A projection accepted without `--evidence` remains
semantically readable but is marked `complete: false`.

New Design domain entities have the IRI
`urn:sigil:entity:<encodeURIComponent(source path)>:<encodeURIComponent(local name)>`.
Declare one ontology type and one nonempty label in the owning file. Reference
foreign identities without redeclaring them. The frontend reserves Component,
Concept and authored-unit identities. Units never enter the worker catalog.
Labels retain RDF datatype and language. Catalog aliases come only from the
language frontend, not model assertions. Identity matching alone does not prove
that a worker described the source faithfully.

Reports are JSON. `compile design` returns exit 0 for Coherent (green) or Loose
(yellow with warnings), and 1 for Disjoint (red). `stale` returns 1 if work remains.
`entities` returns exit 0 with a
provisional or authoritative catalog, or 1 with no catalog when Design is stale
or Disjoint. Invalid options return 2. Input/I/O/runtime failures return 3 and
no completed report. `--limits FILE` on compile/entities reads the closed native
limits schema; `--allow-empty` explicitly permits and reports an empty Design
scope. Neither is a model configuration option.

Implementation preparation requires a current provisional or authoritative Design
catalog. It writes exactly `source` (unchanged bytes), `ontology.json` and
`catalog.json` for the worker. Keep `job.json` with the external caller; never
supply the full Design report or neighboring code to that worker.

```sh
sigilc prepare implementation --frontend frontend.json --source src/main.rs --out job-main
# The subagent executes the matching ingest call with --evidence evidence.json.
sigilc ingest implementation --frontend frontend.json --source src/main.rs --job job-main/job.json --turtle implementation.ttl --evidence evidence.json
sigilc stale implementation --frontend frontend.json --selection selection.json
sigilc compile implementation --frontend frontend.json --selection selection.json
sigilc compare --frontend frontend.json --selection selection.json
```

Implementation inspection and comparison require an explicit selection JSON.
For example, `{"dirs":["src"],"exclude":["**/generated/**"],"vendorDirs":["vendor"]}`.
Optional fields are `paths`, `dirs`, `include`, `exclude`, `vendorDirs` (arrays of
strings), and `allowEmpty` (default false). Paths are workspace-relative;
includes/excludes use `*`, `**` and `?` globs. Omitted arrays are empty. Internal
cache/build trees are always excluded. A selection controls world membership;
it does not add dependencies to per-file Implementation keys.
Explicit file-only selection applies filters before hashing and avoids unrelated
directory traversal. It uses the same snapdir BLAKE3 hashes and manifest identity
as directory selection, with current path/metadata checks around hashing.
Directory and global selections still use the full pruned snapdir walk.

Both `compile implementation` and `compare` report independently compiled worlds
and their fixed-kernel comparison. Closed (green) and Converged (yellow with
warnings) exit 0; Drift (red) exits 1. Missing/stale or Disjoint Design prevents
a usable catalog and returns exit 3 with Implementation and comparison unset;
the JSON explains the unavailable prerequisite. Inspection and operational exit
codes do not denote semantic colors. These states do not establish delivery,
test success or fidelity of external reconstruction.

Use a paired scope to focus Design and Implementation together. For example,
`scope.json`:

```json
{
  "version": 1,
  "design": { "paths": ["architecture/a.sigil", "architecture/b.sigil"] },
  "implementation": { "dirs": ["src"], "vendorDirs": ["vendor"] }
}
```

```sh
sigilc scope --frontend frontend.json --scope scope.json
sigilc stale design --frontend frontend.json --scope scope.json
sigilc compile design --frontend frontend.json --scope scope.json
sigilc entities --frontend frontend.json --scope scope.json
sigilc compare --frontend frontend.json --scope scope.json
```

All world commands accept `--scope`, including per-source `prepare` and `ingest`
on either side; their `--source` must belong to that side. Use the same scope
through preparation, ingestion and comparison. `--scope` replaces `--selection`
for Implementation and conflicts with it and `--allow-empty`. Set intentional
emptiness with `design.allowEmpty` and `implementation.allowEmpty` instead.
An empty Design `paths` array selects no Design only when explicitly allowed.
Implementation retains its existing selection rules: omitted/empty paths and
directories select all eligible files; use filters to select an intentional empty
Implementation. Invalid or duplicate Design roots are errors, never ignored.

Scope output preserves `design.roots` in caller priority order. `design.focus_order`
places those roots first, followed by additional dependency files sorted by path.
Imports and required structural owners expand membership, with reasons reported
in `design.dependencies`. Unresolved imports conservatively include the entire
frontend bundle and set `conservative_full_bundle`. Included files contribute all
their units and assertions. Known excluded authored-file diagnostics are omitted;
included-file, global and configuration diagnostics remain.

`membership_fingerprint` identifies the effective Design and Implementation file
sets. `order_fingerprint` identifies Design focus order separately. Neither is
an extra per-file projection key: reprioritizing the same roots reuses unchanged
bindings. Changing effective catalog identity still invalidates Implementation.
Excluded cached objects remain reusable and contribute no scoped facts. Scoped
freshness rows cover effective members; unscoped inspection also reports deleted
indexed sources outside the current selection.

`scope` exits 0 for completed membership inspection, even before reconstruction;
it reports captured Design/Implementation input fingerprints and frontend
diagnostics. It supplies no semantic verdict, task completion or worker scheduling.
Scoped gates keep their existing exits and include the scope in their JSON output.
Focused success never substitutes for complete-refactor delivery and comparison.

Scope inspection is intentionally read-only. The native scoped-request primitive
keeps one ordered multi-item request and predecessor release state under the
generated `.sigil/workflow/request.json` ledger:

```sh
sigilc request create --root . --frontend frontend.json --definition request.json
sigilc request status --root .
sigilc request record --root . --dossier completion.json
sigilc request archive --root .
```

Repeating `request create` with the same request ID/definition and frontend is
idempotent. Before creating a different request, run `request archive`: it
preserves the existing native record under `.sigil/workflow/archive/` by
fingerprint and clears the active request slot without hand-editing state.

The definition has `version`, an `id`, and ordered `items`; each item has an
`id`, a `scope` using the schema above, and optional `after` predecessor IDs.
Predecessors must appear earlier in the list. `status` recomputes the selected
native Design and Implementation gates, records bounded fingerprints and gate
evidence, and releases only terminal (`Closed`/`Converged`) predecessors. A
freshness gap leaves an item `ready`; a predecessor that has not converged leaves
it `queued`; `Drift`, Design `Disjoint`, and unavailable comparison remain visible
in the item state. The ledger is atomic, survives process restart, and is not a
worker registry, scheduler, retry system, or replacement for external
reconstruction, tests, review, or deletion evidence. Request status exits 0 when
items are queued/ready or terminal, 1 when an item is `Drift`, and 3 when native
inputs or comparison are unavailable.

Creating a request copies its structural frontend input into
`.sigil/workflow/inputs/` under its fingerprint. Default `request status` uses
that native capture, while `.sigil/tmp/<run-id>/` holds disposable exports,
preparations, attempts and reports. Passing `--frontend` deliberately evaluates
a newer structural capture.

After every item is `Closed` or `Converged`, `request record --dossier FILE`
persists one bounded completion dossier in the durable request ledger. Its
version-1 JSON contains nonempty `nativeReports`, `artifacts`, `delivery`,
`deletion`, and `checks` reference arrays plus optional `warnings` and
`overrides`. The compiler records these opaque references and the exact terminal
request/gate snapshot; it does not trust their claims as a semantic verdict. A
later `request status` clears the dossier if a source, scope, catalog, or gate
reopens the request.

Gate reports include native presentation diagnostics for editor and terminal
consumers. Design compilation returns `diagnostics`; comparison returns
Implementation `diagnostics` and retains Design findings in `design.diagnostics`.
Each contains `items` and an `omitted` count. Findings carry a code, side,
severity, message, locations and available kernel witnesses. Authored-unit
locations retain their physical ranges; assertion-source locations have no
invented code ranges. Location sides distinguish Design from Implementation.

At most 1000 findings, 8 locations per finding and 8 matching Implementation
`because` rows per disagreement are returned, with omitted counts. Contradictions
come before warnings. Full kernel tables remain available separately; truncation
never changes the named gate state. `assertion_sources` maps direct fact IDs to
contributing files on both sides. This is bounded attribution, not a complete
proof tree or an independent check of reconstruction fidelity.

Unavailable comparison includes `COMPARISON_UNAVAILABLE` and retains the Design
findings, while Implementation and comparison stay null with exit 3. Render it
as unavailable, never as a semantic warning/success state inferred from severity.
