# Semantic migration completion report

This report is the product-facing validation record for the remaining scope in
[`compile.md`](../compile.md). It records what is implemented, what was executed
in the Linux source checkout, and which release checks still require the
specified CI runners. It does not treat an unexecuted platform check as a pass.

Installed-package world capture, target dependency capture/freezing/staging,
implementation patch loops, coding-agent orchestration, speculative ontology
expansion, and automatic publication are intentionally excluded.

## Implementation status

The source-checkout implementation is usable on Linux. The semantic compiler,
managed views, proposal/configuration workflow, editor/LSP integration, pinned
runtime resolver, state migration, and crash-safe beam storage are committed.
The release builder, installers, and CI matrix are also committed. Release
publication remains gated on executing the matrix on Linux x64/ARM64, macOS
x64/ARM64, and Windows x64, including the Linux offline container job.

The implementation range starts at the remaining-scope specification commit
`ff82926` and currently ends at `be5f258`:

| Group | Commit | Delivered behavior |
| --- | --- | --- |
| S01 | `150a6d1` | Shared workspace context and canonical target identity |
| S02 | `e460b9d` | Deterministic managed views, receipts, transactional publication and recovery |
| S03 | `009f425` | Strict proposal/question transport and four semantic providers |
| S04 | `c3afea2` | Semantic provider configuration and legacy migration |
| S05 | `bcd7fbc` | VS Code semantic commands and managed-view LSP navigation |
| S06 | `ce2c3b2` | Skill, adapter, schema, and workflow documentation migration |
| S07 | `d424934` | Pinned runtime manifest, resolver, native handshake and doctor |
| S08 | `3fb4430`, `bf2ab6e`, `10244a6`, `136f8fc`, `19507a1`, `cdf5b31`, `9da0997`, `81fa824`, `73bbb66`, `be5f258` | Native distribution builder, standalone bootstrap, offline Linux archive gate, published-consumer fixture, source-independent artifact-consumer matrix, per-target installer consumer, per-target published-runtime consumer, CI matrix and immutable installers |
| S09 | `5764358` | Receipt v2 migration, profile/runtime identity and evidence provenance |
| S10 | `b18c908` | Permanent cancellable beam locks and synced atomic writes |
| S11 | `5d95205`, `21dc1dd`, `10fb394`, `8a3a561`, `668b8f1`, `1df050b`, `9a208b2`, `3ba636f`, `a2d46d9`, `edb6818`, `359ce43`, `338e5a7`, `6ae3e66`, `bc7da66`, `45b6dd3`, `bf2ab6e`, `136f8fc`, `19507a1`, `a1b54b2`, `f86f88f`, `e53f3e3` | Public-interface integration assertions, canonical-view targeting/report metadata, validated inventory listings, runtime/installer hardening, managed-view directory targeting and recovery, strict checkpoint parsing, offline release enforcement, packaged public-flow validation, editor fake-CLI validation, published-consumer validation, the combined semantic-flow fixture, and the completion report |

## Versions and reproducibility

- TypeScript runtime: npm `typescript@7.0.2`, through its native TypeScript 7
  executable and adjacent standard-library files.
- Egglog: pinned git revision
  `90635860397ce710f8c0a4eeb04154a8ebc3ac05` (`egglog` 3.0.0 in
  `packages/compiler/native/Cargo.lock`).
- Native toolchain contract: Rust `1.91` as declared by
  `packages/compiler/native/Cargo.toml`.
- Local command environment used for the final source checks: Deno 2.9.6,
  Node 26.7.0 and npm 11.19.0 on Linux x86_64. The package itself resolves
  TypeScript 7.0.2 through its pinned import; the host Deno compiler version is
  not the semantic analyzer version.
- Every accepted world, receipt, handoff, evidence bundle and release manifest
  carries content or version identity. Re-running a command with the same
  inputs therefore produces the same canonical `.egg` bytes and artifact IDs.

## Acceptance matrix

Statuses have the following meaning: **PASS (Linux)** means the named test was
executed in this checkout; **PASS (local archive)** means the staged Linux x64
archive or installer seam was executed; **CI required** means implementation is
present but the required cross-platform or offline runner has not run here;
**PARTIAL** means the available tests cover the implementation but not every
step of the single end-to-end fixture required by `compile.md` section 11.1.

### Managed views (V)

