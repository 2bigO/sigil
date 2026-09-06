# Semantic Worlds implementation and replacement loop

This is the external agent's working procedure for implementing [compile.md](compile.md).
It is not a Sigil feature, harness runtime, scheduler, or new compiler protocol.
The user supplies an absolute `STATE_DIR`; until Sigil can replace the temporary
tracking mechanisms, that folder is the resumable operational state.

The objective is to implement the entire agreed refactor, use each usable new
capability on subsequent real work, retire the temporary tracking mechanisms,
and finish with at least `Converged` Implementation across the complete scope.
`Closed` is welcome but not required. Do not expand proof or language-analysis
scope just to obtain it.

## Completion means delivery plus semantic convergence

`Converged` alone is insufficient: missing implementation or empty Turtle can
produce yellow. Never translate yellow into “implemented.” Keep two independent
questions visible throughout the loop:

* Delivery: which required behaviors, deletions, integrations, and acceptance
  cases are implemented and checked against the current sources?
* Semantics: what do independently reconstructed current worlds establish,
  contradict, or leave unknown under the fixed kernel?

Complete the loop only when the final gate below passes. An ordinary iteration
may finish with unfinished work; that is a checkpoint, not completion.

## Sources of authority

`compile.md` defines the refactor's scope and constraints. Authored `.sigil`
files express the corresponding Design in the language; actual source expresses
Implementation. Update governing contracts as the refactor changes behavior.
Do not use the old accepted-world/receipt workflow as the new authority.

`track.md` defines this external procedure. Temporary JSON, coding-agent claims,
test reports, and generated worlds cannot amend Design by themselves. Compile
status cannot prove tests passed or authorize a deployment.

The installed skill may describe the old architecture. Use its applicable
inspection guidance, but follow the user's authorized refactor and updated
repository-owned contracts/instructions where they supersede the old workflow.
Record whether glossary work is needed; do not create vocabulary work merely to
make the loop more elaborate.

## Bootstrap state: small, inspectable, disposable

Initialize only the user-selected folder. If it already contains a run, resume
it; do not overwrite it. Preserve existing staged and unstaged repository changes.
Record the starting revision and working-tree diff so later deletion measurements
do not claim the user's prior work. Small incremental commits for this refactor
are authorized and required. Publishing, pushing, and deployment are not.

Start with this layout; add a file only when actual use needs it:

```text
STATE_DIR/
  state.json          current scope, delivery work, replacements, checkpoint
  journal.jsonl       compact iteration and decision records
  artifacts/          captured checks, reports, baseline, usable tool builds
  queries.py          optional small standard-library inspection helper
```

Keep state outside selected implementation sources and worker inputs. If the
folder is inside the repository, explicitly exclude it as operational artifacts;
do not exclude actual product source to improve the result. Do not add a tracked
task-framework package, database, daemon, provider adapter, or UI. Plain JSON,
shell, and short Python queries are enough. Use atomic replacement for `state.json`.

Minimum state fields:

| Field | Content |
| --- | --- |
| `version`, `cycle`, `phase` | Small file format version and resumable position. |
| `baseline` | Initial source revision/diff, original plan hash, inventory and count method. |
| `current_spec` | Current `compile.md`, `track.md`, authored scope and selection identities. |
| `scope` | Stable requirement IDs, exact plan references, owning Design components, acceptance cases, and required implementation selection. |
| `work` | Requirement ID, dependencies, delivery state, relevant files, check evidence, and remaining issue. |
| `replacements` | Temporary mechanism, intended Sigil replacement, adoption state and real-use evidence. |
| `tools` | Last usable local compiler/frontend executable paths and build/source identities. |
| `checkpoint` | Last completed action, next useful action, blockers and artifact paths. |

Use delivery states `pending`, `active`, `verified`, `blocked`. A checked
requirement becomes pending again when a relevant change invalidates its evidence.
Record removed/replaced requirements as historical changes, not “verified” work.
These are external bookkeeping states, not new Sigil ontology predicates.

Build the initial inventory from all of `compile.md`, including preservation,
packaging, mandatory removals, and acceptance cases. Group work by coherent
behavior and dependency; do not treat every heading as a separate component or
force one component to equal one file. Link every required item to authored
Design as it is written. Do not silently omit difficult requirements.

