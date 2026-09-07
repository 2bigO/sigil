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

For several ordered scope items, persist the request once and let native status
derive release from explicit predecessors:

```sh
sigilc request create --root . --frontend /tmp/sigil-run/frontend.json --definition /tmp/sigil-run/request.json
sigilc request status --root .
```

The definition contains `version`, `id` and ordered `items`; each item contains
an existing `scope`, an `id`, optional `after` predecessor IDs and opaque
external `evidence` references. Predecessors must precede their item. The
generated `.sigil/workflow/request.json` is atomic and separate from disposable
worlds. Status exposes `ready`, `queued`, `Closed`, `Converged`, `Drift` and
`unavailable`, then persists the current native scope/input/gate identities. It
never launches, schedules or retries a worker and never treats a semantic gate
as proof of delivery, tests, review or deletion.

At the start of each reconstruction cycle, run native `sigilc stale` for the
selected scope. Preserve every row reported `fresh`; reprepare and respawn a
subagent only for rows reported stale, missing, or dependency-invalid.
Freshness is binding-specific: an accepted egg from another ordered Design
item may remain in the cache, but native stale decides whether it is reusable
for the current item.

## Independently reconstruct Design

```sh
sigilc prepare design --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json --source architecture/a.sigil --out /tmp/sigil-run/design-a
# Spawn a subagent with design-a/design.json and
# design-a/ontology.json in isolation. Caller retains design-a/job.json.
# Worker returns ordinary Turtle in design-a-attempt-1.ttl.
sigilc ingest design --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json --source architecture/a.sigil --job /tmp/sigil-run/design-a/job.json --turtle /tmp/sigil-run/design-a-attempt-1.ttl
# If ingest rejects: capture its exact stderr/exit and give the coding agent
# an actionable repair prompt. It starts a fresh isolated worker from the same
# prepared inputs and writes design-a-attempt-2.ttl; never edit Turtle/job.json.
sigilc ingest design --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json --source architecture/a.sigil --job /tmp/sigil-run/design-a/job.json --turtle /tmp/sigil-run/design-a-attempt-2.ttl
# Repeat worker -> ingest with a new attempt record until exit 0 publishes.
sigilc compile design --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
sigilc entities --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
```

Repeat preparation and ingestion for every selected stale source, including
native-added dependencies. The native ontology and prepared Design JSON define
available identity and assertion forms. Keep new domain entity declarations with
their owning physical source; reference foreign identities without redeclaring
them. Do not invent assertions merely to make a gate pass. The compiler validates
syntax, binding and fixed laws; it cannot establish worker fidelity by itself.
The coding agent must spawn a subagent in the background for each source and retain
the process/job record, every returned Turtle path, matching source/job descriptor
and each `sigilc ingest` command/exit for each source. A rejection is an actionable
prompt to the coding agent, which repairs its temporary construction and starts a
fresh worker attempt from the same prepared inputs. Do not pass repair feedback,
neighboring files, or caller descriptors into the worker. Do not hand-edit a
returned Turtle or mutate its job descriptor. Preparation alone is not a worker
observation; only the accepted exit-0 ingest that publishes the projection closes
the source round. Retain the worker's isolation and process evidence.

## Independently reconstruct Implementation

A current provisional or authoritative Design catalog is required. Each
Implementation worker receives exactly three inputs: `source` (captured unchanged
bytes), `ontology.json`, and `catalog.json` from its preparation. Do not supply
Design prose or relationships, neighboring code, job.json or repair feedback.
A subagent's self-description is not an independent reconstruction.

```sh
sigilc prepare implementation --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json --source src/main.rs --out /tmp/sigil-run/implementation-main
# Spawn a subagent to return implementation-main-attempt-1.ttl;
# caller retains job.json.
sigilc ingest implementation --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json --source src/main.rs --job /tmp/sigil-run/implementation-main/job.json --turtle /tmp/sigil-run/implementation-main-attempt-1.ttl
# On rejection, send the exact native error to the coding agent as an
# actionable repair prompt. It starts a fresh worker from the same three
# allowed inputs and writes implementation-main-attempt-2.ttl.
sigilc ingest implementation --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json --source src/main.rs --job /tmp/sigil-run/implementation-main/job.json --turtle /tmp/sigil-run/implementation-main-attempt-2.ttl
# Repeat worker -> ingest until exit 0 publishes, recording every attempt.
sigilc stale implementation --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
sigilc compile implementation --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
sigilc compare --frontend /tmp/sigil-run/frontend.json --scope /tmp/sigil-run/scope.json
```

Capture and reconstruct changed inputs after another coding round. Ingest the
worker's completed zero-fact result when appropriate; missing output is different
from completed empty output. A rejection loop repairs the coding agent's temporary
construction, not the source, job descriptor or Turtle by hand. If the native
error cannot be made actionable or the worker remains unable to produce an accepted
projection, preserve all attempts and record the blocker; do not bypass ingest.
Neither accepted ingestion nor a green/yellow gate proves that required behavior
was delivered. Do not weaken scope to obtain a better result.

The reconstruction gate stays open until `.sigil/worlds/index.json` and every
selected Design and Implementation `.egg` are present and fresh according to
native stale reports, and a real coding-agent run proves the worker spawn and
matching ingestion interaction. A lock-only or otherwise empty worlds directory,
fixtures, preparation output, or manually authored Turtle cannot advance the
request to the next task.

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