| ID | Test/evidence | Platform | Result |
| --- | --- | --- | --- |
| V01 | `packages/compiler/tests/managed_views_test.ts`; `packages/compiler/tests/semantic_projection_test.ts` | Linux source | PASS (Linux) |
| V02 | `packages/compiler/tests/managed_views_test.ts` | Linux source | PASS (Linux) |
| V03 | `packages/compiler/tests/managed_views_test.ts`; `packages/compiler/tests/component_registry_test.ts` | Linux source | PASS (Linux) |
| V04 | `packages/compiler/tests/managed_views_test.ts`; `packages/compiler/tests/compile_artifacts_test.ts` | Linux source | PASS (Linux) |
| V05 | `packages/compiler/tests/component_registry_test.ts`; `packages/cli/tests/semantic_commands_test.ts` | Linux source | PASS (Linux) |
| V06 | `packages/compiler/tests/component_registry_test.ts`; `packages/compiler/tests/verify_return_test.ts` | Linux source | PASS (Linux) |
| V07 | `packages/compiler/tests/managed_views_test.ts` | Linux source | PASS (Linux) |
| V08 | `packages/compiler/tests/managed_views_test.ts` | Linux source | PASS (Linux) |
| V09 | `packages/compiler/tests/managed_views_test.ts` | Linux source | PASS (Linux) |
| V10 | `packages/compiler/tests/managed_views_test.ts` | Linux source | PASS (Linux) |
| V11 | `packages/compiler/tests/managed_views_test.ts` | Linux source | PASS (Linux) |
| V12 | `packages/compiler/tests/managed_views_test.ts` | Linux source | PASS (Linux) |
| V13 | `packages/compiler/tests/managed_views_test.ts`; `packages/compiler/tests/verification_test.ts` | Linux source | PASS (Linux) |
| V14 | `packages/compiler/tests/compile_artifacts_test.ts` | Linux source | PASS (Linux) |
| V15 | `packages/compiler/tests/managed_views_test.ts`; `packages/lsp/tests/`; `integrations/editor/vscode/tests/` | Linux source | PASS (Linux) |
| V16 | `packages/compiler/tests/managed_views_test.ts`; `packages/compiler/tests/compile_artifacts_test.ts` | Linux source | PASS (Linux) |

### Proposal and configuration transport (P/C)

| ID | Test/evidence | Platform | Result |
| --- | --- | --- | --- |
| P01 | `packages/compiler/tests/proposal_protocol_test.ts`; adapter package suites | Linux source | PASS (Linux) |
| P02 | `packages/compiler/tests/proposal_protocol_test.ts`; `packages/compiler/tests/semantic_intent_test.ts` | Linux source | PASS (Linux) |
| P03 | `packages/compiler/tests/proposal_protocol_test.ts`; adapter package suites | Linux source | PASS (Linux) |
| P04 | `packages/compiler/tests/proposal_protocol_test.ts` | Linux source | PASS (Linux) |
| P05 | adapter package suites; `packages/compiler/tests/semantic_intent_test.ts` | Linux source | PASS (Linux) |
| P06 | adapter package suites; subprocess regression tests | Linux source | PASS (Linux) |
| P07 | `packages/compiler/tests/semantic_intent_test.ts` | Linux source | PASS (Linux) |
| P08 | `packages/cli/tests/config_authoring_test.ts`; `packages/cli/tests/semantic_commands_test.ts` | Linux source | PASS (Linux) |
| P09 | `packages/cli/tests/semantic_commands_test.ts`; `packages/compiler/tests/verification_test.ts` | Linux source | PASS (Linux) |
| P10 | adapter package suites; `packages/cli/tests/semantic_commands_test.ts` | Linux source | PASS (Linux) |
| C01 | `packages/cli/tests/config_authoring_test.ts` | Linux source | PASS (Linux) |
| C02 | `packages/cli/tests/semantic_commands_test.ts` | Linux source | PASS (Linux) |
| C03 | `packages/compiler/tests/provider_config_test.ts` | Linux source | PASS (Linux) |
| C04 | `packages/cli/tests/config_authoring_test.ts` | Linux source | PASS (Linux) |
| C05 | `packages/cli/tests/config_authoring_test.ts` | Linux source | PASS (Linux) |
| C06 | `packages/compiler/tests/provider_config_test.ts`; `packages/cli/tests/config_authoring_test.ts` | Linux source | PASS (Linux) |
| C07 | `packages/cli/tests/config_authoring_test.ts` | Linux source | PASS (Linux) |
| C08 | `packages/cli/tests/config_authoring_test.ts` | Linux source | PASS (Linux) |
| C09 | `packages/cli/tests/semantic_commands_test.ts` | Linux source | PASS (Linux) |

### Editor, LSP and documentation (E)

