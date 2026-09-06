# Semantic migration implementation report

This report records the implementation of the remaining scope in
[`compile.md`](../compile.md). Installed-package world capture, target
dependency capture, implementation patch loops, coding-agent orchestration,
ontology expansion, and automatic publication remain excluded.

## Delivered groups

| Group | Commit    | Result                                                               |
| ----- | --------- | -------------------------------------------------------------------- |
| S01   | `150a6d1` | Shared workspace context and canonical component identity            |
| S02   | `e460b9d` | Deterministic managed views with receipts and recovery               |
| S03   | `009f425` | Strict proposal/question transport and four semantic providers       |
| S04   | `c3afea2` | Semantic provider configuration and legacy migration                 |
| S05   | `bcd7fbc` | VS Code semantic commands and managed-view LSP navigation            |
| S06   | `ce2c3b2` | Skill, adapter, schema, and workflow documentation migration         |
| S07   | `d424934` | Pinned runtime manifest, resolver, handshake, and doctor             |
| S08   | `3fb4430` | Native distribution builder, smoke seam, matrix workflow, installers |
| S09   | `5764358` | Receipt v2 migration, profile/runtime identity, evidence provenance  |
| S10   | `b18c908` | Permanent cancellable beam locks and synced atomic writes            |

## Verification

The Linux source checkout passes the core, compiler, CLI, Deno LSP, VS Code
unit, and skill validation suites. The compiler suite includes the native egglog
fixtures, TypeScript 7 fixtures, receipt/handoff verification, runtime manifest
tests, metadata migration tests, and beam lock tests. A locally staged Linux x64
archive passed version, standalone doctor, tamper rejection, and local installer
checksum/doctor/selection tests.

The release workflow defines mandatory native jobs for Linux x64/ARM64, macOS
x64/ARM64, and Windows x64, plus a Linux x64 offline container job. Those jobs
must run on their specified runners before a release is published; local Linux
evidence does not substitute for another target.

## Operational contract

Accepted meaning is stored in tracked `.sigil/world/<revision>/assertions.egg`.
The v2 receipt records assertion, normalized identity, and ontology format
versions. `.sigil/receipts`, `.sigil/handoffs`, `.sigil/runs`, `.sigil/cache`,
and `.sigil/beams` are operational and ignored. Generated `.sigil/views` are
tracked when explicitly installed and are excluded from authored discovery.

`sigil doctor --format json` validates the native bridge and TypeScript 7
runtime without reading a project. JSR/library users select a matching runtime
with `SIGIL_RUNTIME_DIR` or the explicit compiler API option. Standalone
archives use the adjacent manifest and reject changed payloads before semantic
execution.

`sigil semantic migrate <root> --format json` previews receipt metadata
migration without writing. Add `--write --expected-revision <revision>` to
publish v2 under the world lock. The migration preserves normalized facts, fact
IDs, world fingerprint, and canonical `.egg` bytes.
