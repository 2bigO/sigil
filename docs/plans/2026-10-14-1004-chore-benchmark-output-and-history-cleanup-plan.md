---
title: Benchmark Output and History Cleanup - Plan
type: chore
date: 2026-10-14
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Benchmark Output and History Cleanup - Plan

## Goal Capsule

- **Objective:** A contributor's checkout keeps no history folders, benchmark runs land in one predictable root folder that Git never shows, and no live doc or skill instruction points at a folder that no longer exists.
- **Means:** a self-ignoring `.benchmarks/` default output, deletion of `analyze-demo/` and `docs/skill-evaluation/`, and removal of the pre-merge baseline that tied the benchmark to the deleted evidence (Key Decisions below).
- **Authority:** Product Contract Requirements win on behavior; KTDs win on mechanism.
- **Stop conditions:** stop and ask if any test, task, or shipped skill turns out to need a file under `docs/skill-evaluation/` beyond the baseline manifest named in R5.
- **Execution profile:** one branch, one PR; tests and type checks must pass.

## Product Contract

### Summary

Benchmark batches move by default to a self-ignoring `.benchmarks/` folder at the repo root. `analyze-demo/` and `docs/skill-evaluation/` are deleted as history. The benchmark stops recording the pre-merge baseline. Contributors report evaluation results in their pull request instead of committing reports.

### Problem Frame

The benchmark's default output sits under `analyze-demo/slotted-runs/benchmarks/`, a demo-era folder that also holds old `r2`–`r8` runs, an uncommitted deletion of `DIAGNOSIS.md` and `analyze.py`, and about 5.5 GB of local batches. `docs/skill-evaluation/` holds 148 dated reports and evidence files that the maintainer now considers history. Live docs, three skill eval READMEs, and the benchmark itself still point at both folders. The benchmark code reads a manifest from `docs/skill-evaluation/` on every design run, so that folder cannot be removed without a code change.

### Requirements

**Benchmark output**

- R1. With no `--out`, a run writes its batch to a new timestamped directory under `.benchmarks/` at the repo root.
- R2. The first time the tool creates `.benchmarks/`, it also writes a `.gitignore` there containing `*`, so the folder and its contents never appear in `git status`. An existing `.gitignore` in that folder is left untouched.
- R3. `--out DIR` behaves as today and does not create or touch `.benchmarks/`.
- R4. The help text and the benchmark README name `.benchmarks/` as the default.

**Pre-merge baseline**

- R5. Design runs no longer read `docs/skill-evaluation/evidence/claims-turtle-premerge-20261009/manifest.json`, and new manifests and reports carry no pre-merge hashes.

**History removal**

- R6. `analyze-demo/` is gone from Git and from disk, including its untracked runs.
- R7. `docs/skill-evaluation/` is gone from Git.

**Live references**

- R8. No file outside `docs/plans/` names `analyze-demo` or `docs/skill-evaluation`.
- R9. Contributor and skill eval instructions tell contributors to keep raw runs local in `.benchmarks/` and summarise what they observed in the PR description.
- R10. README, CONTRIBUTING, and PRE_RELEASE no longer link to deleted reports as evidence. Each sentence is reworded to describe the eval fixtures and procedure, not just stripped of its link.

### Key Decisions

- **`.benchmarks/` at the repo root, self-ignoring.** Runs are expensive evidence that can't be regenerated, so a `cache` name would invite deletion; pytest-benchmark uses the same `.benchmarks/` name. Governs R1, R2. (session-settled: user-approved — chosen over `.cache/benchmarks/` and a folder outside the checkout such as `~/.local/state/sigil/benchmarks/`: runs are evidence, not a disposable cache, and an in-repo folder is easy to find.)
- **Delete all local runs.** Nothing under `analyze-demo/` is worth keeping. Governs R6. (session-settled: user-directed — chosen over moving the batches into `.benchmarks/`: the maintainer judged nothing local worth keeping.)
- **Delete `docs/skill-evaluation/`.** Governs R7, R8. (session-settled: user-directed — chosen over keeping the reports: they are history and temporary.)
- **Drop the pre-merge baseline.** Governs R5. (session-settled: user-approved — chosen over moving the manifest next to the benchmark as a fixture: the baseline records a 2026-10-09 migration and is history too.)
- **Results go in the PR description.** Governs R9, R10. (session-settled: user-approved — chosen over removing the recording step entirely.)