| ID | Test/evidence | Platform | Result |
| --- | --- | --- | --- |
| E01 | `integrations/editor/vscode/tests/`; `packages/lsp/tests/` | Linux source | PASS (Linux) |
| E02 | `integrations/editor/vscode/tests/` | Linux source | PASS (Linux) |
| E03 | `integrations/editor/vscode/tests/` | Linux source | PASS (Linux) |
| E04 | `integrations/editor/vscode/tests/`, including the fake-CLI semantic handoff sequence | Linux source | PASS (Linux) |
| E05 | `integrations/editor/vscode/tests/`; `packages/cli/tests/returned_implementation_test.ts` | Linux source | PASS (Linux) |
| E06 | `integrations/editor/vscode/tests/` | Linux source | PASS (Linux) |
| E07 | `integrations/editor/vscode/tests/`; `packages/compiler/tests/verification_test.ts` | Linux source | PASS (Linux) |
| E08 | `packages/lsp/tests/`; `packages/compiler/tests/managed_views_test.ts` | Linux source | PASS (Linux) |
| E09 | `packages/lsp/tests/`; `integrations/editor/vscode/tests/`; Xvfb-backed extension-host run | Linux source | PASS (Linux) |
| E10 | `scripts/validate-skill.ts`; `packages/compiler/skills/`; adapter suites | Linux source | PASS (Linux) |
| E11 | `packages/cli/tests/semantic_commands_test.ts`; `packages/cli/tests/returned_implementation_test.ts` | Linux source | PASS (Linux) |

### Runtime and release (R)

| ID | Test/evidence | Platform | Result |
| --- | --- | --- | --- |
| R01 | `scripts/test-cli-release.ts`; staged archive smoke run from an unrelated cwd after relocation to a path containing spaces and Unicode | Linux x86_64 | PARTIAL (local archive; target matrix required) |
| R02 | Standalone archive smoke run with bundled bootstrap and no project cwd dependency; packaged public intent/accept/project/slice/receipt/verify flow | Linux x86_64 | PASS (local archive) |
| R03 | `scripts/test-cli-release.ts` validates doctor/design with isolated caches; `native-release.yml` enforces the Linux x64 `--network none` container smoke | Linux x86_64 offline container | PARTIAL (Linux x64 pass; all-target matrix required) |
| R04 | Native Egg assertions and source reconstruction pass in `packages/compiler/tests/compile_artifacts_test.ts` | Linux source | PASS (Linux); archive matrix still required |
| R05 | TypeScript 7 native fixture tests in `packages/compiler/tests/typescript7_test.ts` | Linux source | PASS (Linux); archive matrix still required |
| R06 | Handoff/receipt fixtures pass in compiler and CLI suites; packaged archive runs the public handoff/receipt flow | Linux source + x86_64 archive | PASS (local); archive matrix still required |
| R07 | Runtime manifest tamper and missing-library rejection in `scripts/test-cli-release.ts`; wrong-target and all-target checks remain matrix checks | Linux x86_64 | PARTIAL (local archive; tamper and missing-library branches pass) |
| R08 | Cancellation cleanup passes in native source tests; all target process-cleanup runs remain required | Linux source | CI required |
| R09 | `install.sh`/PowerShell local archive consumers exercise checksum/doctor/selection and same-version reinstall; the source-independent matrix also rejects a corrupt existing manifest | Linux x86_64 + target matrix | PARTIAL (Linux consumer pass; all-target matrix remains required) |
| R10 | Immutable version/manifest installation logic is implemented; reinstall/conflict matrix is not run here | All release targets | CI required |
| R11 | Relocatable archive layout is implemented; copy-only-bin negative test remains in the release matrix | All release targets | CI required |
| R12 | Explicit `SIGIL_RUNTIME_DIR` library seam is implemented; staged published-consumer fixture runs during every target archive build and passes locally | Linux x86_64 + target matrix | PARTIAL (Linux consumer pass; all-target matrix remains required) |

### State, invalidation and beam recovery (I/B)

