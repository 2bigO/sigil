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

Resume in the order of the active `work` list, with explicit priorities taking
precedence over historical checkpoints and deletion queues. Ordered native scope
is implemented and used on this refactor. Use it on subsequent work; do not
reimplement it from the earlier scope-first checkpoint. The initial parity review
is complete; continue its concrete improvement, integration and reconstruction
tasks. Repeat the review when new observations change the available evidence.

Use native primitives now; do not rebuild these operations in temporary Python
queries, manual status tables or a TypeScript compiler wrapper:

| Real question | Implemented operation | Current limit |
| --- | --- | --- |
| What authored sources, imports and units exist? | `sigil export design .` using core's `loadDesignInput` | Emits the raw structural JSON bundle for native `--frontend`. Export selects the complete workspace; native scope selects focus. |
| What must be reconstructed? | `sigilc stale design` / `stale implementation` | Implementation needs a current Design catalog. Read source rows from the report, not a second freshness table. |
| What inputs may a worker receive? | `sigilc prepare design` / `prepare implementation` | External caller owns dispatch and isolation. New output directory required. |
| Can returned facts be published for these inputs? | `sigilc ingest design` / `ingest implementation` | Native schema, catalog, source and generation checks reject invalid/stale results. |
| Which identities may Implementation use? | `sigilc entities` | No catalog from stale or Disjoint Design. Current repository reconstruction remains incomplete. |
| What is the current semantic result? | `sigilc compile design`, `compile implementation`, `compare` | Native commands exist; that does not establish independent current-source reconstruction or frontend integration. |
| Which files does this comparison cover, and in what focus order? | `sigilc scope --frontend FILE --scope FILE`; same `--scope` on world commands | Reports ordered roots, effective import/owner closure and Implementation selection. Order and membership have separate identities. Inspection does not require reconstructed worlds and is not a semantic gate. |
| Can generated worlds be discarded/recovered? | `sigilc clean` | Use deliberately for disposable-cache recovery, not routinely before freshness inspection. |
| What code/features still need delivery? | Whole specification, authored Design, ordinary checks and remaining delivery queue | Semantic success alone cannot answer this; final delivery audit remains external. |

The implemented commands and their argument schemas are documented in
`packages/sigilc/README.md`. Verify the selected binary's `--help`; older retained
builds may have different exits or schemas. Use `sigil export design .` to write
the bundle. If the installed language CLI predates this command, use the current
checkout directly: `deno run --allow-read packages/cli/src/main.ts export design .`.
Export returns 0 without language errors, 1 with language-error diagnostics in
the bundle, 2 for invalid usage and 3 for runtime failure. These are language
operation exits, not semantic gate states. This exports structure only; invoke
`sigilc` directly for semantic operations.

For example, with an actual current structural bundle and a new preparation
directory selected by the external caller:

