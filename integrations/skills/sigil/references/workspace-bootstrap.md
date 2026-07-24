# Workspace Bootstrap

Complete this procedure before selecting Greenfield, Brownfield, or
established-Sigil work. Configuration state is an input to workflow selection,
not a workflow classification of its own.

## Contents

1. Resolve the target
2. Discover compatible tooling
3. Classify configuration state
4. Bootstrap or validate
5. Hand off to workflow selection
6. Failure policy
7. Examples

## 1. Resolve The Target

Start from the repository, directory, or Sigil path selected by the user. When
the user names no path, use the current repository root when it can be
identified without mutation.

Before interpreting `.sigil` files:

1. search the target and its eligible ancestors for `.sigil/config.json`;
2. distinguish a governing ancestor workspace from an excluded independent
   subtree;
3. identify the selected repository root when no config governs the target;
4. inventory existing `.sigil` paths read-only when config is absent.

Do not infer workspace membership from package manifests, lockfiles, directory
shape, or the mere presence of `.sigil` sources. Existing Sigil without a
governing config is unconfigured evidence, not an established workspace.

Do not search unrelated parent repositories or initialize a broad directory
that the user did not place in scope. If repository-root selection is materially
ambiguous, ask the user before initialization.

## 2. Discover Compatible Tooling

CLI discovery order:

1. use `sigil` when it is available on `PATH`;
2. otherwise, when the current workspace contains
   `packages/cli/src/main.ts`, invoke it with Deno from that workspace root;
3. otherwise stop and ask the user to install a compatible Sigil CLI.

Installed or global command shape:

```bash
sigil check . --format json --pretty
```

Repository-local command shape:

```bash
deno run --allow-read packages/cli/src/main.ts check . --format json --pretty
```

This skill requires CLI and core `^0.6.0` and Sigil `0.5.0`. Do not reinterpret
a workspace using an older project-root-only convention.

## 3. Classify Configuration State

Classify the selected target before semantic work:

| State | Evidence | Action |
| --- | --- | --- |
| Configured | A valid eligible ConfigFile governs the target | Validate in place; never run `init` |
| Unconfigured with Sigil | No ConfigFile governs the target and `.sigil` sources exist | Inventory paths read-only, initialize the selected root, then validate |
| Unconfigured without Sigil | No ConfigFile governs the target and no `.sigil` sources exist | Initialize the selected root, then validate |
| Invalid config | A ConfigFile exists but is malformed, unsupported, or invalid | Preserve it and stop with diagnostics |
| Outside selected target | A discovered config or Sigil path belongs to an unrelated or excluded root | Exclude it from the current bootstrap |

Missing config is not itself a compatibility failure. It becomes a blocking
bootstrap failure only when the target cannot be resolved, compatible tooling is
unavailable, initialization fails, or the resulting workspace is invalid.

Workflow classification never decides whether missing config may be
initialized. Both repositories with implementation and repositories containing
only design Sigil use the same bootstrap.

## 4. Bootstrap Or Validate

### Configured

From the configured workspace root run:

```bash
sigil version <workspace-root> --format json --pretty
sigil check <workspace-root> --format json --pretty
```

Do not run `sigil init`. Preserve config and sources when validation reports
diagnostics.

### Unconfigured With Existing Sigil

Record the existing `.sigil` paths without parsing them as workspace members or
contracts. Then run:

```bash
sigil init <repository-root>
sigil version <repository-root> --format json --pretty
sigil check <repository-root> --format json --pretty
```

Initialization may create `.sigil/config.json`; it must not overwrite existing
config or semantically rewrite existing `.sigil` sources. Diagnostics after
initialization are evidence for reconciliation, not permission to repair files.

Do not classify this state automatically as Brownfield. After validation,
implementation evidence may select Greenfield, Brownfield, or established-Sigil
reconciliation.

### Unconfigured Without Sigil

Run the same initialization and validation sequence. After validation, select
Greenfield when no implementation constrains the requested behavior or
Brownfield when relevant implementation already exists.

Use `sigil init --name`, `--include`, or `--exclude` only when repository facts
or an explicit user decision require non-default values. Do not guess workspace
members or source-selection policy.

## 5. Hand Off To Workflow Selection

Bootstrap returns:

- selected repository and workspace root;
- configuration state encountered;
- ConfigFile path;
- CLI, core, and Sigil versions;
- existing unconfigured Sigil paths, when any;
- check diagnostics and usable partial results;
- excluded independent or unrelated roots;
- initialization mutation, when performed.

Only after this handoff may the agent interpret components, imports, expands,
configured members, or module indexes and choose the semantic workflow.

Use:

- Greenfield for behavior not constrained by existing implementation;
- Brownfield when implementation exists and relevant coverage is missing,
  partial, ambiguous, or drifted;
- established-Sigil review when credible coverage already governs the selected
  boundary.

Existing Sigil plus new config may still require Brownfield reconciliation when
implementation exists or established-Sigil review when it does not. Presence
alone never proves credibility or approval.

## 6. Failure Policy

Stop before semantic workflow selection when:

- compatible CLI discovery fails;
- repository-root selection remains materially ambiguous;
- initialization fails;
- an existing config is invalid;
- resolved CLI, core, or Sigil versions are unsupported;
- a host/runtime failure prevents reliable workspace loading.

Report the command, exit code, diagnostics, selected root, discovered config or
unconfigured paths, and whether initialization created a file.

Never replace an invalid config, rerun initialization over an existing config,
move unconfigured sources, or repair semantic diagnostics without the applicable
approval workflow.

CLI exit codes:

- `0`: completed without error diagnostics;
- `1`: completed with error diagnostics; preserve and inspect partial results;
- `2`: usage error; correct arguments and retry;
- `3`: host/runtime failure; stop before relying on semantics.

## 7. Examples

### Existing Sigil, No Config

The repository contains `architecture/api.sigil` and `#module.sigil` but no
governing `.sigil/config.json`. Inventory both paths, run `sigil init` at the
resolved repository root, validate versions and the workspace, then use code and
Sigil evidence to choose reconciliation or established review. Do not reject the
repository merely because config was initially absent.

### Code, No Sigil

The repository contains implementation but neither config nor Sigil. Initialize
and validate first, then enter Brownfield adoption. Boundary evidence gathering
does not precede bootstrap.

### Design-Only Repository

The repository contains design Sigil but no implementation or config.
Initialize and validate without converting it to Brownfield merely because
Sigil files predate the config.

### Invalid Existing Config

The repository contains `.sigil/config.json`, but it is invalid. Report
diagnostics and stop. Do not run `sigil init` or silently replace it.