### Scope Boundaries

- Plans under `docs/plans/` that mention the removed paths stay unchanged as dated records, even where their links break.
- `docs/computed-evaluation-demo.md` stays. Only its path mentions change (U4).
- The setup guide's warning that Codex copies ignored folders on install stays and is repointed. Moving runs out of the checkout to avoid that is not in scope.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The CLI entry point owns `.benchmarks/` setup, not `runBatch`.** `runBatch` already refuses an existing output directory and creates its parent (`scripts/slotted-benchmark/batch.ts`, `runBatch`). The default-root setup goes in a small exported helper in `scripts/slotted-benchmark/main.ts`, called only when `--out` is absent, so R3 holds by construction and the helper can be tested against a temp directory instead of the real repo root.
- KTD2. **Remove the baseline fields from the manifest type and the report outright.** The `baselineClaimsSha256`/`baselineSigilcSha256` fields are optional and read through a guard in `scripts/slotted-benchmark/report.ts`. Removing the fields, the guard, `baselineDigests`, and the `baselineDir` option is safe: an old manifest's extra JSON keys are ignored when a report is rebuilt, and every retained batch is deleted anyway (R6).
- KTD3. **Leave the root `.gitignore` unchanged.** The self-written `.gitignore` covers `.benchmarks/` (R2). The old ignore rules (`r*/`, `benchmarks/`) live in the tracked `analyze-demo/slotted-runs/.gitignore`, which U3 deletes with the tree.

### Sources

- `scripts/slotted-benchmark/main.ts`: `DEFAULT_OUTPUT` and the `destination` fallback in `executeCommand`, plus the `HELP` string.
- `scripts/slotted-benchmark/batch.ts`: `baselineDigests`, the `baselineDir` option, and the manifest `tools` spread for `action === "design"`.
- `scripts/slotted-benchmark/report.ts`: the "Pre-merge claims SHA256" line.
- Every integration test in `scripts/slotted-benchmark/integration_test.ts` passes `--out`, so none writes to the default root today.
- pytest and ruff write a `.gitignore` containing `*` into their cache folders. pytest-benchmark stores results in `.benchmarks/`.

---

## Implementation Units

### U1. Self-ignoring `.benchmarks/` default output

- **Goal:** Default batches land under `.benchmarks/`, which hides itself from Git.
- **Requirements:** R1, R2, R3, R4; KTD1.
- **Dependencies:** none.
- **Files:** `scripts/slotted-benchmark/main.ts`, `scripts/slotted-benchmark/README.md`, `scripts/slotted-benchmark/main_test.ts` (new; the `test:slotted-benchmark` task already picks up `*_test.ts`), `scripts/slotted-benchmark/integration_test.ts`.
- **Approach:**
  1. Point `DEFAULT_OUTPUT` at `../../.benchmarks/`.
  2. Add an exported helper that creates the root and writes `.gitignore` with `*` when that file is absent.
  3. Call it only on the no-`--out` path before `runBatch`.
  4. Update the `HELP` text and both README mentions, including the `report` example path.
- **Patterns to follow:** `exists` from `scripts/slotted-benchmark/files.ts`; the temp-dir setup in `integration_test.ts`.
- **Test scenarios:**
  - Given an empty temp dir, the helper creates `<dir>/.benchmarks/.gitignore` containing exactly `*`.
  - Given a `.benchmarks/.gitignore` with custom content, the helper leaves it unchanged.
  - Calling the helper twice succeeds and leaves one `.gitignore`.
  - A run with `--out` under a temp dir creates no `.benchmarks/` anywhere (existing integration tests already pass `--out`, so assert absence in one of them).
- **Verification:** `HELP` and README name `.benchmarks/`, and the new tests pass.

### U2. Remove the pre-merge baseline

- **Goal:** The benchmark no longer depends on any file in `docs/skill-evaluation/`.
- **Requirements:** R5; KTD2.
- **Dependencies:** none.
- **Files:** `scripts/slotted-benchmark/batch.ts`, `scripts/slotted-benchmark/report.ts`, `scripts/slotted-benchmark/report_test.ts`, `scripts/slotted-benchmark/batch_test.ts`.
- **Approach:**
  1. Delete `baselineDigests`, the `baselineDir` option, and the design-only spread in the manifest `tools`.
  2. Remove the two optional baseline fields from the manifest type.
  3. Remove the pre-merge line from the report.