Queries should initially answer only:

```text
What remains, and what can be done next?
What changed since the last verified snapshot?
What is blocked, and why?
Which temporary mechanism can the new tools replace now?
What evidence is still required for the final gate?
```

Report counts of verified/active/pending/blocked requirements, acceptance checks,
fresh/stale/missing projections, and adopted replacements separately. If a
percentage is useful, label its denominator: `verified delivery items / current
required items`. It is an inventory ratio, not an estimate of effort or semantic
completeness. Report additions/removals since baseline alongside it.

## Each iteration

1. Resume from the checkpoint. Read changed plans, governing contracts and code;
   inspect repository state and reconcile changed scope/evidence. Check which
   newly materialized commands actually work. Never invent a command from an
   example in the plan or treat an unavailable binary as an installed capability.
2. Select the smallest coherent dependency-ready increment that advances the
   refactor or replaces a temporary mechanism. Give the coding environment the
   whole current human-readable specification, plus the immediate task and
   observations from completed previous cycles. Scope selection does not turn
   coding into semantic-slice or receipt-driven implementation.
3. Implement the increment, including governing `.sigil`, focused tests and
   callers. Use the mandatory-removal list to delete obsolete machinery when its
   retained behavior has a replacement. Do not carry a compatibility framework.
4. Run checks appropriate to the change. Use fixed Turtle fixtures to test the
   compiler; distinguish those from independent reconstruction of actual code.
   Record exact commands, exits, source identity, and meaningful evidence.
5. Build and exercise the new capability on this repository's actual next work.
   Run it as soon as usable, starting within the same iteration if practical and
   making it the default in the next applicable iteration. A passing toy fixture
   alone is not successful dogfooding. Record what it replaced and what real
   question it answered.
6. Prepare independent reconstruction when the needed pipeline exists. Refresh
   Design, expose the current Loose/Coherent catalog, prepare target files,
   obtain independent Turtle externally, ingest, and compare. Before the full
   pipeline works, record “semantic status unavailable”; do not fabricate yellow
   from tracker state. Missing external-worker facilities are a concrete blocker
   for independent verification, not a reason to build an agent runtime in Sigil.
7. End the coding portion before examining that round's blind reconstruction
   results. Collect current reports, failures and unknowns; decide the next
   increment or evidence-backed plan correction. A repair starts another coding
   round and needs new independent reconstruction for changed inputs.
8. Update the checkpoint and journal, then continue. Do not stop merely because
   one component, milestone or iteration passed. Pause only on a real external
   blocker or a user decision that prevents useful authorized progress.

Commit completed coherent increments throughout these steps, not at the end of
the refactor. An iteration can contain several commits; a cycle boundary is not
a reason to bundle unrelated work. Record each commit ID with its requirement
IDs and check evidence in the operational journal.

## Small commits by semantic change

Commit all tracked repository changes related to the refactor incrementally,
including source, tests, authored contracts, plan corrections, docs and relevant
configuration. Keep operational state and disposable worlds out of commits.

Each commit should have one explainable purpose: for example, restricted Turtle
ingestion and its tests, a source-freshness rule and its contract, or removal of
one obsolete subsystem and its callers. Include the directly related tests and
documentation needed to review that behavior. Do not divide commits mechanically
by extension or separate a behavior from the test that explains it.

Prefer tens to a few hundred changed lines where practical. If a proposed commit
is large or its message needs several independent clauses, split the work into
smaller reviewable increments before committing. Do not use the full phase or
entire refactor as a commit unit. A pure move or cohesive subsystem deletion may
be larger; keep it separate from unrelated behavior and explain that in the
journal. Do not artificially split tightly coupled changes into broken commits.

Before each commit, run the applicable checks, inspect the exact diff, and stage
only intended paths/hunks. Review what will actually be committed, including
pre-existing staged changes. Preserve unrelated work and index entries; do not
use blanket staging or commit-all commands. Related user-authored changes may
be included only when they belong to the commit's stated purpose, with their
baseline provenance recorded rather than claimed as newly implemented work.

Use concise messages naming the resulting behavior. Keep plan-only requirement
corrections separate when they are useful to review independently; include their
supporting evidence in the journal. Do not squash away incremental history or
amend the user's commits. Do not push or publish without separate authorization.
At handoff, report any remaining refactor changes that could not be committed
and why; do not silently leave a final giant uncommitted batch.

