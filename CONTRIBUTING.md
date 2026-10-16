# Contributing to Sigil

This guide takes you from a fresh clone to a passing validation run, then explains
where a change belongs and how to validate semantic artifacts.

New to Sigil itself? Read [README.md](README.md) for what Sigil is and
[PROBLEM.md](PROBLEM.md) for why it exists. This guide assumes you have read
neither the language specification nor the skill workflow; it links to both where
they matter.

## Contents

- [Prerequisites](#prerequisites)
- [Set up the repository](#set-up-the-repository)
- [The validation workflow](#the-validation-workflow)
- [Focused tasks](#focused-tasks)
- [Repository boundaries](#repository-boundaries)
- [Where Sigil belongs](#where-sigil-belongs)
- [The semantic workflow](#the-semantic-workflow)
- [Your first contribution](#your-first-contribution)
- [Versions and compatibility](#versions-and-compatibility)
- [Troubleshooting](#troubleshooting)
- [Opening a pull request](#opening-a-pull-request)

Working on the skills or cutting a release? The
[contributor guide](docs/contributing/README.md) covers both; this page covers
the rest of the repository.

## Prerequisites

| Tool                                                                | Version    | Needed for                                                                                 |
| ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| [Deno](https://docs.deno.com/runtime/getting_started/installation/) | 2.9.2      | Everything. Core, CLI, and LSP are Deno TypeScript.                                        |
| [Node.js](https://nodejs.org/)                                      | 24         | The VS Code extension only, including its share of `deno task check` and `deno task test`. |
| Rust                                                                | 1.91.1     | Native compiler and its release/runtime tests.                                             |
| Git                                                                 | any recent | Cloning and contributing.                                                                  |
| [VS Code](https://code.visualstudio.com/)                           | `^1.91.0`  | Optional. Only if you work on the extension or run its integration tests.                  |

The Deno and Node versions above are exactly what
[CI pins](.github/workflows/ci.yml). Matching them locally is the cheapest way to
avoid a green local run and a red pull request — and for Node it is load-bearing,
not just advisable: the extension's unit tests do not run at all on Node 20.

If you juggle Node versions across projects, a version manager such as
[fnm](https://github.com/Schniz/fnm) or [nvm](https://github.com/nvm-sh/nvm) makes
this painless:

```sh
fnm install 24 && fnm use 24    # or: nvm install 24 && nvm use 24
node --version                  # expect v24.x
```

You do not need a published `sigil` CLI installed to contribute. The repository
runs its own CLI from source.

## Set up the repository

```sh
git clone https://github.com/qoherent/sigil.git
cd sigil
npm ci --prefix integrations/editor/vscode
```

Clone with `git@github.com:qoherent/sigil.git` instead if you have SSH keys set up
for GitHub; pushing a branch needs either SSH or an HTTPS credential helper.

The `deno task package:vscode` task bootstraps these dependencies automatically
when they are absent.

Deno resolves and caches its own dependencies on first use, against the committed
[`deno.lock`](deno.lock), so there is no separate Deno install step.

The `npm ci` step is not optional. `deno task test` and `deno task check` both
delegate part of their work to the extension's npm scripts, and both fail without
`node_modules` present. Run it once after cloning, and again whenever
`integrations/editor/vscode/package-lock.json` changes.

npm 11, which ships with Node 24, prints `npm warn allow-scripts` lines about
`esbuild` and `keytar` during that install. They are expected and safe to ignore;
both packages get their platform binaries from optional dependencies rather than
from the skipped install scripts.

Confirm the environment before you change anything:

```sh
node --version                  # expect v24.x
deno --version                  # expect 2.9.2
deno task check                 # type-checks all four surfaces
```

To use your working copy as the `sigil` command while developing:

```sh
deno task --cwd packages/cli install
sigil --version
```

That installs a launcher that compiles `packages/cli/src/main.ts` from your working
tree on every run, so your edits take effect immediately with no reinstall. It
also prints a harmless warning about the `workspace` field being ignored; see
[Troubleshooting](#troubleshooting).

## The validation workflow

Run these six in order before you open a pull request. This is the same sequence,
in the same order, that [CI](.github/workflows/ci.yml) runs on Ubuntu, macOS, and
Windows.

```sh
deno task fmt
deno task lint
deno task check
cargo fmt --manifest-path packages/core/Cargo.toml -- --check
cargo clippy --locked --manifest-path packages/core/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path packages/sigilc/Cargo.toml -- --check
cargo clippy --locked --manifest-path packages/sigilc/Cargo.toml --all-targets -- -D warnings
deno task test
```

| Step           | What it does                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fmt`          | Checks formatting of every tracked TypeScript source, config, and schema path. **It does not reformat anything** — see below.                                                 |
| `lint`         | Runs `deno lint` across the workspace.                                                                                                                                         |
| `check`        | Type-checks the core, CLI, and LSP entrypoints, the extension with `tsc --noEmit`, and the slotted benchmark scripts.                                                          |
| `cargo fmt`    | Checks formatting of `sigil-core` and `sigilc`. Like `deno task fmt`, it changes nothing.                                                                                                       |
| `cargo clippy` | Lints `sigil-core`, `sigilc` and their tests; any warning fails.                                                                                                                               |
| `test`         | Runs the `sigilc`, core, CLI, LSP, and extension suites, builds `sigilc`, then runs the native protocol, skill, plugin manifest, release branch, and slotted benchmark checks. |

`deno task fmt` is a **check**, not a formatter: it runs `deno fmt --check`, so it
reports unformatted files and fails without touching them. To actually format, run
`deno fmt` on what you changed, or `cargo fmt` for `sigilc`:

```sh
deno fmt packages/core/src packages/core/tests
cargo fmt --manifest-path packages/sigilc/Cargo.toml
```

### Platform differences

**Linux without a display.** `deno task test` includes the VS Code extension
integration suite, which downloads and launches a real VS Code instance. On a
headless Linux machine, wrap it exactly as CI does:

```sh
sudo apt-get install -y xvfb    # once, if you do not have it
xvfb-run -a deno task test
```

On a Linux desktop session, macOS, or Windows, run `deno task test` directly; a VS
Code window appears briefly and closes itself.

**First run downloads VS Code.** The integration suite fetches VS Code stable on
its first run, so that run needs network access and takes noticeably longer.

**Everything else is cross-platform.** All tasks are plain Deno and npm
invocations with no shell-specific syntax, and CI proves them on all three
operating systems on every push.

There is one release-only task, `deno task publish:dry-run`, which CI runs on
Ubuntu only. You rarely need it locally; it verifies that each package would
publish cleanly and that the extension packages.

## Focused tasks

Running the whole suite for a one-line change is wasteful. Each package has its
own task:

| Task                              | Scope                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `deno task test:core:rust`        | `sigil-core` — the Rust workspace reader in `packages/core/rust` (`cargo test`)                |
| `deno task test:sigilc`           | `sigilc` — the native compiler's Rust tests (`cargo test`)                                     |
| `deno task test:core`             | `@qoherent/sigil-core` — parser, resolver, graph, projections, diagnostics                     |
| `deno task test:cli`              | `@qoherent/sigil` — commands, argument parsing, output formatting                                 |
| `deno task test:lsp`              | `@qoherent/sigil-lsp` — lifecycle, diagnostics, symbols, hover, semantic tokens                |
| `deno task test:vscode`           | Extension type-check and unit tests. No VS Code launch.                                        |
| `deno task test:vscode:extension` | Extension integration tests. Launches VS Code.                                                 |
| `deno task test:skill` | Offline metadata, dependencies, links and 0.9 reference reproduction via [`scripts/validate-skill.ts`](scripts/validate-skill.ts) |
| `deno task test:native:protocol` | Native command examples run on disposable fixtures via [`scripts/validate-native-protocol.ts`](scripts/validate-native-protocol.ts) |
| `deno task check:vscode`          | Extension type-check alone                                                                     |

The skill checks and the slotted benchmark have their own pages:
[skill checks](docs/contributing/skills.md#the-rules-and-the-check-for-each) and
[benchmarks](docs/contributing/skills.md#run-the-benchmarks).

To narrow further, call `cargo test` or `deno test` directly. Note that each
package's task supplies its own permission flags, so reuse them:

```sh
# One sigilc test file, filtered by test name
cargo test --manifest-path packages/sigilc/Cargo.toml --test claims_cli refus

# One file (core needs only read access)
deno test --allow-read packages/core/tests/core_test.ts

# One test by name
deno test --allow-read packages/core/tests/core_test.ts --filter "resolves"

# The CLI suite needs write and run permissions as well
deno test --allow-read --allow-write --allow-run packages/cli/tests/cli_test.ts
```

Watch mode is useful while iterating:

```sh
deno test --allow-read --watch packages/core/tests/core_test.ts
```

## Repository boundaries

Core owns deterministic language facts. Native sigilc owns world derivation and
comparison. Frontends present those results; independent workers and coding
orchestration stay outside the toolchain.

| Directory                     | Owns                                                                                                                   | Notes                                                                                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/spec/`                  | The language reference, grammar, authoring guide, configuration and glossary specifications, their JSON schemas, and the Sigil contracts that describe them | The normative definition is [`docs/spec/sigil-reference.md`](docs/spec/sigil-reference.md) with [`docs/spec/sigil.ebnf`](docs/spec/sigil.ebnf); [`docs/spec/sigil-language.md`](docs/spec/sigil-language.md) is the authoring guide. [`docs/spec/sigil-config.sigil`](docs/spec/sigil-config.sigil) owns the implemented language-version literal. |
| `packages/core/`              | Parsing, configuration, workspace discovery, resolution, graphs, projections, glossary matching, diagnostics           | Pure and deterministic. No semantic judgment, no network, no interactive behavior.                                                                                                                                                     |
| `packages/cli/`               | The `sigil` command: authored inspection and formatting | Uses core language APIs; never invokes sigilc or models. |
| `packages/sigilc/` | Native scope, source identity, prepared inputs, disposable worlds, catalogs and fixed semantic gates | Rust; no model runtime or language-specific Implementation adapter. |
| `packages/lsp/`               | The editor-neutral language server over core                                                                           | LSP 3.18 on stdio.                                                                                                                                                     |
| `skills/` | The seven agent skills: understand, evaluate, write, and align for design work, the two computed checks, and `sigil-egglog` | Shared language pack and evaluator-owned review contract; models execute in the host. See [Work on a skill](docs/contributing/skills.md). |
| `integrations/editor/vscode/` | The VS Code extension: syntax, bundled LSP startup, semantic tokens, component preview                                 | The only Node.js code in the repository.                                                                                                                               |
| `examples/`                   | `promise` and `slotted`, each an independently configured workspace                                                    | Design-pressure fixtures, excluded from the root workspace. Not products.                                                                                              |
| `scripts/`                    | Release build, skill validation, native protocol checks, and the slotted benchmark                                     |                                                                                                                                                                        |
| `docs/`                       | End-user [install guides](docs/install/README.md), the quickstart and project setup guide, the specifications in `docs/spec/`, the [contributor guide](docs/contributing/README.md) for skills and releases, and implementation plans in `docs/plans/` |                                                                                                                                                                        |

Dependency direction is one-way: `cli` and `lsp` depend on `core`; the extension
depends on `lsp` and invokes language export/native gates; the skill depends on no
package code. A change that inverts any of those arrows needs discussion before
implementation.

## Where Sigil belongs

This repository specifies parts of itself in Sigil. The workspace in
[`.sigil/config.json`](.sigil/config.json) covers the specifications in
`docs/spec/` (`SpecLanguageReference`, `SpecWorkspaceConfig`,
`SpecWorkspaceGlossary`) and the native compiler in `packages/sigilc/`
(`SigilSemanticCompiler`, `SigilComputedClaims`, and their neighbors). `core`,
`cli`, `lsp`, and the VS Code extension have no contracts and are excluded from
the workspace.

Before changing behavior in a covered area, find the contract that governs it:

```sh
sigil check .                                                       # workspace diagnostics
sigil context . --component SigilComputedClaims --format markdown   # one contract, readable
sigil context . --component SpecWorkspaceConfig --include-dependents  # and who relies on it
sigil graph .                                                       # components and imports
```

`check` and `context` do not validate the same things. `check` covers syntax,
configuration, and resolution. `context` additionally scans `@sigil implements`
annotations across the source tree, so it can exit 1 while `check` exits 0 —
useful, and worth reading rather than ignoring. Exit codes are `0` clean, `1` error
diagnostics, `2` bad arguments, `3` host failure.

Placement rules, from the [language guide](docs/spec/sigil-language.md#4-choose-component-and-facet-boundaries)
and the `sigil-write` skill's
[contract prose rules](skills/sigil-write/references/contract-prose.md):

- **Contracts live beside the code they describe**, in a descriptively named
  file, such as [`packages/sigilc/claims.sigil`](packages/sigilc/claims.sigil) for
  the code in `packages/sigilc/src/claims/`.
- **One declaration per component.** All of a component's contracts belong in
  that one `component` block: `goal` and `interface` are required; `state`,
  `logic`, `constraints`, `cases`, and `decisions` are optional. 0.9 has no
  `expand`.
- **Trivial, safely reconstructable mechanics get no Sigil at all.** Do not create
  one component per file, class, or function.

When you implement something a contract governs, link the code back to it with an
ownership annotation next to the entrypoint definition. It names the Tag and the
sections that describe it:

```rust
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ClaimsCommands interface,constraints
pub fn run(args: &[&str]) -> Output {
```

List only the sections that actually mention that Tag. An annotation naming a
section the contract does not define is an error, and `sigil context` is what
reports it.

Use the language's single-line comment form, its block form when one entrypoint
carries several annotations, and HTML comments in agent-facing Markdown. Never
annotate `.sigil` files, and leave JSON untouched.

## The semantic workflow

Author contracts directly within the requested scope and inspect them with
`sigil check`. Call
native `sigilc` directly (it reads the workspace through `--root`) for ordered scope, stale inspection, preparation,
ingestion, catalogs and Design/Implementation gates. The language CLI does not
invoke the native compiler or a model on the caller's behalf.

Use the
[computed evaluation protocol](skills/sigil-compute-design/references/computed-evaluation.md)
for exact commands. External interpreters reconstruct each source from prepared
inputs; Implementation interpreters receive only source bytes, fixed ontology and
identity catalog. Keep Design prose, neighboring code and binding files out of
those inputs. The external host owns scheduling, isolation, source edits and
iteration.

Generated `.sigil/worlds/` is ignored and disposable. Current native reports own
semantic states and diagnostics. Design Coherent/Loose and Implementation
Closed/Converged exit 0; Disjoint and Drift exit 1 on their respective gates.
Unavailable comparison remains unset. Tests, ownership comments and a completed
gate do not individually prove full delivery or faithful reconstruction.

`deno task test:native:protocol` executes the documented native commands on
disposable fixtures. Build both tools first with
`deno task build:sigilc` and `deno task build:cli`, or set `SIGIL_TEST_LANGUAGE`
and `SIGIL_TEST_COMPILER` to the intended binaries. The root test task builds its
prerequisites. The fixed fixtures exercise the protocol, not independent
reconstruction of this repository. Release smoke tests cover all six gate states
from a relocated distribution.

A change to a specification in `docs/spec/` also changes the language pack that
`sigil-understand` carries. Regenerate it with
`deno run --allow-read --allow-write scripts/sync-skill-language.ts` and commit
the result with the specification change; the
[skill checks](docs/contributing/skills.md#the-rules-and-the-check-for-each)
fail until you do. Pass `--revision <full-commit-sha>` only when updating the
background-link pin. Only documentary link destinations may change; fenced
examples and inline code remain source text.

Package checks are distinct from model behavior. A change to what an agent
follows needs an [observed eval](docs/contributing/skills.md#run-an-observed-eval);
summarize its actual outcome in your pull request. Do not claim independent
review from a writer's self-assessment.

Delete obsolete behavior and its dedicated callers/tests during refactors.
Preserve required frontend features through actual native infrastructure rather
than a compatibility facade. Human decisions about publication, deployment or
unrelated product actions remain outside the compiler and the skill.

## Your first contribution

A worked example for a change that needs no Sigil proposal — adding a test case to
`sigilc`.

```sh
# 1. Branch from main.
git checkout main && git pull
git checkout -b my-change

# 2. Establish a clean baseline before you touch anything.
deno task test:sigilc

# 3. Find the contract that governs the behavior you are testing.
sigil context . --component SigilComputedClaims --format markdown
```

Read the contract's `cases` section. If the behavior you want to test is already
described there, your test is mechanical. If it is not described, record the
missing contract behavior in the appropriate authored Sigil and add a focused case
before relying on the test as semantic coverage.

```sh
# 4. Add the test beside its peers.
#    packages/sigilc/tests/claims_cli.rs

# 5. Run the focused suite while iterating.
cargo test --manifest-path packages/sigilc/Cargo.toml --test claims_cli my_new_case

# 6. Format what you changed, then run the six validation steps above.
cargo fmt --manifest-path packages/sigilc/Cargo.toml

# 7. Commit and open a pull request against main.
```

If your change touches a public contract, update the governing authored Sigil and
its cases alongside the implementation, then run the semantic and ordinary
validation commands that cover the changed boundary. A clean check does not
replace those tests, and a worker response does not replace deterministic compiler
verification.

## Versions and compatibility

Four version lines move independently, and [COMPATIBILITY.md](COMPATIBILITY.md) is
the authority on how they relate:

- **Sigil language and `.sigil/config.json` schema** — currently 0.9.0, owned by
  the single literal in
  [`docs/spec/sigil-config.sigil`](docs/spec/sigil-config.sigil).
- **Package artifacts** — independently versioned, owned by each package manifest
  (`core` 0.8.0, `cli` 0.9.0, `lsp` 0.8.0, and `sigilc` 0.3.0 in its
  `Cargo.toml`).
- **VS Code extension** — owned by its `package.json`.
- **Agent skills** — each owns `VERSION` and `compatibility.json` in its
  `skills/<name>/` directory. The design skills declare language
  and sibling requirements independently.

A skill's own `VERSION` follows the
[rules for skills](docs/contributing/skills.md#when-to-bump-a-version), and a
release is cut as [the release guide](docs/contributing/releasing.md) describes;
skill changes reach users only at the next CLI release.

Do not bump a version as a side effect of another change, and do not duplicate a
version literal into a second file. The one exception is the CLI release version:
the agent plugin manifests and the installer URLs in the `sigil-compute-design`
skill repeat it, and they change together only in the
[release-cut commit](docs/contributing/releasing.md#the-release-cut-commit).
A tool must reject a `sigilVersion` it does not explicitly support. Everything here is pre-production; see
[PRE_RELEASE.md](PRE_RELEASE.md). User-visible changes belong in
[CHANGELOG.md](CHANGELOG.md).

## Troubleshooting

**`deno task fmt` fails and changes nothing.** Expected — it is a check. Run
`deno fmt <the paths it named>` to fix, then rerun the task.

**`deno task test` or `deno task check` fails in the extension.** You almost
certainly skipped `npm ci --prefix integrations/editor/vscode`, or
`package-lock.json` changed since you last ran it. A bare `tsc: not found` from
`deno task check` is always this.

**`Could not find '.../tests/unit/**/*.test.ts'` during `test:vscode`.** Your
Node.js is older than 24. The extension's unit tests are selected by a recursive
glob that the shell leaves unexpanded, so resolving it falls to the Node test
runner, and older runners report the pattern itself as missing instead. Run
`node --version`; if it is not 24, install Node 24 and rerun. Nothing is wrong with
your checkout.

**`npm warn allow-scripts` during `npm ci`.** Expected on npm 11. See
[Set up the repository](#set-up-the-repository) — the skipped install scripts are
not needed.

**Extension integration tests fail on Linux with a display or Xvfb error.** Use
`xvfb-run -a deno task test`, as CI does. To skip that suite while iterating on
something unrelated, run the focused tasks instead of `deno task test`.

**The first extension test run hangs or times out.** It is downloading VS Code
stable. Confirm network access and let it finish; later runs reuse the download.

**`Warning "workspace" field in the specified config file will be ignored`** when
running `deno task --cwd packages/cli install`. Harmless. The install task points
Deno at the root config for import resolution, and Deno notes that it is ignoring
the workspace list in that context.

**`sigil` on your PATH behaves unexpectedly after switching branches.** The
development install compiles from your working tree on every run, so it always
reflects the branch you have checked out. Reinstall with
`deno task --cwd packages/cli install` only after changing the task itself.

**`deno.lock` shows unexpected changes.** The repository commits its lockfile with
locking enabled. Let Deno update it as a result of a real dependency change,
review that diff like any other, and do not hand-edit it.

**`cargo fmt` or `cargo clippy` fails in CI but `deno task fmt` passed locally.**
The Deno tasks do not cover `sigilc`. Run the two `cargo` steps from
[The validation workflow](#the-validation-workflow) too.

**`Ownership annotation references section X without a matching occurrence` from
`sigil context`.** An `@sigil implements` annotation claims a section that does not
mention its Tag. Either drop that section from the annotation, or add the missing
occurrence to the contract — the second option is a semantic change and goes
through the proposal gate. `sigil check` does not catch this, so `sigil context`
can exit 1 on a workspace that checks clean.

**A test needs a real workspace.** Use the workspaces in `examples/`, or build a
temporary one in the test as the `sigilc` and CLI suites do, rather than creating
one by hand outside the repository.
The extension integration suite opens [`examples/slotted`](examples/slotted) as
its workspace.

## Opening a pull request

Open pull requests against `main`. CI runs formatting, linting, type checking, and
the full test suite on Ubuntu, macOS, and Windows for every push and pull request,
plus a publish dry run on Ubuntu; all of it must pass.

Before you open one:

- the six validation steps pass locally;
- any `.sigil` change was proposed and approved before it was written;
- new behavior in an area a contract governs carries an ownership annotation
  pointing at that contract;
- a change to text an agent follows in a skill bumps that skill's `VERSION` in the
  same commit, by the [rules for skills](docs/contributing/skills.md#when-to-bump-a-version);
  the CLI version, plugin manifests and installer pin change only in a release-cut
  commit;
- user-visible changes are noted in [CHANGELOG.md](CHANGELOG.md).

Unsure whether something needs a Sigil proposal, or which boundary should own your
change? Ask in the pull request or the issue before implementing. That conversation
is cheaper than an approved implementation in the wrong place.
