# Semantic Worlds implementation and replacement loop

This is the external agent's working procedure for implementing [compile.md](compile.md).
It is not a Sigil feature, harness runtime, scheduler, or new compiler protocol.
The user supplies an absolute `STATE_DIR`; until Sigil can replace the temporary
tracking mechanisms, that folder is the resumable operational state.

The objective is to implement the entire agreed refactor, use each usable new
capability on subsequent real work, retire the temporary tracking mechanisms,
and finish with at least `Converged` Implementation across the complete scope.
Large net code removal is an explicit delivery goal. Delete the entire
TypeScript compiler package and its adapters; do not substitute a thin native
compiler wrapper or compatibility layer. Frontend guidance directs the model
to invoke `sigilc` itself.
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

Gate exits are specific to the command: Design Coherent/Loose and Implementation
Closed/Converged exit 0; Design Disjoint and Implementation Drift exit 1. Green
and yellow share success; preserve the named state and warnings in observations.
Usage (2), operational or unavailable comparison (3), and inspection exits do not
represent semantic colors. Exit zero alone never verifies delivery or deletion.

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

## Resume with the implemented flow

Resume `STATE_DIR`; do not reinitialize the existing run or its baseline. Read
`state.json` for the last usable `sigilc` path/build identity, remaining delivery
work and last checkpoint. Check the actual worktree and executable before relying
on stored observations. Preserve unrelated changes. The current run uses
`.codex-progress/`, which must stay ignored and uncommitted.

Use native primitives now; do not rebuild these operations in temporary Python
queries, manual status tables or a TypeScript compiler wrapper:

| Real question | Implemented operation | Current limit |
| --- | --- | --- |
| What authored sources, imports and units exist? | Existing parser/resolver structural Design export | Helper still lives in `packages/compiler/src/design-input.ts`; extract into core/frontend, then remove the compiler package. |
| What must be reconstructed? | `sigilc stale design` / `stale implementation` | Implementation needs a current Design catalog. Read source rows from the report, not a second freshness table. |
| What inputs may a worker receive? | `sigilc prepare design` / `prepare implementation` | External caller owns dispatch and isolation. New output directory required. |
| Can returned facts be published for these inputs? | `sigilc ingest design` / `ingest implementation` | Native schema, catalog, source and generation checks reject invalid/stale results. |
| Which identities may Implementation use? | `sigilc entities` | No catalog from stale or Disjoint Design. Current repository reconstruction remains incomplete. |
| What is the current semantic result? | `sigilc compile design`, `compile implementation`, `compare` | Native commands exist; that does not establish independent current-source reconstruction or frontend integration. |
| Can generated worlds be discarded/recovered? | `sigilc clean` | Use deliberately for disposable-cache recovery, not routinely before freshness inspection. |
| What code/features still need delivery? | Whole specification, authored Design, ordinary checks and remaining delivery queue | Semantic success alone cannot answer this; final delivery audit remains external. |

These commands and their argument schemas are implemented and documented in
`packages/sigilc/README.md`. Verify the selected binary's `--help`; older retained
builds may have different exits or schemas. Do not invent an unavailable CLI
export command. Until the structural helper moves, use a small external call to
`loadDesignInput` to write the bundle; this is a temporary language-export step,
not a `sigil compile` wrapper.

For example, with an actual current structural bundle and a new preparation
directory selected by the external caller:

```sh
sigilc stale design --frontend frontend.json
sigilc prepare design --frontend frontend.json --source path/to/contract.sigil --out design-job
# External Design worker receives design.json and ontology.json.
# Caller retains job.json; after the worker returns result.ttl:
sigilc ingest design --frontend frontend.json --source path/to/contract.sigil --job design-job/job.json --turtle result.ttl
sigilc compile design --frontend frontend.json
sigilc entities --frontend frontend.json
```

Use the recorded executable path if `sigilc` is not on PATH. Commands default to
the current workspace root; use `--root` explicitly when running elsewhere.
Regenerate structural export after changes to its captured sources/config/glossary.
Read completed results and exits separately: `stale` exit 1 means work remains;
Loose Design exits 0 but may still lack a usable catalog. A missing catalog is
an unavailable Implementation prerequisite, not Drift and not permission to
invent identities or skip files.

Once the catalog is current, use the independent Implementation flow:

