# sigil-cli Requirements

**Status:** Accepted for 0.7.1 **Last updated:** 2026-08-04

This document defines the 0.7 product requirements for `sigil-cli`.

`sigil-cli` is the command-line interface over `sigil-core`. It exists for
agents, CI, scripts, debugging, and review/documentation workflows. It is not
the primary human authoring UI.

## 1. Purpose

`sigil-cli` gives users and automation a stable way to inspect, validate, and
extract information from Sigil workspaces.

It should make the shared `sigil-core` model usable from a terminal without
reinterpreting Sigil independently.

## 2. Version 0.7 Scope

Version 0.7 must provide commands to:

- parse one Sigil file;
- check a file or workspace for diagnostics;
- resolve a workspace and expose graph data;
- produce deterministic agent-oriented context output;
- render a simple Markdown review view.
- initialize a non-interactive versioned workspace config;
- report CLI, core, and Sigil versions.
- surface concept-identifier diagnostics and resolved concept namespaces.
- accept a deterministic semantic world from untrusted proposal assertions;
- inspect and publish managed `.sigil` views;
- export retained implementation handoffs, import untrusted receipts, and
  verify returned code with fresh host observations;
- initialize and report the tracked/ignored `.sigil` artifact layout.

Version 0.7 should favor predictable, machine-readable behavior over rich
terminal UI.

## 3. Out Of Scope

Version 0.7 must not implement:

- editor UI;
- LSP transport;
- VS Code APIs;
- Codex-specific prompt behavior;
- embeddings or semantic search;
- interactive terminal workflows;
- watch mode;
- generated diagrams;
- anchors or code/spec synchronization;
- automatic mutation of authored source or implementation files.

Generated managed views and semantic metadata are explicit, bounded mutation
surfaces. They never replace authored contracts or become a second source of
semantic authority.

Anchors remain outside the implemented 0.5 surface. The rejected historical
anchor surface is defined below and does not change the 0.6 acceptance criteria.

## 4. Runtime And Dependency Requirements

`sigil-cli` is implemented in TypeScript 7-compatible Deno modules. Standalone
archives carry the pinned native egglog and TypeScript 7.0.2 runtime; published
library callers must provide a matching runtime explicitly.

`sigil-cli` must depend on `sigil-core` for:

- parsing;
- workspace discovery;
- import resolution;
- graph construction;
- diagnostics;
- primitive projections.

`sigil-cli` may own:

- argument parsing;
- process exit codes;
- stdout and stderr formatting;
- concrete filesystem adapter for Deno;
- command-specific output shaping.

`sigil-cli` must not duplicate parser, resolver, graph, or diagnostic logic from
`sigil-core`.

## 5. Global Behavior

`--help` at the top level or after any recognized command path must print help
for that path and exit with code `0` without validating required operands,
discovering a workspace, or executing the command. Path-scoped help must show
that path's usage, operands, options, and immediate subcommands.

Empty, unknown, incomplete, or invalid invocations must exit with code `2`,
leave stdout empty, and write both the specific problem and help for the longest
recognized command path to stderr.

All commands should support:

- `--root <path>` to supply an explicit workspace root;
- `--format json` for machine-readable output where the command returns
  structured data;
- `--pretty` for human-readable JSON indentation;
- `--quiet` for commands where only exit status matters.

All machine-readable outputs that depend on workspace behavior must include:

- resolved workspace root;
- config path, Sigil version, and workspace name;
- diagnostics;
- command-specific data.

Diagnostic output must include stable diagnostic codes from `sigil-core`.

## 6. Exit Codes

Exit codes should be stable:

- `0`: command completed with no error diagnostics;
- `1`: command completed and found one or more error diagnostics;
- `2`: command usage error, invalid arguments, or unsupported option;
- `3`: host/runtime failure such as unreadable input outside normal Sigil
  diagnostics.

Warnings alone should not produce exit code `1`. In particular,
`SIGIL_MISSING_CONCEPT_IDENTIFIER` must be visible in human and JSON output
while preserving exit code `0` when no errors exist, so users and agents can act
on it.

## 7. Commands

### `sigil skill list` and `sigil skill install`

`skill list` enumerates immediate directories containing `SKILL.md` in the
running Sigil installation's `integrations/skills` directory without changing
the filesystem.

`skill install` installs globally by default. Codex, OpenCode, and Pi share
`~/.agents/skills`; Claude Code uses `~/.claude/skills`. `--project` selects the
equivalent locations under the current repository. `--agent` limits the target
to one supported agent.

Project installation creates skill-directory `.gitignore` entries. Existing
unrelated ignore rules are preserved. Installation records managed destinations
so a later selected CLI version can update them while refusing to replace
unmanaged files, directories, or links. Relative directory links are preferred;
a managed copy is used when the host does not permit directory links.

