<!-- @sigil implements integrations/skills/sigil/compilation-execution.sigil::SigilCompilationExecution interface,logic,constraints,cases -->

# Native compilation execution

Run from the selected workspace, or pass its absolute path with `--root` to
native commands. Use the actual installed `sigil` and `sigilc` executables.
Store captured bundles, scopes, preparations and reports outside selected source
scope. The paths below are illustrative external paths; each preparation output
must be a new directory.

## Capture and scope

```sh
sigil export design . > /tmp/sigil-run/frontend.json
sigilc scope --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
sigilc stale design --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
```

Create the external run directory before capture. Require successful export;
never pass empty or partial output on to native commands. Regenerate the bundle
after changing authored files, imports, config or glossary. Export captures the
whole workspace; native scope selects focus. For example:

```json
{
  "version": 1,
  "design": { "paths": ["architecture/a.sigil", "architecture/b.sigil"] },
  "implementation": { "dirs": ["src"], "vendorDirs": ["vendor"] }
}
```

Design paths are ordered roots. Read `scope.design.focus_order`; native scope
preserves explicit priorities and appends import/owner dependencies with reasons.
Order and unordered membership have separate fingerprints. Reordering alone does
not invalidate unchanged semantic bindings. Do not maintain a second comparison
priority or membership table. Scope is not a task scheduler or completion queue.

Implementation selection supports `paths`, `dirs`, `include`, `exclude`,
`vendorDirs` and `allowEmpty`. Paths are workspace-relative; glob filters use
`*`, `**` and `?`. Empty paths/dirs select the eligible workspace, not nothing.
Intentional empty selection requires explicit exclusion and `allowEmpty`.
Use the same `--scope` on all operations below; do not combine it with
`--selection` or top-level `--allow-empty`. Without a paired scope, native
Implementation inspection/comparison requires `--selection FILE`.

## Independently reconstruct Design

```sh
sigilc prepare design --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json --source architecture/a.sigil --out /tmp/sigil-run/design-a
# External worker receives design-a/design.json and design-a/ontology.json.
# Caller retains design-a/job.json. Worker returns ordinary Turtle in design-a.ttl.
sigilc ingest design --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json --source architecture/a.sigil --job /tmp/sigil-run/design-a/job.json --turtle /tmp/sigil-run/design-a.ttl
sigilc compile design --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
sigilc entities --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
```

Repeat preparation and ingestion for every selected stale source, including
native-added dependencies. The native ontology and prepared Design JSON define
available identity and assertion forms. Keep new domain entity declarations with
their owning physical source; reference foreign identities without redeclaring
them. Do not invent assertions merely to make a gate pass. The compiler validates
syntax, binding and fixed laws; it cannot establish worker fidelity by itself.

## Independently reconstruct Implementation

A current provisional or authoritative Design catalog is required. Each
Implementation worker receives exactly three inputs: `source` (captured unchanged
bytes), `ontology.json`, and `catalog.json` from its preparation. Do not supply
Design prose or relationships, neighboring code, job.json or repair feedback.
A coding worker's self-description is not an independent reconstruction.

```sh
sigilc prepare implementation --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json --source src/main.rs --out /tmp/sigil-run/implementation-main
# External worker returns implementation-main.ttl; caller retains job.json.
sigilc ingest implementation --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json --source src/main.rs --job /tmp/sigil-run/implementation-main/job.json --turtle /tmp/sigil-run/implementation-main.ttl
sigilc stale implementation --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
sigilc compile implementation --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
sigilc compare --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
```

Capture and reconstruct changed inputs after another coding round. Ingest the
worker's completed zero-fact result when appropriate; missing output is different
from completed empty output. Neither proves that required behavior was delivered.
Do not weaken scope to obtain a better result.

## Interpret the actual command

| Command | Exit 0 | Exit 1 |
| --- | --- | --- |
| `compile design` | Coherent (green), Loose (yellow with warnings) | Disjoint (red) |
| `compile implementation`, `compare` | Closed (green), Converged (yellow with warnings) | Drift (red) |
| `stale` | Selected inputs fresh | Freshness work remains |
| `entities` | Current catalog available, possibly provisional | Catalog unavailable |
| `scope` | Inspection completed | No semantic gate meaning |

Exit 2 means invalid usage. Exit 3 means runtime/input failure or an unavailable
comparison prerequisite. An unavailable comparison can return explanatory JSON
with Implementation and comparison unset; preserve that explanation without a
color. Check named states, diagnostics, attribution and omitted counts alongside
exit status. Cancellation, truncated output and stale reports are not verdicts.

Record the command, executable/version, input identities, exit, report and
stderr. Diagnose failures before retrying; no fixed retry count makes missing
inputs available. Never replace a process merely because it is slow.

`.sigil/worlds/` is an ignored disposable cache. `sigilc clean --root DIR` removes
its generated worlds while preserving sources and external preparations. Use it
when discarding generated state is intended, then reconstruct required inputs.