Each journal entry needs only the iteration, changed requirement IDs, evidence
paths, real-use finding, replacement adoption/reversion, plan changes, and next
action. Logs are history, not a second semantic authority.

## Independence and self-hosting without circular proof

The external coding environment owns workers and their scheduling. Do not build
that environment into this repository. Where available, use independent workers
with no coding-conversation history and enforce the allowed input boundary.
Do not claim isolation if tools or inherited instructions expose the checkout.

An Implementation worker receives exactly target bytes, fixed ontology and the
frozen Design entity catalog. It gets no `compile.md`, `track.md`, state folder,
neighbor code, Design relationships, obligations, symbol maps or coder reasoning.
Use the semanticizer instructions in `compile.md`, including the rule that name
similarity alone is insufficient. One file produces only its direct assertions.
Freshness contains no model/prompt/producer metadata.

An external environment can run reconstruction while coding continues. It keeps
current blind outputs inaccessible to the coder and publishes only through the
compiler's captured-source/catalog checks. Results may be reviewed after that
coding round ends. Previous results are not supplied to a new semanticizer.
If the environment cannot enforce this, report the limitation and obtain a
suitable external workflow before declaring the final independent result.

Bootstrap with existing deterministic language tools and ordinary tests. Once a
new local `sigilc` build passes its relevant fixtures and real-use check, retain
its executable under operational state as the last usable build. Use it while
editing its own sources. Identify the actual executable and kernel used in each
report; that run identity is not LLM provenance in projection freshness.

A candidate compiler is promoted after applicable regression tests and a real
repository operation pass. Retaining one previous executable for recovery is
external operational state, not shipping the obsolete bridge or a dual product
architecture. If a new tool fails, record the failure, use the last usable
capability or the smallest temporary fallback, and repair it next. No silent
fallback, automatic downgrade of laws, or old green report counts as current.

Self-compilation is a regression test, not proof of the compiler's correctness.
Keep fixed positive/negative fixtures, independent source reconstruction, and
ordinary build/test checks. Finish with the final built tools, not merely an
earlier working snapshot. A compiler change requires re-running affected compiler
tests and comparisons even when source-local projection reuse remains valid.

## Replace mechanisms, not the external agent

Use states `temporary → trial → adopted → retired` for replacement bookkeeping.
Adoption requires a real repository operation and use on the next applicable
increment. Revert explicitly on failure. Retire the corresponding custom query
once native output is the default; do not maintain two verdict implementations.

| Temporary mechanism | Replacement to use as soon as available |
| --- | --- |
| Manually assembled source/contract inventory | Existing Sigil frontend resolution and the minimal authored-unit inventory; `.sigil` owns the required Design. |
| Ad hoc target-change/freshness queries | `sigilc` preparation, snapdir-backed source identity, projection index and stale inspection. Do not add neighbor dependencies. |
| Manually combined Turtle/fact files | Native validated ingestion and mirrored per-file disposable `.egg` assembly. |
| Hand-maintained semantic identity list | Provisional/authoritative frozen Design catalog from current non-Disjoint Design. |
| Python joins answering “what is missing or disagrees?” | Native independent D*/I* comparison, obligations and current diagnostics. |
| Tracker-maintained component semantic colors | Native overall report plus diagnostics attributed to governing components; no invented component status algorithm. |
| Bespoke operational work queue | External agent reads current Sigil diagnostics, remaining acceptance/check results, and the whole specification to choose work. No product task scheduler. |

The last row does not mean Sigil decides that code was delivered merely because
it is yellow. Compiler semantic status and external acceptance checks remain
distinct. Retire the ongoing hand-maintained delivery queue only after its
requirements are reconciled with authored Design, all delivery items are checked,
and the final audit preserves the evidence. Ordinary tests and external coding
do not need replacement by Sigil.

No new percent-complete command, task ontology, component dashboard, obligation
receipt or tracker migration API is needed. Use existing/new deterministic outputs
specified by `compile.md`; presentation in this folder can be disposable queries.

## The loop and requirements may evolve from real use