The installed skill source is resolved from the running CLI installation, not
from the target repository. A versioned binary distribution should place the
binary at `<version>/bin/sigil` and its skills at
`<version>/integrations/skills`. Source-based development installs may resolve
the repository's top-level `integrations/skills` directory.

Skill commands accept no positional path beyond `list` or `install` and do not
accept `--root`. CLI workspace discovery does not traverse symlink entries, so
linked project skills are not loaded as duplicate workspace sources.

### `sigil parse <file>`

Parses one Sigil source file and returns the parsed document plus diagnostics.

Default output should be JSON.

Required output data:

- file path;
- imports;
- components;
- expands;
- semantic units;
- diagnostics.

This command should not load or resolve a full workspace unless a later option
explicitly asks for it.

### `sigil check [path]`

Loads and resolves a Sigil workspace or target path and reports diagnostics.

If `path` is omitted, the command should use the current working directory as
the command target.

Required output data for JSON:

- workspace root;
- config path and selected Sigil version;
- workspace name;
- diagnostic list;
- diagnostic counts by severity.

Default human output may be concise text, but JSON must remain available.

### `sigil fmt [path] [--check]`

Loads the workspace, selects the requested file or included `.sigil` sources
beneath the requested directory, and delegates canonical rendering to
`sigil-core`.

Formatting wraps ordinary prose at 79 content characters without counting
leading indentation. It preserves semantic-unit identity and literal-block
content. Every selected source must parse and resolve without errors before any
file is written.

Without `--check`, the command writes only changed selected sources. With
`--check`, it performs no writes and exits `1` when any selected source is
noncanonical. Output identifies formatted, unchanged, noncanonical, and failed
sources. The command does not automatically select the whole repository unless
the user explicitly selects its workspace root.

### `sigil glossary [path]`

Loads the workspace glossary through `sigil-core` and reports its deterministic
projection.

Required output data:

- workspace metadata and glossary path;
- glossary schema version;
- workspace and bounded-context entries;
- resolved context for each loaded Sigil source;
- canonical term, matched spelling, owner, and exact range for each occurrence;
- glossary and workspace diagnostics.

Absence of `.sigil/glossary.json` is successful and reports an absent glossary.
Invalid schema, overlapping contexts, and spelling collisions exit with code
`1`. The command is read-only and does not extract or propose definitions.

### `sigil graph [path]`

Loads and resolves a workspace or target path and emits graph data from
`sigil-core`.

Required output data:

- workspace root;
- file dependency edges;
- component-to-expansion edges;
- diagnostics.

The command should not generate diagrams in version 0.7.

### `sigil context`

Produces deterministic agent-oriented context data from resolved Sigil.

Version 0.7 should use graph and exact-match signals only.

Supported selectors:

- `--component <name>`;
- `--file <path>`.

Required output data:

- workspace root;
- selected components;
- component contracts;
- collected expansions;
- resolved concept namespaces;
- related file paths;
- a scoped glossary context containing accepted terms, aliases, definitions,
  resolved bounded contexts, and occurrences from those related files, or `null`
  when GlossaryFile is absent;
- diagnostics.

The scoped glossary context excludes accepted vocabulary that does not occur in
the selected component or file and its collected expansion sources.

Version 0.7 must not implement embeddings, opaque ranking, or full semantic
search.

### `sigil render [path]`

Produces a simple Markdown review view.

Required output:

- component contracts;
- collected expansions;
- diagnostics summary;
- source file references.

This command is for review and documentation workflows. It is not the primary
human authoring UI.

### `sigil init [path]`

Creates `.sigil/config.json` without prompting. `--name` selects the stable
workspace identifier, while repeated `--include` and `--exclude` options replace
the 0.2 file-rule defaults. The directory basename is the default name. The
command must never overwrite an existing config.

### `sigil version [path]`

Reports CLI and core package versions and—when a workspace resolves—the
workspace name and configured Sigil version.

### `sigil semantic`

The semantic command group owns the deterministic world and retained handoff
workflow. It does not run an evaluator or accept model-written verdicts.

- `semantic intent` submits natural-language intent to one configured provider,
  generator, or proposal file. The provider returns only a strict version-1
  envelope containing Turtle additions and retractions. The CLI validates and
  deterministically ranks the resulting worlds, then saves a named beam.
- `semantic status` recomputes a canonical world or saved beam. It displays
  exact unresolved proposition IDs; `semantic answer` records a yes/no answer to
  that exact fact.
- `semantic accept` requires one uniquely green beam and atomically publishes
  lossless assertion-only `.egg` bytes under `.sigil/world/<revision>`.
- `semantic project --check` inspects generated views. `--write
  --expected-revision` publishes one generated view per canonical component and
  the tracked `views/current.json`; `--recover --transaction` completes an
  explicitly validated interrupted transaction.
