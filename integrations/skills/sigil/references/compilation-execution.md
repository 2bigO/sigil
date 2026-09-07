<!-- @sigil implements integrations/skills/sigil/compilation-execution.sigil::SigilCompilationExecution interface,logic,constraints,cases -->

# Native compilation execution

Run from the selected workspace, or pass its absolute path with `--root` to
native commands. Use the actual installed `sigil` and `sigilc` executables.
Store disposable bundles, scopes, preparations, attempts and reports under
`.sigil/tmp/<run-id>/`. This directory is local throwaway run state; each
preparation output must be a new directory. Keep incrementally reusable state
under its native `.sigil` owner instead: worlds under `.sigil/worlds/`, request
captures and ledgers under `.sigil/workflow/`, and no run artifact under a
temporary coding-agent tracker.

## Capture and scope

```sh
sigil export design . > .sigil/tmp/<run-id>/frontend.json
sigilc scope --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json
sigilc stale design --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json
```

Create the `.sigil/tmp/<run-id>/` directory before capture. Require successful export;
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
sigilc request create --root . --frontend .sigil/tmp/<run-id>/frontend.json --definition .sigil/tmp/<run-id>/request.json
sigilc request status --root .
sigilc request record --root . --dossier .sigil/tmp/<run-id>/completion.json
```

The definition contains `version`, `id` and ordered `items`; each item contains
an existing `scope`, an `id`, optional `after` predecessor IDs and opaque
external `evidence` references. Predecessors must precede their item. The
generated `.sigil/workflow/request.json` is atomic and separate from disposable
worlds. Status exposes `ready`, `queued`, `Closed`, `Converged`, `Drift` and
`unavailable`, then persists the current native scope/input/gate identities. It
never launches, schedules or retries a worker and never treats a semantic gate
as proof of delivery, tests, review or deletion.

`request create` copies its structural frontend input to
`.sigil/workflow/inputs/<fingerprint>.json`. Default `request status` reads this
native capture, so deleting `.sigil/tmp/<run-id>/` cannot make a durable request
unavailable. Passing `--frontend` deliberately evaluates a newer capture.

When a terminal request must be replaced (for example, after temporary source
paths leave the final scope), run `sigilc request archive --root .` first. It
preserves the native request record by fingerprint and clears only the active
slot; then create the new definition. Do not copy or hand-edit the generated
ledger in a temporary tracker.

When every item is natively `Closed` or `Converged`, record the whole-loop
external proof once with `sigilc request record --dossier FILE`. The version-1
dossier carries opaque `nativeReports`, `artifacts`, `delivery`, `deletion` and
`checks` references, with optional `warnings` and `overrides`. The command saves
the request identity and exact terminal native snapshots with those references.
It rejects a nonterminal request and `request status` clears the dossier if any
item later reopens. This is evidence indexing, not an external check runner,
task state, or a hand-written semantic completion flag.

At the start of each reconstruction cycle, run native `sigilc stale` for the
selected scope. Preserve every row reported `fresh`; reprepare and respawn a
subagent only for rows reported stale, missing, or dependency-invalid.
Freshness is binding-specific: an accepted egg from another ordered Design
item may remain in the cache, but native stale decides whether it is reusable
for the current item.

## Throughput while preserving scope order

`focus_order` is the priority in which a coding agent should start and report
work. It does not require one idle subagent to wait for every unrelated source
in a released scope item. After one `stale` report, prepare each nonfresh row
in focus order into a distinct directory and **spawn a subagent** for each,
using bounded concurrency available to the harness. Workers may construct
their temporary Turtle and evidence concurrently. If the native world writer
reports lock contention, retry only that unchanged ingest call with bounded
backoff; do not rebuild its Turtle or create a second worker.

Do not start a later ordered request item until all selected rows in its
predecessor have published and `request status` has made it terminal. Report
the first nonzero ingest exit immediately with its native hint, while allowing
independent workers to continue. For a source with no supported prepared
assertion, submit a valid zero-fact Turtle directly instead of spending turns
inventing unsupported facts. This preserves observed order and gate semantics
without serializing model setup unnecessarily.

## Durable subagent invocation

This section is the durable model-facing worker contract. It remains valid when
temporary planning and run records are absent.
The coding agent must **spawn a subagent** in a fresh isolated process for each
stale, missing or dependency-invalid source. The caller keeps the preparation
directory and `job.json`; the subagent receives only the files named below and
writes a new attempt file outside the selected source tree. Capture the process
ID, exit, stdout/stderr and returned Turtle path. Do not ask `sigilc` to launch a
worker: it is deliberately a deterministic compiler and publisher.

Pass the source-specific preparation paths, matching native ingest tool
parameters and an evidence-manifest path to the subagent. Use this prompt,
substituting only those parameters and output paths:

```text
You are an independent Sigil semanticizer subagent. Reconstruct only the supplied source
from the allowed prepared inputs. Do not inspect the repository, neighboring
files, temporary plans, task state, caller messages or previous attempts. Return
only valid RDF Turtle assertions using the supplied ontology and exact prepared
identities. Do not invent identifiers, declarations, predicates or compiler
rules. Use `sigil:from` for unit ownership, `sigil:owns` for component-to-
Concept links and `sigil:hasContract` for component-to-unit links. A truthful
zero-fact Turtle result is valid when the source has no supported assertions.
Every authored unit IRI must have exactly one `rdf:type sigil:Contract`; do not
type a unit as Goal, Interface, Constraint or Case. Preserve the prepared unit
IDs and attach their section/description predicates to the Contract resource.
Write the current result to <ATTEMPT_TTL>. Before each tool call, update
version-2 JSON at <EVIDENCE_JSON>. Its `preparation`, `job`, `worker` and
`ingest` fields are single reference strings. Its ordered `attempts` records
every rejected Turtle/result reference with its actual nonzero exit, followed by
the submitted Turtle/result reference with `"exit": null`. Call the provided
matching `sigilc ingest` tool with its supplied parameters and `--evidence
<EVIDENCE_JSON>`. Native ingest persists a separate projection artifact whose
final pending record has the actual accepted exit 0 when it publishes; it does
not rewrite <EVIDENCE_JSON>. If that tool rejects the result, read
its exact error and `hint:`, replace the pending null with the observed nonzero
exit, correct only the temporary Turtle construction in <ATTEMPT_TTL>, append a
new pending attempt, and call the same ingest tool again. Keep each attempted
result and tool exit for the caller. Continue this repair loop until the matching
ingest publishes with exit 0, or report the concrete blocker.
Never edit the source, prepared JSON, caller-held job descriptor or published
projection.
```

For a Design source, the allowed prepared inputs are exactly `design.json` and
`ontology.json`. For an Implementation source, they are exactly captured
`source`, `ontology.json` and `catalog.json`. The caller passes the matching
`sigilc ingest` parameters, evidence-manifest path and unchanged caller-held
`job.json` as a tool boundary; the subagent may invoke that tool and repair only
its temporary Turtle until exit 0. The caller records every attempted Turtle,
exact tool output and exit. If the source, frontend, catalog or other bound input
changes, stop and ask the caller to recapture and prepare a fresh isolated round.
Never edit `job.json`, source bytes or published projections.

Pass the prompt and the source-specific preparation paths as parameters when you
**spawn a subagent**. The environment may provide that subagent facility in its
own way, but the invocation must preserve the same prompt boundaries, fresh
isolation, process evidence and one-to-one worker-to-ingest record. Do not call a
provider-specific or legacy launcher, and do not make the coding agent itself
the semanticizer.

## Independently reconstruct Design

```sh
sigilc prepare design --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json --source architecture/a.sigil --out .sigil/tmp/<run-id>/design-a
# Spawn a subagent with design-a/design.json and design-a/ontology.json in
# isolation, passing this matching ingest command and evidence-manifest path to
# its prompt.
# The subagent writes design-a-attempt-1.ttl and calls the tool itself; if it
# rejects, the subagent repairs that temporary file from the exact hint and
# retries until exit 0 (or reports a blocker). The caller retains job.json and
# every attempted Turtle/tool result. The next line is the tool call executed by
# the spawned subagent, not a caller-side ingestion step:
# sigilc ingest design --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json --source architecture/a.sigil --job .sigil/tmp/<run-id>/design-a/job.json --turtle .sigil/tmp/<run-id>/design-a-attempt-1.ttl --evidence .sigil/tmp/<run-id>/design-a-evidence.json
sigilc compile design --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json
sigilc entities --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json
```

Repeat preparation and ingestion for every selected stale source, including
native-added dependencies. The native ontology and prepared Design JSON define
available identity and assertion forms. Keep new domain entity declarations with
their owning physical source; reference foreign identities without redeclaring
them. Do not invent assertions merely to make a gate pass. The compiler validates
syntax, binding and fixed laws; it cannot establish worker fidelity by itself.
The coding agent must spawn a subagent in the background for each source and pass
the exact prompt plus matching ingest-tool parameters. The subagent itself runs
the accept/reject loop: it uses the native error and `hint:` to repair only its
temporary Turtle and calls ingest again until exit 0 publishes the projection or
it reports a concrete blocker. Retain the process/job record, every attempted
Turtle, matching source/job descriptor and each ingest command/exit. Preparation
alone is not a worker observation; only the accepted exit-0 ingest that publishes
the projection closes the source round. Reprepare and start a fresh isolated
round when a bound input changes; never mutate source bytes, prepared JSON,
`job.json` or a published projection.

## Independently reconstruct Implementation

A current provisional or authoritative Design catalog is required. Each
Implementation worker receives exactly three inputs: `source` (captured unchanged
bytes), `ontology.json`, and `catalog.json` from its preparation. Do not supply
Design prose or relationships, neighboring code or unrelated caller state. The
matching ingest parameters are a tool boundary used only by the prompt-driven
repair loop.
A subagent's self-description is not an independent reconstruction.

```sh
sigilc prepare implementation --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json --source src/main.rs --out .sigil/tmp/<run-id>/implementation-main
# Spawn a subagent with only source, ontology.json and catalog.json, passing the
# matching ingest command and evidence-manifest path to its prompt. It writes an attempt,
# invokes the tool itself, repairs its temporary Turtle from each exact hint and
# retries until exit 0 (or reports a blocker). Caller retains job.json and every
# attempted Turtle/tool result. The next line is the tool call executed by the
# spawned subagent:
# sigilc ingest implementation --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json --source src/main.rs --job .sigil/tmp/<run-id>/implementation-main/job.json --turtle .sigil/tmp/<run-id>/implementation-main-attempt-1.ttl --evidence .sigil/tmp/<run-id>/implementation-main-evidence.json
sigilc stale implementation --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json
sigilc compile implementation --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json
sigilc compare --frontend .sigil/tmp/<run-id>/frontend.json --scope .sigil/tmp/<run-id>/scope.json
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
