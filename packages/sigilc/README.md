# sigilc

`sigilc` is the native Sigil compiler and computed design checker. It reads
workspace sources, accepts externally interpreted data-only egglog rows, and
links stored readings to report coherent, loose, disjoint or incomplete designs.
The tool never launches models or workers.

Build with Rust 1.91.1 or newer:

```sh
cargo build --locked --manifest-path packages/sigilc/Cargo.toml
```

`--root DIR` names the workspace (default `.`); `--store DIR` names the store
(default `<root>/.sigil`). The tool reads workspace configuration, glossary and
design sources directly.

```sh
sigilc prepare --root . --source architecture/a.sigil --out reading-a
# An external interpreter reads reading-a and writes answer.egg.
sigilc ingest --root . --binding reading-a/binding.json --claims answer.egg
sigilc check --root .
sigilc extract-guidance --root . --out /tmp/sigil-guidance
```

Prepare asks only for stale or unread units. The binding captures the source,
imported interfaces, vocabulary and guidance. Ingest refuses mismatched inputs
and records admitted readings under `claims/interpretations/`. Check links all
stored readings and runs the design laws. `check --source PATH` narrows the
reported findings while checking completeness across the workspace.

Design reports have version 6. Exits are 0 for coherent or loose, 1 for disjoint
or incomplete and refused readings, 2 for usage, and 3 for operational failure.
Reports and judgment contexts live under `claims/` in the chosen store.

## Trees, content ids, and dependencies

`sigilc` turns each `.sigil` file into a content-addressed tree: components,
sections, and Facets, each with an id made from its content. A Facet id is
`facet:<hash>`; it does not change when the file is reformatted or when
unrelated text moves, and it changes when the Facet's meaning changes. Callers
that need a unit or entity id read it from `sigilc tree`.

```sh
sigilc tree --root . [--source PATH] [--diff]
```

`tree` prints the resolved trees as deterministic JSON: per source, its
components, interface Tags, resolved Tags with their IRIs, and Facets with
ranges, prose, and links. `--diff` lists the Facets added, removed, and changed
since the previous tree recorded for each source.

A dependency is presented to its importers by its interface only. A component
sees what a provider declares in its `interface` section and nothing from the
provider's private sections or logic. A flow that crosses components must
therefore be stated in the dependency's interface; editing a dependency's
private sections does not change its importers.

`sigilc clean` removes generated `worlds/` and `trees/` caches from the store,
preserving stored claims readings, authored sources, configuration and caller
preparations. Version 0.3.0 retires Turtle worlds and their commands.

## Implementation alignment

`sigilc align` reads its code selection from `tools.sigilc.implementation`:

```json
{
  "tools": {
    "sigilc": {
      "implementation": {
        "dirs": ["src"],
        "include": ["**/*.rs"],
        "exclude": ["**/generated/**"],
        "vendorDirs": ["vendor"],
        "allowEmpty": false,
        "design": ["booking.sigil"]
      }
    }
  }
}
```

This fragment belongs in the workspace config, or in `.sigil/local.json`.
Local configuration contains only `tools`; its objects merge recursively into
workspace tool settings, while arrays and scalars replace the workspace values.
All paths remain relative to the workspace root.

The implementation namespace is required for alignment. `sigilc` rejects unknown
keys in its namespace, including unknown implementation fields. Core continues
to validate only the tools' object shape. The selection fields are optional:

- `paths`: explicit file paths; defaults to `[]`.
- `dirs`: directory trees; defaults to `[]`. With no paths or directories,
  discovery starts at the workspace root.
- `include`, `exclude`: file globs; default to `[]`. An empty include list accepts
  every file. Exclude patterns remove files in configuration order; a later
  overlapping pattern counts only files earlier patterns have not removed.
- `vendorDirs`: directory trees excluded from discovery; defaults to `[]`.
- `allowEmpty`: permits a selection with no code units; defaults to `false`.
- `design`: non-empty list of unique design source roots. Roots expand through
  required imports and owners using the design scope closure. Omit it to judge
  the whole workspace design. Components outside the closure are listed in the
  report and their promises are outside the implementation check.

Path and glob fields are arrays of non-empty strings. Discovery always excludes
the internal `.sigil`, `.git`, `.deno`, `node_modules`, `build`, `target`, and
`coverage` trees. Workspace design sources encountered inside the selection are
auto-excluded and listed separately from user exclude patterns. Symlinks are
skipped and listed, including linked directories whose contents cannot safely be
checked against include globs. Design auto-exclusions happen before user exclude
counts. Zero-byte files are listed but are not units. Non-UTF-8 files
and files over the presentation byte limit are listed as unpresentable and keep
the implementation check Incomplete until the user excludes them.

The full design check still gates alignment.

```sh
sigilc align prepare --root . --out code-readings
# A fresh external reader supplies each requested file's answer.egg.
sigilc align ingest --root . --binding code-readings/FILE/binding.json --claims answer.egg
sigilc align check --root .
sigilc extract-guidance --implementation --out /tmp/sigil-code-guidance
```

Each file is captured whole. Rows describe elements, actions and measures;
`realizes` maps elements to presented design names. Annotations are not evidence.
Unread or unpresentable files keep the result Incomplete. Otherwise breaches,
undesigned files/elements and unanswered promises produce Drift. Clean code
returns Closed for a coherent design or Converged for a loose one. Closed and
Converged exit 0; Drift and Incomplete exit 1. Usage exits 2 and operational
failures exit 3. Version-1 reports and contexts live at `claims/workspace.align.json`
and `claims/workspace.align.context.json`; readings live in `claims/implementation/`.

Use [sigil-compute-design](../../skills/sigil-compute-design/SKILL.md)
and [sigil-compute-align](../../skills/sigil-compute-align/SKILL.md)
for the interpretation loops and guarded write-back.
