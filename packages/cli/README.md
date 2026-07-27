# sigil-cli

Current package version: **0.6.1**.

Command-line interface for agents, CI, scripts, and platform debugging.

The CLI is not the primary human authoring experience. Humans may use it early
for checks and generated artifacts, but editor integrations should become the
main human UI.

Package docs:

- [spec.md](spec.md): version 0.6 CLI requirements, command behavior, output
  contracts, and acceptance scenarios.
- [architecture.md](architecture.md): command architecture, module boundaries,
  dependency rules, and implementation guidelines.

Install a standalone GitHub release on macOS or Linux:

```bash
curl -fsSL https://github.com/qoherent/sigil/releases/latest/download/install.sh | sh
```

Install on Windows PowerShell:

```powershell
irm https://github.com/qoherent/sigil/releases/latest/download/install.ps1 | iex
```

Alternatively, install the published JSR package when Deno is available:

```bash
deno install --global --allow-read --allow-write --allow-env=HOME,USERPROFILE --name sigil jsr:@qoherent/sigil@0.6
```

Local development install:

```bash
deno task install
```

This installs a `sigil` command that can be discovered on `PATH`.

Implemented responsibilities:

- install version-owned agent skills globally or into a target repository;
- expose parser output;
- run workspace checks;
- report missing interface concept identifiers as actionable warnings;
- produce agent-oriented context packs;
- render Markdown for review and documentation workflows;
- keep CLI behavior thin over `sigil-core`.

Commands:

- `sigil --help` reports top-level help, while `--help` after any recognized
  command or subcommand reports help scoped to that command path;
- `sigil skill list` reports bundled directories containing `SKILL.md`;
- `sigil skill install` installs skills globally for Codex, Claude Code,
  OpenCode, and Pi;
- `sigil skill install --project` installs into the current repository;
- `sigil skill install --agent <name>` limits installation to one agent;
- `sigil init [path]` creates a config without overwriting;
- `sigil version [path]` reports tool and configured contract versions;
- `sigil parse <path>` returns parsed JSON;
- `sigil check [path]` returns diagnostics;
- `sigil glossary [path]` reports reviewed entries, resolved contexts, and
  source occurrences;
- `sigil graph [path]` returns component and import graph data;
- `sigil context ...` returns agent context JSON with direct dependencies'
  public contracts and decision rationale plus reviewed terminology recognized
  in the selected and related Sigil files;
- `sigil render ...` returns Markdown.

Empty, unknown, incomplete, and invalid invocations report the problem together
with help for the longest recognized command path.

The CLI returns exit code `0` for success or warnings, `1` for error
diagnostics, `2` for usage errors, and `3` for host/runtime failures. Use JSON
output for automation; human text and Markdown are convenience projections.
Context output includes resolved concept namespaces, bounded
`agentDependencyContexts`, and a scoped `glossaryContext`; Markdown render
output preserves concept grouping.

Versioned binary distributions place assets at `<version>/integrations/skills`
beside `<version>/bin/sigil`. This keeps each binary paired with the language
semantics and skills shipped for that version.

Run the package tests with:

```bash
deno task test
```
