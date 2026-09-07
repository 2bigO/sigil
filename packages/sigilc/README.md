# sigilc

The standalone Rust compiler validates externally produced Turtle and derives
Design from disposable per-source projections. It never launches a model.

Build with Rust 1.91.1 or newer:

```sh
cargo build --locked --manifest-path packages/sigilc/Cargo.toml
```

The current Design commands consume the versioned structural JSON produced by
`packages/compiler/src/design-input.ts::loadDesignInput`. Pass that bundle with
`--frontend`. The compiler checks its captured source/config/glossary bytes
against `--root` (default `.`). Regenerate the bundle after authored changes.
The TypeScript CLI integration is still being implemented.

```sh
sigilc ontology --format json
sigilc prepare design --frontend frontend.json --source architecture/a.sigil --out job-a
# Give job-a/design.json and job-a/ontology.json to an external Design worker.
# The caller retains job-a/job.json; the worker returns ordinary Turtle.
sigilc ingest design --frontend frontend.json --source architecture/a.sigil --job job-a/job.json --turtle result.ttl
sigilc stale design --frontend frontend.json
sigilc compile design --frontend frontend.json
sigilc entities --frontend frontend.json
```

`--out` must name a new directory. Do not place prepared inputs in selected
source scope. Preparation can replace an already-fresh projection through a new
job, but duplicate jobs cannot overwrite an accepted generation. `--turtle -`
reads standard input. The generated `.sigil/worlds/` cache is ignored and
can be discarded. `sigilc clean [--root DIR]` removes generated worlds even
when the index is corrupt, retaining only the writer lock file. It preserves
sources, config and external preparations. Descriptors and external worker orchestration are not stored
in a compiler job registry.

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
sigilc ingest implementation --frontend frontend.json --source src/main.rs --job job-main/job.json --turtle implementation.ttl
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