| ID | Test/evidence | Platform | Result |
| --- | --- | --- | --- |
| I01 | `packages/compiler/tests/compile_artifacts_test.ts`; `packages/compiler/tests/semantic_runtime_test.ts` | Linux source | PASS (Linux) |
| I02 | `packages/compiler/tests/compile_artifacts_test.ts` | Linux source | PASS (Linux) |
| I03 | `packages/compiler/tests/compile_artifacts_test.ts`; `packages/cli/tests/semantic_commands_test.ts` | Linux source | PASS (Linux) |
| I04 | `packages/compiler/tests/compile_artifacts_test.ts` | Linux source | PASS (Linux) |
| I05 | `packages/compiler/tests/semantic_runtime_test.ts`; `packages/compiler/tests/verification_test.ts` | Linux source | PASS (Linux) |
| I06 | `packages/compiler/tests/managed_views_test.ts` | Linux source | PASS (Linux) |
| I07 | `packages/compiler/tests/typescript7_test.ts`; `packages/compiler/tests/verification_test.ts` | Linux source | PASS (Linux) |
| I08 | `packages/compiler/tests/compile_artifacts_test.ts`; `packages/compiler/tests/semantic_runtime_test.ts` | Linux source | PASS (Linux) |
| I09 | `packages/compiler/tests/verify_return_test.ts`; `packages/compiler/tests/handoff_receipts_test.ts` | Linux source | PASS (Linux) |
| I10 | `packages/compiler/tests/verify_return_test.ts`; `packages/compiler/tests/receipt_kernel_test.ts` | Linux source | PASS (Linux) |
| I11 | `packages/compiler/tests/verification_test.ts`; `packages/compiler/tests/verify_return_test.ts` | Linux source | PASS (Linux) |
| I12 | `packages/compiler/tests/compile_artifacts_test.ts`; CLI report tests | Linux source | PASS (Linux) |
| B01 | `packages/compiler/tests/beam_store_test.ts` | Linux source | PASS (Linux) |
| B02 | `packages/compiler/tests/beam_store_test.ts`; atomic artifact tests | Linux source | PASS (Linux) |
| B03 | `packages/compiler/tests/beam_store_test.ts` | Linux source | PASS (Linux) |
| B04 | `packages/compiler/tests/beam_store_test.ts` | Linux source | PASS (Linux) |
| B05 | `packages/compiler/tests/beam_store_test.ts` | Linux source | PASS (Linux) |
| B06 | `packages/compiler/tests/beam_store_test.ts` | Linux source | PASS (Linux) |
| B07 | `packages/compiler/tests/beam_store_test.ts` | Linux source | PASS (Linux) |
| B08 | `packages/compiler/tests/beam_store_test.ts` | Linux source | PASS (Linux) |
| B09 | Native release matrix and per-target process/file-cleanup jobs | Linux/macOS/Windows | CI required |

### Full public-interface fixture

`packages/cli/tests/semantic_commands_test.ts` now runs one public fixture
through intent, ambiguity, exact answer, acceptance, projection and recovery,
provider-config migration and beam invalidation, canonical component slices,
handoff, receipt import, supported and decoy returned receipts, prohibited and
opaque code outcomes, a failed mandatory check, orphan-beam handling and
forged-view drift. `scripts/test-cli-release.ts` runs the packaged archive
through intent, acceptance, managed projection, canonical slice, receipt import
and verification; the VS Code unit suite runs the equivalent fake-CLI transport
sequence. Existing compiler tests add the v1 accepted-state preview and CAS
migration coverage. The five-target release matrix now includes a
source-independent artifact-consumer and local installer/reinstall consumer for
every target. Those runners still must execute before the complete section 11.1
gate can be marked green, so the gate is **PARTIAL** only for that external
matrix.

## Validation commands and results

The following final commands were executed after the S11 changes:

| Command | Result |
| --- | --- |
| `deno check packages/compiler/src/mod.ts packages/cli/src/main.ts` | Pass |
| `deno task fmt` | Pass |
| `deno lint` | Pass, 171 files checked |
| `deno task check` | Pass, including VS Code TypeScript check |
| `deno task test:compiler` | Pass, 106 tests |
| `deno task test:cli` | Pass, 82 tests |
| `deno task test:core` | Pass |
| `deno task test:compiler-adapter-opencode` | Pass |
| `deno task test:compiler-adapter-pi` | Pass |
| `deno task test:compiler-adapter-claude` | Pass |
| `deno task test:compiler-adapter-codex` | Pass |
| `deno task test:lsp` | Pass |
| `deno task test:vscode` | Pass, 21 tests |
| `deno task test:skill` | Pass |
| focused beam, migration and returned-verification tests | Pass, 11 tests |
| `deno test --allow-env --allow-read --allow-write --allow-run packages/cli/tests/semantic_commands_test.ts --filter 'public semantic flow'` | Pass |
| `scripts/test-cli-release.ts --distribution /tmp/sigil-extracted-final23/sigil-0.7.1` | Pass; packaged public flow and runtime-failure branches |
| `DISPLAY=:99 deno task test:vscode:extension` under Xvfb | Pass |
| `deno task test:published-runtime --runtime /tmp/sigil-extracted-final23/sigil-0.7.1/lib/sigil/runtime` | Pass; staged Compiler consumer rejects missing runtime and passes explicit-runtime doctor |
| `cargo fmt --check` (Rust 1.91, `packages/compiler/native`) | Pass |
| `cargo clippy --locked -- -D warnings` (Rust 1.91, `packages/compiler/native`) | Pass |
| Rust 1.91 source-independent release consumer against final23 archive | Pass; version, doctor, isolated semantic fixture and hostile-tool PATH checks |
| staged `x86_64-unknown-linux-gnu` archive: version, doctor, relocation/isolation, semantic fixture, tamper and missing-runtime/library rejection | Pass |
| extracted `x86_64-unknown-linux-gnu` archive in Docker with `--network none`: version, doctor and semantic-design fixture | Pass (Linux x86_64) |
| local `install.sh` checksum/doctor/selection seam | Pass |
| local `install.sh` bad-checksum and doctor-failure retention seam | Pass; prior selected wrapper remains unchanged |