- **Test scenarios:**
  - A design-action batch in a temp dir writes a manifest whose `tools` has no baseline keys.
  - A report rebuilt from a manifest fixture that still carries the old baseline keys renders without error and without a "Pre-merge" line.
- **Verification:** `deno task check:slotted-benchmark` passes, and nothing under `scripts/` names `claims-turtle-premerge` or `skill-evaluation`.

### U3. Delete the history folders

- **Goal:** `analyze-demo/` and `docs/skill-evaluation/` are gone.
- **Requirements:** R6, R7; KTD3.
- **Dependencies:** U2 (the baseline manifest is deleted here).
- **Files:** `analyze-demo/` (whole tree, tracked and untracked), `docs/skill-evaluation/` (whole tree).
- **Approach:**
  1. Remove both trees from Git, which also commits the existing local deletions of `DIAGNOSIS.md` and `analyze.py`.
  2. Remove the untracked remainder of `analyze-demo/` from disk.
- **Test expectation:** none -- pure deletion. U2's tests prove the code no longer reads the deleted manifest.
- **Verification:** neither directory exists on disk, and `git status` shows no stray files under either path.

### U4. Rewrite live references

- **Goal:** Every live doc and skill instruction points at `.benchmarks/` and the PR-description workflow, with no links to deleted files.
- **Requirements:** R8, R9, R10.
- **Dependencies:** U1 (names the new path), U3 (lands together so no link breaks in between).
- **Files:** `docs/computed-evaluation-demo.md`, `docs/contributing/setup.md`, `docs/contributing/skills.md`, `skills/sigil-align/evals/README.md`, `skills/sigil-compute-design/evals/README.md`, `skills/sigil-write/evals/README.md`, `skills/sigil-evaluate/evals/claims-review-fixture.md`, `README.md`, `CONTRIBUTING.md`, `PRE_RELEASE.md`.
- **Approach:**
  1. In `computed-evaluation-demo.md`, change the output path and the `report` example to `.benchmarks/`. Remove the `DIAGNOSIS.md` pointer and the closing sentence about copies in `analyze-demo/`, and keep the run table.
  2. In `setup.md`, keep the Codex warning and name `.benchmarks/`.
  3. In `docs/contributing/skills.md`, drop the "Record the result in" column from the skills table, and replace the paragraph on recording results with: keep raw runs in `.benchmarks/` and summarise observed results in the PR description (R9).
  4. In the three eval READMEs, replace "write observed results to `docs/skill-evaluation/...`" with the same PR-description instruction. Keep their honesty rules. Reword any rule that requires retained artifacts in the repository (for example `sigil-compute-design`'s "retained artifacts for another host to reproduce the case") so that the PR summary instead names the batch directory, the input and tool hashes from the batch manifest, the agents and models, and any failures. Raw artifacts stay in the contributor's local `.benchmarks/`.
  5. In `claims-review-fixture.md`, remove the pointer to the repository record.
  6. In README, CONTRIBUTING, and PRE_RELEASE, reword the evidence sentences to say behavioral acceptance comes from running the eval fixtures with fresh agents and reporting the result in the PR (R10). Keep the existing caveats, such as "Mechanical checks do not establish design coherence".
- **Test expectation:** none -- documentation only. U4's done signal is the reference sweep in the Verification Contract.
- **Verification:** the reference sweep finds no hits, and `deno task test:skill` still passes with the edited eval READMEs.

---

## Verification Contract

| Check | Command or method | Proves |
| --- | --- | --- |
| Type check | `deno task check:slotted-benchmark` | U1, U2 compile |
| Benchmark tests | `deno task test:slotted-benchmark` | R1–R3, R5 |
| Skill packages | `deno task test:skill` | edited eval READMEs still validate |
| Format and lint | `deno task fmt`, `deno task lint` | `scripts/` changes conform |
| Reference sweep | search the repo for `analyze-demo` and `skill-evaluation`, excluding `docs/plans/` and `.git/` | R8 |
| Git cleanliness | `git status` after a default-output run, or after calling the helper against the repo root | R2 |

## Definition of Done

- Every check in the Verification Contract passes.
- Both history folders are absent on disk and in Git.
- No dead code remains: no unused `baselineDigests`, `baselineDir`, `DEFAULT_OUTPUT` remnants, or abandoned helper variants.
