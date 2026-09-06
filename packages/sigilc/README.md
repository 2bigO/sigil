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
can be discarded. Descriptors and external worker orchestration are not stored
in a compiler job registry.

New Design domain entities have the IRI
`urn:sigil:entity:<encodeURIComponent(source path)>:<encodeURIComponent(local name)>`.
Declare one ontology type and one nonempty label in the owning file. Reference
foreign identities without redeclaring them. The frontend reserves Component,
Concept and authored-unit identities. Units never enter the worker catalog.
Labels retain RDF datatype and language. Catalog aliases come only from the
language frontend, not model assertions. Identity matching alone does not prove
that a worker described the source faithfully.

Reports are JSON. `compile design` returns exit 0 for Coherent and 1 for Loose
or Disjoint; `stale` returns 1 if work remains. `entities` returns exit 0 with a
provisional or authoritative catalog, or 1 with no catalog when Design is stale
or Disjoint. Invalid options return 2. Input/I/O/runtime failures return 3 and
no completed report. `--limits FILE` on compile/entities reads the closed native
limits schema; `--allow-empty` explicitly permits and reports an empty Design
scope. Neither is a model configuration option.

Implementation commands and the final comparison CLI are still being integrated.
The library already provides isolated Implementation closure and comparison;
those primitives are not a current repository verification result.
