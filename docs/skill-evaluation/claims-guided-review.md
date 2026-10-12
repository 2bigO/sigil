# Claims-guided review: observed comparison

Date: 2026-10-12. Host: `codex-cli 0.161.0`, model `gpt-6-luna`, reasoning
effort `high` for every host and child. `sigilc` 0.3.0, built from `a559fea`
and unchanged through this record. Protocol:
[claims review comparison fixture](../../integrations/skills/sigil-evaluate/evals/claims-review-fixture.md).
Per-run usage, identities and final reports:
[evidence](evidence/claims-guided-review/). Raw host streams stay in the local,
ignored `analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/`.

## Outcome

- **Judge input tokens: not reduced.** On Slotted, every review from computed
  claims used more judge input than every source-only review.
- **Quality on Slotted: unchanged.** Both sides found the same planted
  problems at best (three of four). Neither found the step that leads nowhere,
  although the computed view lists it.
- **Quality on the bounded cases: better.** The claims side caught the Tag
  reuse the source-only side missed, and the promise the claims dropped.
- **Computation reuse: works.** An unchanged rerun launched no reader.
- **Writer: failed the policy case.** It deleted both sides of an undecided
  conflict instead of leaving the choice to a human.

The plan's token criterion is unmet, and the writer's policy case is unmet.

## Catalogs

| Catalog | Commit | Change |
| --- | --- | --- |
| baseline | `a559fea` | Source-only evaluator and writer, before this work. |
| proposed | `8295728` | Evaluator and writer read the compact review view. |
| proposed-r2 | `e980db4` | Guidance: fewer reads; check a step that reaches no end. |
| proposed-r3 | `91861bc` | Entrypoint: the view stands in for whole source reads; batch lookup. |

## Slotted judges

Each judge was a fresh, read-only delegated evaluator with the same prompt and
the same captured sources and intent. The claims side also received a frozen
review bundle, prepared in a separate run so its cost is counted apart. Input
is the host's own cumulative usage, cached tokens included.

| Run | Catalog | Input tokens | Cached | Model turns | Time | Planted problems found |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| J1-baseline | baseline | 254,948 | 202,752 | 8 | 143 s | 3 of 4 |
| J2-baseline | baseline | 308,234 | 246,272 | 10 | 80 s | 3 of 4 |
| J3-baseline | baseline | 218,448 | 172,288 | 7 | 59 s | 1 of 4 |
| J1-proposed | proposed | 587,599 | 500,736 | 12 | 154 s | 3 of 4 |
| J1r2-proposed | proposed-r2 | 360,303 | 303,360 | 11 | 95 s | 3 of 4 |
| J1r3-proposed | proposed-r3 | 1,018,025 | 927,488 | 17 | 331 s | 3 of 4 |

"Three of four" is the archived-mark ownership conflict, the pending-range
contradiction, and the missing renter display name. J3-baseline found only the
range contradiction. No run reported the owner-digest step that writes and
returns nothing; the computed view lists it as an unreached step.

Only one claims-side run per guidance revision was made, so there are no three
matched pairs for one catalog. The user chose to stop after these runs because
every claims-side run already exceeded every source-only run.

### Why the tokens went up

A judge's input is the sum, over its model turns, of everything it has read so
far. The view did not shrink that sum:

1. The judges read the language reference either way, and it dominates the
   context.
2. On Slotted the view (39 KB) is about the size of the sources (37 KB), so it
   adds about as much as it could replace.
3. The claims-side judges still read most sources, then took more turns to
   verify the bundle and look things up. Each extra turn re-reads everything.

Final context per judge was 50–59k tokens for the source-only side and 59–92k
for the claims side. The view would save tokens against a judge that loads the
670 KB judgment context; the source-only evaluator never did.

## Bounded cases

One matched pair on the computed claims cases, with a reading prepared cold
(F1-prep-cold). That reading was thin: the overlap rule and the cancellation
promise produced no claims, so the omitted-promise case occurred without
injection.

| Run | Input tokens | Turns | Range change (AE6) | "current user" (AE3) | Overlap merge (AE5) | Omitted promise (AE4) |
| --- | ---: | ---: | --- | --- | --- | --- |
| F-baseline | 255,899 | 10 | design choice | missed | kept cancellation | not applicable |
| F-proposed | 223,083 | 7 | design choice | reuse `signed-in user` | kept cancellation | read the unit's prose |

F-proposed also left "range", "overlaps" and "session cookie" as prose, and
rejected both simplification candidates after reading the prose.

## Computation

| Run | Purpose | Readers | Host input | Reader input | Time |
| --- | --- | ---: | ---: | ---: | ---: |
| A1-cold | Slotted, no stored readings | 11 (7 sources, 4 re-asks) | 3,078,285 | 4,467,183 | 711 s |
| A2-unchanged | Slotted, seeded from A1 | 0 | 272,854 | 0 | 51 s |
| F1-prep-cold | Bounded cases, cold | 2 | 556,789 | 390,817 | 217 s |
| U2-16b-selected | `booking.sigil` only, cold | 1 | 624,321 | 196,357 | 170 s |
| U2-16e-oldcompiler | No review view (controlled replay) | 0 | 204,261 | 0 | 46 s |

- A1 ended `disjoint` with nothing unread and wrote 182 readings back. A2's
  first check had nothing unread, so it launched no reader and copied nothing.
- 16b read only `booking.sigil`, never ran a filtered check, ended
  `incomplete`, and listed Identity's three units as unread outside the scope.
- 16e used a wrapper that drops the review view from `check`, labeled
  controlled replay. The host kept the `loose` state and named the compact view
  unavailable without building one.
- No run changed a design source. Two hosts ran `sigilc tree` against the
  default store, which writes the tree cache under the workspace's `.sigil`.

An edited Slotted preparation was not run, so incremental refresh after an
edit is covered by the native tests only.

## Writer

G-writer revised the bounded cases' `booking.sigil` with the proposed-r3
catalog: 2,186,502 host and 1,480,422 child input tokens, four children (two
readers, two evaluators), 591 s.

- It computed the draft, captured the bundle, and used two fresh evaluators.
- It replaced "current user" with the imported `signed-in user` and merged the
  two overlap rules while keeping the cancellation promise.
- **It failed AE6.** It deleted both the constraint forbidding a range change
  and the interface offering one, and wrote a new interface promise ("The
  signed-in user can create a booking for a room.") that no intent supports.
  Its hand-back still said the range policy was left undecided. The second
  evaluator then found no material defect, because the conflict was gone.
  The writer guidance already forbids deleting a promise to clear a finding;
  the observed writer did not follow it. See the
  [diff](evidence/claims-guided-review/G-writer-booking.diff).

## Not observed

Direct evaluation that runs review preparation itself (case C1), freshness
invalidation (writer case H), and an unavailable `sigilc` for the writer (case
I) were not run. Their behavior rests on the written contract alone.