The agent is authorized to edit this procedure and `compile.md` in response to
observed implementation and dogfooding findings. Routine sequencing changes,
removal of needless work, corrected assumptions and better bounded designs do
not require a permission round trip. Update related authored contracts/tests too.

For each substantive change, record:

```text
Observed evidence: exact failed command, awkward real operation, or code finding
Old requirement/procedure and new wording
Why the change improves the original objective and its tradeoff
Requirements added/replaced/removed, with stable IDs
Evidence/worlds/checks invalidated and the next real-use validation
```

Keep the baseline and previous revisions/diffs in operational history. A removed
requirement leaves the current denominator but is reported separately from
implemented work. Reconcile both plans before selecting more work; do not let
one silently supersede a conflicting requirement in the other. Rebuild affected
Design projections/catalog and compare using the changed scope as appropriate.

Do not weaken a requirement solely because it failed, relabel unfinished work
as epistemically unknown, exclude difficult files, remove valid failing tests,
or edit the kernel to manufacture completion. A correction needs a reason
independent of improving the current verdict. If a change would abandon the user's
objective or overturn an explicit architectural invariant, present that decision
to the user; keep progressing on independent authorized work where possible.

## Final gate and tracker retirement

All of the following must hold for the same final scope and current sources:

1. Every required scope item is implemented and its applicable acceptance checks
   pass. Mandatory removals, preserved CLI/language behavior, distribution and
   platform requirements are audited. Known unimplemented behavior, unrun required
   checks, unavailable required platforms or runtime errors block completion.
   Related repository changes are committed in the small semantic increments
   above; unrelated user changes remain preserved.
2. Current Design is non-Disjoint. Every selected Implementation file has a fresh
   independent reconstruction, including a recorded completed zero-fact result
   where appropriate. Fresh empty output does not establish delivery or excuse
   missing functionality.
3. The final native comparison completes with `Converged` or `Closed` for the
   complete refactor scope. Every governing component is accounted for through
   the scope-to-Design inventory and native obligation/diagnostic attribution.
   Check the global result too; isolated green components cannot hide cross-file
   disagreement. No manual absence-of-diagnostics color is substituted for a
   missing native result.
4. Remaining yellow findings are enumerated and explained as limits of evidence
   or intentionally unresolved Design, not known missing implementation. They may
   remain unresolved; do not invent facts or force `Closed`. Any discovered
   concrete delivery gap returns to the work queue.
5. Each applicable temporary mechanism has been replaced and used on later real
   work. No active custom script decides semantic status or freshness. The final
   binaries, not the legacy engine, produced the evidence.
6. Perform a retirement rehearsal: start a fresh external session without the
   temporary `work`/`replacements` state or custom queries. Using only the current
   plans, authored `.sigil`, code, ordinary checks and native Sigil commands, it
   must recover the required scope, current unknowns and semantic status. No new
   implementation is required in this rehearsal. Where tools are blind, disclose
   that rather than claiming the tracker was replaced.

Archive the temporary queue/query scripts and final audit within `STATE_DIR`;
leave them inactive and recoverable. Do not delete the user-supplied folder.
Sigil's own worlds remain disposable. Archive evidence may explain history but
does not establish future freshness. External scheduling, tests, and approval
remain outside Sigil; replacing them is not this loop's objective.

Final response: report delivered scope and scope changes, native Design and
Implementation results, remaining yellow findings, acceptance/platform checks,
mechanisms retired with real-use examples, any non-replaced mechanism and why,
net deletion, and reproducible commands/tool identities. If the gate is blocked,
report the concrete blocker and checkpoint instead of declaring success.

## Initiation prompt

Replace the placeholder with the actual absolute state folder:

```text
Implement compile.md following the complete loop and rules in track.md.
Use <ABSOLUTE_STATE_DIR> as persistent state; initialize or resume it.
Implement, dogfood, and replace temporary tracking until track.md's final gate
passes. Revise either document when real-use evidence warrants it, following
track.md's change rules. Make small, semantically cohesive commits throughout.
Preserve unrelated work. Keep independent semanticization and orchestration
external. Continue across milestones; checkpoint genuine blockers. Do not push,
publish, or deploy without separate authorization.
```

Append environment-specific installation authorization or credentials directly
to the initiation message, not to this repository document or operational logs.
