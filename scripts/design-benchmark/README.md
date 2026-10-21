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

## Measures

Each measure is reported on its own, per design and, where it has one, per
component. Components are matched to the reference's by name; components with no
match are listed separately. A pass cell shows the pass value and the pass minus
the reference. "Closer to the reference" says which direction moves a pass
toward the reference. The report prints the same sentence under each table, from
one shared definition in `report.ts`.

Structural measures come from `sigilc tree` alone. Claims measures come from
`sigilc check` over the stored readings, with the law set the guidance
fingerprint names. Requirement coverage comes from the stored coverage reading.
A design that does not parse is still measured structurally; its claims and
coverage are unavailable.

- **Components per design.** Closer to the reference: A count nearer the
  reference's. It does not say whether the split into components is right.
- **Facets per contract role.** Closer to the reference: Counts nearer the
  reference's for each component and role; fewer than the reference means a
  thinner contract. It does not say whether the Facets say what the reference's
  Facets say.
- **Components without state, logic or cases.** Closer to the reference: The
  same components as the reference, each lacking the same roles; every other
  listed component is thinner than the reference's. It does not say whether that
  component needs the role.
- **Interface Tags that nothing imports.** Closer to the reference: Counts
  nearer the reference's for each component. It does not say whether an
  unimported Tag is a promise to callers outside the design or an unused one.
- **Interface Tags with no backing Facet.** Closer to the reference: Counts
  nearer the reference's; more than the reference means more Interface Tags that
  no state, logic or constraints Facet of the component introduces or mentions.
  It does not say whether the Facets that do mention a Tag deliver what it
  promises.
- **Tag-mention coupling.** Closer to the reference: Edges and mention counts
  nearer the reference's. It does not say whether a coupling is acceptable.
- **Import fan-in and fan-out.** Closer to the reference: Fan-in and fan-out
  nearer the reference's for each component. It does not say whether the
  requirement allows a dependency.
- **Tag-sharing groups.** Closer to the reference: Group counts, group sizes and
  untagged Facets nearer the reference's for each component. It does not say
  whether a component should be split or merged.
- **Import cycles.** Closer to the reference: The same cycles as the reference;
  each other cycle is further from it. It does not say whether a cycle is
  harmful.
- **Tag-mention cycles.** Closer to the reference: The same cycles as the
  reference; each other cycle is further from it. It does not say whether a
  cycle is harmful.
- **Claims state.** Closer to the reference: The same state as the reference. It
  does not say why the state differs; the findings say that.
- **Findings by class and law.** Closer to the reference: Counts nearer the
  reference's for each class, law and component. It does not say whether a
  finding is a real problem in the design.
- **Unread units.** Closer to the reference: A count nearer the reference's;
  unread units leave the claims measures incomplete. It does not say anything
  about the design itself.
- **Requirement coverage.** Closer to the reference: The same verdict as the
  reference for each requirement ID, citing Facets that answer it as the
  reference's do. It does not say whether a cited Facet answers its requirement
  well; the counts are not a grade.

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