```sh
sigilc prepare implementation --frontend frontend.json --source src/file.ext --out implementation-job
# External isolated worker receives ONLY source, ontology.json, catalog.json.
# Caller retains job.json; after the worker returns implementation.ttl:
sigilc ingest implementation --frontend frontend.json --source src/file.ext --job implementation-job/job.json --turtle implementation.ttl
sigilc stale implementation --frontend frontend.json --selection selection.json
sigilc compile implementation --frontend frontend.json --selection selection.json
sigilc compare --frontend frontend.json --selection selection.json
```

The selection must cover the required refactor scope, including unchanged files.
Record any intentionally empty selection; do not use it to bypass missing work.
Keep operational, build and vendored files outside source scope. Do not exclude
actual product files because they are difficult to reconstruct. Never supply this
procedure, the tracker, neighboring code or Design relationships to an
Implementation worker. The independence rules below still apply.

## The convergence loop

1. **Inspect with the flow we have.** Read changed governing Design/code, rebuild
   current frontend inputs when needed, and use native stale/gate/catalog output
   to inspect current semantics. Read ordinary check evidence for delivery gaps.
   Do not regenerate a parallel manual source inventory, freshness algorithm,
   semantic identity list or comparison just because a temporary one exists.
2. **Choose the next useful change.** Give the coding environment the entire
   current human-readable specification and previous-round observations. Prefer
   a concrete deletion or the missing primitive/integration that enables it.
   Delete UI dedicated to intentionally removed backend concepts together with
   those concepts: beams, receipts, accepted worlds and evaluator profiles need
   no replacement. Retain the VS Code language and compilation/status frontend
   needed by sigilc; demonstrate its new integration before removing its old
   dependency. Do not delete retained behavior/tests to avoid that integration.
3. **Implement and check.** Update governing `.sigil`, source, callers and relevant
   tests in cohesive increments. Remove obsolete backend code and its obsolete
   UI/protocol/config/tests. Preserve unrelated work. No thin TS compiler package,
   legacy API emulation, orchestration runtime or new task framework.
4. **Dogfood each applicable primitive on actual work.** Use preparation,
   ingestion, inspection and comparison directly where their prerequisites hold.
   Distinguish real repository results, fixed fixtures, unavailable prerequisites
   and untried operations. External workers own model calls and isolation.
   End the coding round before examining its blind reconstruction outputs;
   repair starts a new round with fresh input capture/reconstruction as needed.
5. **Improve sigilc from what happened.** Apply the observation review below.
   Resolve demonstrated defects or friction in the responsible primitive or
   retained frontend. Recheck the corrected operation on the real task; promote
   the candidate compiler only after relevant tests and real-use validation.
6. **Remove another temporary mechanism.** Inspect the retirement table below on
   every iteration. If a native flow now answers a question, make it the default
   and delete/deactivate the corresponding custom query, duplicate state field
   or manual assembly step. Use the replacement in the next applicable increment.
   If a prerequisite is missing, record that exact gap and implement it when
   within scope; do not call the mechanism replaced or grow another adapter.
7. **Checkpoint, commit, continue.** Record concise evidence, additions/removals,
   tool/input identity, observation and adoption/retirement or reversal. Continue
   to the next gap until the final gate passes. A milestone, a yellow result or a
   working primitive is not completion. Missing external reconstruction may block
   semantic verification while useful implementation/deletion work continues.

This is a shrinking loop: implement → use on this refactor → observe → improve →
remove temporary machinery → continue using the Sigil flow. Do not let tracking
become a permanent second implementation. Do not delete retained product features
as a substitute for retiring temporary machinery.

## Observe and improve sigilc

Keep observations tied to an actual command/function and refactor question:

```text
Task and primitive/function; exact command; executable/kernel and input identity
Result/exit and evidence path; exercised, failed, unavailable, or untried
What worked; concrete friction, diagnostic gap, defect, or unnecessary manual step
Smallest fix in its intended owner; validation on the original task
Temporary mechanism or duplicated state the fix lets us remove next
```

Record these in `primitive_observations` while needed; durable behavior belongs
in authored Design, code and tests. This is an observation log, not a new issue
tracker, task ontology or compiler scheduling API. A native improvement should
make the real flow easier or more correct, not merely make a fixture green.

Already observed during this refactor:

* Design Loose and Implementation Converged were incorrectly treated as failing
  gates. The native CLI now returns 0 for those warning states and 1 only for
  Disjoint/Drift. Preserve named states in the frontend.
* Missing current Design projections prevent a catalog and Implementation
  comparison. Native output now reports unavailable comparison with exit 3 and
  no Implementation state. This is a real prerequisite gap, not Drift.
* Disposable-cache cleanup needed to recover corrupt indexes without unlinking
  the writer lock. `clean` now does so; publication generations also cannot be
  reused by old jobs after cache recreation. Recovery fixtures and real-root
  cleanup are distinct evidence.