- `semantic artifacts` creates the scoped `.sigil` directories and ignore file.
- `semantic slice` exports a focused assignment and retains its complete
  obligations under ignored `.sigil/handoffs/<id>`.
- `semantic receipts` imports strict assertion-only claims and locations under
  ignored `.sigil/receipts/<id>` and returns no verdict.
- `semantic verify` reparses the retained world, resolves current host
  observations, and runs fixed egglog coverage checks. Receipt outcomes are
  reported separately from independently established coverage.
- `semantic migrate` performs the explicit metadata-only accepted-state
  migration with preview, expected-revision, and CAS semantics.

The accepted `.sigil/world` and verifier policy are committed. Generated views
are committed when published. Beams, handoffs, receipts, runs, caches, and view
transactions are operational artifacts and are ignored. Generated views are
excluded from authored source discovery, while an explicitly opened view remains
available to parser/LSP syntax and navigation features.

## 8. Output Contracts

JSON output should be stable enough for agents, CI, and snapshot tests.

JSON field names should use camelCase.

JSON output should avoid host-specific absolute paths unless the user supplied
absolute paths.

Human text output should be readable but not treated as a stable API.

Agents and scripts should use JSON output.

## 9. Filesystem Behavior

`sigil-cli` owns the concrete Deno filesystem adapter for `sigil-core`.

The adapter should:

- read text files;
- check path existence;
- list files recursively under the workspace root;
- normalize paths consistently with `sigil-core` expectations;
- exclude `.sigil/views/` from authored and implementation discovery while
  allowing explicit view reads;
- ignore `.git` directories by default.

The adapter should not skip authored `.sigil` files based on package or
integration boundaries. Semantic artifact writes belong to compiler-owned
command handlers and may not implement a second parser, world merger, or
verification algorithm.

## 10. Acceptance Scenarios

Version 0.7 is acceptable when tests or scripted checks demonstrate that
`sigil-cli` can:

- parse `examples/promise/promise.sigil` and emit JSON;
- check the repository workspace from the mandatory root `.sigil/config.json`;
- resolve `examples/slotted/auth.sigil` imports from the independent Slotted
  workspace root;
- report diagnostics with stable codes;
- return exit code `1` when error diagnostics exist;
- return exit code `0` when only warnings or no diagnostics exist;
- surface `SIGIL_MISSING_CONCEPT_IDENTIFIER` to users and agents without a
  nonzero exit code;
- emit graph JSON with file and expansion edges;
- emit context JSON for `--component Auth`;
- emit resolved concept namespaces in context JSON;
- emit each direct dependency's public contract and decision sections once in
  context JSON while excluding transitive and other private dependency details;
- render Markdown for the Slotted example;
- avoid duplicating parser or resolver behavior outside `sigil-core`.

## 11. Implementation Notes

The current implementation is a thin CLI with explicit argument parsing, command
handlers, output models, formatting, filesystem adaptation, and exit status
decisions over `sigil-core`.

Keep command modules explicit rather than consolidating behavior into one large
entrypoint as commands grow.

Keep command shaping separate from `sigil-core` data models so the core API
remains reusable by LSP and editor integrations.

Do not add interactive prompts in version 0.7. Semantic provider interaction is
an explicit bounded process protocol, not a CLI prompt.

Do not mutate authored `.sigil` contracts or implementation files from a
semantic command. The only supported writes are accepted world revisions,
managed generated views, metadata migration, and ignored operational artifacts.

## 12. Historical Anchor Command Proposal

The following rejected design is retained for history. Version 0.7 has no
`sigil-indexer` dependency or `anchors` command group.

### `sigil anchors candidates [path] --component <name>`

Read-only. Returns the selected component, collected expansions, semantic-unit
locators, and no more than twenty deterministically ordered TypeScript
candidates per line. Each candidate reports inspectable ordering signals. The
command does not invoke a model.

### `sigil anchors check [path]`

Read-only. Loads `.sigil/anchors.json`, validates schema and workspace paths,
and resolves every accepted source target. It returns `resolved`, `changed`,
`ambiguous`, or `missing` for each anchor.

Invalid schema, paths outside the workspace, ambiguity, and missing targets are
error diagnostics. Unique structural changes are warnings. Warnings alone
preserve exit code `0`.

### `sigil anchors apply <proposal-file>`

Mutating and non-interactive. Validates proposal schema, current Sigil and
source fingerprints, target resolution, accepted outcome, duplicates, and
workspace containment before atomically updating `.sigil/anchors.json`.

The command rejects `ambiguous`, `no-match`, stale, or partially invalid input
without writing. Host workflows must obtain explicit human approval before
invocation.

All three commands support `--format json` and `--pretty`. Machine-readable
output includes workspace root, diagnostics, schema version, and command data.
No command calls a model or contains Codex-specific behavior.