Raw outputs remain in the private `.codex-progress/logs/` folder and are not
part of the product repository.

## Storage and trust contract

Accepted meaning is tracked as canonical
`.sigil/world/<revision>/assertions.egg`. The Egg representation contains only
the fixed assertion forms accepted by the native bridge; it cannot define or
execute rules. Turtle is optional interchange. Removing Turtle, generated
views, runs or caches does not prevent accepted-world reconstruction.

`.sigil/receipts`, `.sigil/handoffs`, `.sigil/runs`, `.sigil/cache` and
`.sigil/beams` hold operational artifacts and are ignored. Generated
`.sigil/views` files and `views/current.json` are managed workspace files and
are excluded from authored semantic discovery. Every receipt, handoff and
evidence result is independently checked; matching hashes never become trusted
facts by themselves.

The v2 accepted-state receipt records assertion, identity and ontology format
versions. `sigil semantic migrate <root> --format json` previews a v1-to-v2
metadata migration without writing. `--write --expected-revision <revision>`
publishes it under the world lock and preserves normalized facts, fact IDs,
world fingerprint and canonical `.egg` bytes. Unknown receipt, identity,
assertion or ontology versions are rejected. Legacy v1 state remains readable
until an explicit migration or later acceptance writes v2.

The runtime manifest binds the target, Sigil version, Egglog executable,
TypeScript 7 executable and every shipped file hash. `sigil doctor --format json`
validates this bundle without reading a project. Standalone archives use
their adjacent runtime. Library callers must pass `SIGIL_RUNTIME_DIR` or the
equivalent explicit compiler option; a missing or mismatched runtime fails
before semantic execution.

## Public usage

Configure semantic providers in the separate semantic provider namespace, then
run the deterministic intent flow:

```sh
sigil semantic intent . --text "Add a parser component" --proposals proposals.json --format json
sigil semantic status . --beam parser --format json
sigil semantic answer . --beam parser --fact <fact-id> --value yes
sigil semantic accept . --beam parser --format json
sigil semantic project . --format sigil
sigil semantic project . --write --expected-revision <revision>
sigil semantic project . --check --format json
sigil semantic project . --recover --transaction <transaction> --format json
sigil semantic slice . --component Parser --format text
```

Create a retained assignment with the handoff command, import an untrusted
receipt bundle into `.sigil/receipts`, and run `sigil semantic verify` against
the returned checkout. Verification reparses the retained `.egg`, resolves
TypeScript 7 locations independently, executes the fixed Egglog kernel and
reports receipt claims separately from whole-scope coverage.

Check the installed runtime from any directory:

```sh
sigil doctor --format json
```

List validated documentary inventory without selecting or mutating it:

```sh
sigil semantic status . --list components --format json
sigil semantic status . --list beams --format json
sigil semantic status . --list handoffs --format json
sigil semantic status . --list receipts --format json
```

For compiler-library use, select the compatible runtime explicitly:

```sh
SIGIL_RUNTIME_DIR=/path/to/sigil-runtime <your-program>
```

Migrate accepted-state metadata explicitly:

```sh
sigil semantic migrate . --format json
sigil semantic migrate . --write --expected-revision <revision> --format json
```

## Intentional limitations and release gate

The verifier certifies the defined static relations and host-selected checks.
Unsupported dynamic behavior remains yellow. Providers supply hypotheses and
wording; they never supply laws, verdicts or trusted evidence. Optional
external providers and check tools remain caller-owned.

The implementation is ready for source-checkout use on Linux. The remaining
release gate is operational evidence from the five native target jobs and the
complete single-fixture sequence described in `compile.md`; the Linux x64
offline container and Xvfb-backed extension-host checks now pass locally. No
target dependency tree is scanned, copied or frozen by these operations.