* Structural export remains a manual call to a helper inside the package being
  removed. Extract that language-only capability into the retained frontend; do
  not introduce a TS compiler wrapper to hide the remaining step.
* Native primitives do not yet establish a working editor or release cutover.
  Keep retained compilation/status UI while integrating it. Remove UI whose
  sole purpose is a deliberately deleted backend concept.

Update these observations when new evidence changes the conclusion. Raw command
outputs live under `STATE_DIR/artifacts`; historical outputs are never current
world authority. Do not broaden proof, language-analysis or orchestration scope
just to make the flow look complete.

## Keep only the temporary state still needed

The existing run is already bootstrapped. Preserve its baseline, historical
journal and evidence; do not recreate its initial inventories every iteration.
Use atomic replacement for `state.json` and keep it uncommitted. For a genuinely
new run, capture starting revision/diff, whole-spec requirement IDs and check
scope once, preserving user changes.

Keep remaining delivery requirements, acceptance gaps, protected frontend
capabilities, deletion prerequisites, usable tool identity, observations and a
small checkpoint. Native/frontend artifacts now own source/unit inventory and
freshness inspection. Link those outputs instead of copying per-source states or
maintaining parallel semantic counts/colors. Delivery states remain
`pending`, `active`, `verified`, `blocked`; they are external bookkeeping, never
Sigil semantic predicates. Reopen verified work when relevant inputs change.

No tracked task package, database, daemon, scheduler, dashboard or provider
adapter. Add a disposable query only for an actual unanswered question; remove
it as soon as the native flow can answer that question. Keep delivery and
semantic evidence separate, measure real net code deletion against the original
baseline, and exclude moves, copied dependencies and abandoned edits from gains.

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

## Retire temporary mechanisms continuously

Use `temporary → trial → adopted → retired`. Trial exercises a real task;
adoption uses it on the next applicable increment; retirement stops using the
old query/state/mechanism. Archive evidence if useful, but remove it from active
instructions. A failed replacement is explicitly reverted and repaired.

| Temporary mechanism | Use now / next | Retirement condition |
| --- | --- | --- |
| Hand-maintained source/unit inventory | Existing structural frontend export | Already used across subsequent increments. Remove duplicate source/unit inventories and counts; keep the current artifact identity. The language export itself is retained product capability. |
| Ad hoc target freshness queries | Native `stale`, capture and generation validation | Already used across subsequent increments. Remove custom freshness decisions and per-source tracker statuses; read native reports. |
| Manually combined Turtle/fact files | Native `prepare`/`ingest` and per-file world assembly | Stop custom assembly when real returned Turtle uses the native path. Do not mark independent reconstruction available from fixtures. |
| Hand-maintained semantic identities | `entities` output | Use a current provisional/authoritative catalog in real preparation; retire the manual list. Missing projections must be reconstructed first. |
| Python joins for missing/disagreeing behavior | `compare` output | Use independent current D/I projections and native obligations/diagnostics; then remove custom joins. |
| Tracker-maintained semantic colors | Named native gate states and diagnostics | Retire custom coloring when current native output is the source used by the frontend and external workflow. No absence-of-diagnostics color algorithm. |
| Bespoke delivery/work queue | Whole specification, authored Design, native diagnostics and ordinary acceptance checks | Shrink checked items continuously; retire the remaining queue at the final audit/rehearsal. Yellow cannot establish delivery. |

Every checkpoint must identify what temporary mechanism was removed/reduced,
or the specific prerequisite preventing the next retirement and the next action
to remove it. Continue until the Sigil flow replaces every applicable temporary
mechanism. Do not stop after making a replacement available while continuing to
use the old mechanism. Remove needless fields/scripts rather than migrating them
into another tracker. Keep ordinary tests, external scheduling, independent
workers and human product approvals outside this replacement scope.

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
passes. Use implemented sigilc primitives directly on each applicable refactor
step, record concrete improvement observations, and keep removing/reducing
temporary queries and state until the Sigil flow replaces them. Preserve retained
frontend capabilities; delete UI dedicated to removed backend concepts. Revise
either document when real-use evidence warrants it, following track.md's change
rules. Make small, semantically cohesive commits throughout.
Preserve unrelated work. Keep independent semanticization and orchestration
external. Continue across milestones; checkpoint genuine blockers. Do not push,
publish, or deploy without separate authorization.
```

Append environment-specific installation authorization or credentials directly
to the initiation message, not to this repository document or operational logs.