```sh
sigil export design . > frontend.json
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

For a focused increment, use one scope definition instead of manually slicing
the frontend bundle or rebuilding per-task comparison lists:

```sh
sigilc scope --frontend frontend.json --scope scope.json
sigilc stale design --frontend frontend.json --scope scope.json
sigilc prepare design --frontend frontend.json --scope scope.json --source path/to/contract.sigil --out scope-job
sigilc compare --frontend frontend.json --scope scope.json
```

The versioned scope pairs ordered `design.paths` with `implementation` selection;
see the native README for the exact schema. Read `scope.design.focus_order` from
native output. Requested roots come first, followed by dependency additions.
Inspect the effective membership and inclusion reasons before interpreting the
result. Use `--scope` consistently on subsequent ingest/catalog/Implementation
operations. It replaces `--selection`; it does not replace the full-scope final
audit, an external work queue or independent reconstruction.

## The convergence loop

1. **Inspect with the flow we have.** Read changed governing Design/code, rebuild
   current frontend inputs when needed, and use native stale/gate/catalog output
   to inspect current semantics. Read ordinary check evidence for delivery gaps.
   Do not regenerate a parallel manual source inventory, freshness algorithm,
   semantic identity list or comparison just because a temporary one exists.
2. **Choose the next useful change.** Give the coding environment the entire
   current human-readable specification and previous-round observations. Prefer
   a concrete deletion or the missing primitive/integration that enables it.
   First use an already implemented Sigil capability and incorporate its actual
   invocation here. If temporary state supplies necessary information the stack
   cannot supply, turn that observed gap into authored Design and implementation
   work. Use active priorities and observed gaps to select the next action.
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

* The native editor cutover found that named states and raw kernel tables did
  not supply source-ranged findings. The
  [ObservedEditorGap case](packages/sigilc/report.sigil) captures the requirement:
  presentation diagnostics belong in `sigilc`, so the editor does not become a
  second kernel-table interpreter. Native gate reports now include bounded
  diagnostics with physical authored ranges, assertion-source attribution and
  exact obligation/rule witnesses. The subsequent editor increment adopted those
  reports with actual language/native binaries and deleted its old JSONL,
  profile, stage and history handling. Current refactor output is Loose Design
  and unavailable Implementation; the editor preserves those answers directly.
  File focus is now explicitly named Compile File because native scope selects
  physical files and dependency closure. No cursor-component alias or duplicate
  language resolver was retained to hide that scope difference.

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
* Structural export now lives in core, with its contract and retained tests. The
  helper was moved out of the compiler package and its old path removed. Use the
  language CLI's `export design` command, which uses that public core export.
  Filesystem discovery now uses core path helpers and excludes generated metadata
  without importing the compiler package. Native editor/release integration and
  the rest of compiler-package deletion remain; no forwarding shim is needed.
  The CLI export was adopted on the subsequent editor deletion and CLI deletion
  increments, replacing the manual Deno eval export invocation. Those increments
  also removed the editor's beam/world/view/handoff/receipt commands and the
  legacy `sigil semantic` route with their dedicated helpers and tests. Retained
  language, preview and compilation workflows passed ordinary host checks.
  The retained editor now consumes native final reports directly. Two-binary
  release packaging and Linux consumption are verified; the remaining legacy
  CLI/compiler deletion and other native platform executions are pending.
* Release integration exposed another obsolete dependency: installers and smoke
  checks required the old runtime manifest, engine and TypeScript proof runtime.
  Archives now stage `sigil` and `sigilc`; installers validate both and compare
  existing installed bytes against the verified archive. The actual Linux archive
  exports Design and runs native gates without host tools, and its separate
  consumer runs offline without the source checkout. Use `deno task package:cli`
  on each matching native runner. Other platforms still need execution evidence;
  language CLI removal of its remaining embedded legacy imports is also pending.
* Ordered scope now works directly in Rust across native commands. On the real
  refactor, three requested roots expanded to 60 Design files through imports
  and ownership; the native output exposed that breadth while preserving focus
  order. Design was Loose and comparison unavailable, not a fabricated focused
  success. Scope inspection and Design preparation both completed.
* **Learning from observation: order is necessary scope information.** This loop
  initially resumed toward export extraction and deletion even though native
  scope was the newly requested first task. Making the priority explicit in the
  temporary queue exposed a missing product requirement: a set of files cannot
  convey what comes first. The authored
  [ObservedPriority case](packages/sigilc/scope.sigil) records this discovery;
  `SigilComparisonScope::FocusOrder` now requires
  caller-defined order in native scope output, separate from membership and
  semantic cache identity. `S32` implemented and tested this requirement; real
  native output now recovers scope/export/editor priority without a separate
  comparison-priority table. Apply the same observation-to-Design-to-implementation
  process to subsequent gaps; do not leave them as permanent tracker rules.
* Selecting four explicit Implementation files took roughly 8–11 seconds because
  discovery hashed unselected files first. Native file-only selection now filters
  before hashing and skips unrelated traversal. The identical real scope inspection
  took 8.77 seconds with the previous compiler and 1.36 seconds with the updated
  compiler, with identical output. Directory/global discovery still walks the
  pruned tree. No custom cache or TS adapter was introduced.
* Native primitives do not yet establish a working editor or release cutover.
  Keep retained compilation/status UI while integrating it. Remove UI whose
  sole purpose is a deliberately deleted backend concept.

Update these observations when new evidence changes the conclusion. Raw command
outputs live under `STATE_DIR/artifacts`; historical outputs are never current
world authority. Do not broaden proof, language-analysis or orchestration scope
just to make the flow look complete.

## Require information and evidence parity

The endgame is that temporary `.codex-progress` tracking and the corresponding
Sigil flow answer the same necessary questions, with supporting evidence: what
scope is required, what remains, what is implemented or deleted, what checks ran,
what inputs are current, and what semantic obligations hold, fail or remain
unknown. The loop is done when those answers and their evidence agree and the
final gate passes. A matching color or a newly available primitive is insufficient.

Review active temporary mechanisms against implemented Sigil commands/functions.
Use existing capabilities directly and update this procedure;
do not write replacement code for a capability already present. For each missing
answer, record the concrete real-loop question, missing input/output or evidence,
and intended owner. Define and implement the missing capability, validate it on
that original question, then retire the temporary mechanism after subsequent use.
Keep this review in the existing temporary work queue, not a second parity tracker.

Proof here means inspectable support for each claim: current native derivations
and their input identities for semantic conclusions, and actual checks/diffs for
delivery and removal. Preserve unknowns and unavailable evidence. Neither a task
marked done nor a green/yellow gate proves checks passed or code disappeared.
The Sigil flow must recover those distinctions and supporting evidence without
depending on temporary task flags. Keep test execution and independent workers
external; do not recreate accepted worlds, receipts or a coding-agent scheduler.

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
Store shared selection policy once, not on every requirement row. Scope reports
must eventually replace manual comparison membership; requirement IDs and file
lists recording actual delivery evidence are not themselves compiler selectors.

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
| Repeated scope selectors and hand-built comparison membership | Implemented `sigilc scope` and `--scope` across world commands | Adopted on the subsequent source-selection increment; native output selected the first preparation target. Stop manual bundle slicing/comparison-membership assembly and read native order/membership. Keep external delivery requirements until their final audit; the compiler does not infer them from `compile.md`. |
| Manually combined Turtle/fact files | Native `prepare`/`ingest` and per-file world assembly | Stop custom assembly when real returned Turtle uses the native path. Do not mark independent reconstruction available from fixtures. |
| Hand-maintained semantic identities | `entities` output | Use a current provisional/authoritative catalog in real preparation; retire the manual list. Missing projections must be reconstructed first. |
| Python joins for missing/disagreeing behavior | `compare` output | Use independent current D/I projections and native obligations/diagnostics; then remove custom joins. |
| Tracker-maintained semantic colors | Named native gate states and diagnostics | Retired after native editor adoption with actual tools and real refactor use. Read native names and unavailable states; no absence-of-diagnostics color algorithm. Independent current reconstruction is still needed for final convergence. |
| Bespoke delivery/work queue | Whole specification, authored Design, native diagnostics and ordinary acceptance checks | Shrink checked items continuously; retire the remaining queue at the final audit/rehearsal. Yellow cannot establish delivery. |

For every row, retirement requires the same necessary information and supporting
evidence to be recoverable through the Sigil flow. If it cannot, that is a Design
and implementation gap for the running loop, not permission to delete the record
or leave the temporary mechanism permanent.

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
   must recover the required scope, remaining/delivered/deleted behavior, actual
   check evidence, current unknowns and native semantic status. Compare those
   answers and supporting evidence with the temporary state: the same necessary
   information must be available, including why the loop is done. No new
   implementation is required in this rehearsal. Any missing necessary answer
   returns to Design and implementation work; it blocks tracker retirement.

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
For an existing run, preserve its baseline and follow its explicit priority order.
Follow any one-time resumption order in track.md, then keep reviewing information
and evidence parity and implementing observed gaps in the running loop.
Implement, dogfood, and replace temporary tracking until track.md's final gate
passes. Use implemented sigilc primitives directly on each applicable refactor
step, record concrete improvement observations, and keep removing/reducing
temporary queries and state until the Sigil flow supplies the same necessary
information and supporting evidence. Reuse implemented capabilities directly;
update track.md with their actual use instead of writing redundant code.
Do not retire a mechanism until this parity is demonstrated on subsequent real
work. A successful gate alone never proves delivery, test success or deletion.
Preserve retained frontend capabilities; delete UI dedicated to removed backend
concepts. Revise
either document when real-use evidence warrants it, following track.md's change
rules. Make small, semantically cohesive commits throughout.
Preserve unrelated work. Keep independent semanticization and orchestration
external. Continue across milestones; checkpoint genuine blockers. Do not push,
publish, or deploy without separate authorization.
```

Append environment-specific installation authorization or credentials directly
to the initiation message, not to this repository document or operational logs.
