# Design-quality benchmark

This benchmark shows whether a change to `sigil-write`, `sigil-evaluate` or the
claims laws brings designs that `sigil-write` generates closer to a known-good
design. Each benchmark pairs a requirement file with a reference design. A
**pass** has `sigil-write` author a design from the requirement file alone, and
the benchmark measures that design beside the reference. It reports separate
measures and never a single score, ranking or threshold.

The package runs on [Bun](https://bun.sh/). It shares the host runner in
[`../agent-runner`](../agent-runner) with the
[Slotted interpretation benchmark](../slotted-benchmark/README.md).

## Benchmarks

| Name                    | Requirement file                                                                                     | Reference                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `slotted-with-split`    | [`benchmarks/slotted-with-split/requirement.md`](benchmarks/slotted-with-split/requirement.md)       | [`examples/slotted`](../../examples/slotted) |
| `slotted-without-split` | [`benchmarks/slotted-without-split/requirement.md`](benchmarks/slotted-without-split/requirement.md) | [`examples/slotted`](../../examples/slotted) |

The two Slotted benchmarks differ only in whether the module split is given.
`slotted-with-split` ends with a `## Module split` section that names the seven
components, their allowed dependencies, where each mechanism lives, and one
design file per component. `slotted-without-split` is the same text without that
section, so the writer chooses the split itself. Comparing the two separates
"chose a different split" from "wrote thinner modules".

Both files keep the Slotted requirement IDs (R1–R28 and AE1–AE13), and both
benchmarks share one requirement list,
[`benchmarks/slotted/requirements.json`](benchmarks/slotted/requirements.json).
The coverage reading and the report cite those IDs.

A requirement file is exactly what the writer receives. It is its only evidence.

## Commands

```sh
cd scripts/design-benchmark
bun install
bun run main.ts --help
```

- `run` regenerates designs for one benchmark, one or more `agent:model` pairs,
  a reasoning level and a pass count.
- `measure` scores a committed design and its stored readings without calling a
  model.
- `reread` takes new claims readings, and with `--coverage` new coverage
  readings, on stored designs.
- `report` re-measures listed batches with the current `sigilc` and writes one
  table per measure beside the reference.

Evidence goes under `.benchmarks/` at the repository root, which is ignored.

## Known leak

[`skills/sigil-write/references/contract-prose.md`](../../skills/sigil-write/references/contract-prose.md)
contains examples taken from an earlier Slotted run, such as "Booking requires
the recurring booking series". The benchmark does not edit the skill it tests,
so a writer that reads that reference sees some Slotted vocabulary. Read Slotted
results with that in mind.

## Tests

```sh
bun test
bun run check
```

The tests use fake hosts and never start a real agent.
