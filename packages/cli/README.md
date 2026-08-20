# sigil-cli

Current package version: **0.7.1**.

Command-line interface for agents, CI, scripts, and platform debugging.

The CLI is not the primary human authoring experience. Humans may use it early
for checks and generated artifacts, but editor integrations should become the
main human UI.

Package docs:

- [spec.md](spec.md): version 0.7 CLI requirements, command behavior, output
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
deno install --global --allow-read --allow-write --allow-env=HOME,USERPROFILE --name sigil jsr:@qoherent/sigil@0.7
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
- `sigil init [path]` creates a config and, when absent, a glossary seeded only
  with the eight agent-context-excluded, colon-qualified decision-record field
  labels; it never overwrites either file;
- `sigil version [path]` reports tool and configured contract versions;
- `sigil parse <path>` returns parsed JSON;
- `sigil check [path]` returns diagnostics; add `--format text --show-locations`
  to append each diagnostic's file path, line, and column to the text output
  (default text output and JSON are unchanged without the flag);
- `sigil glossary [path]` reports reviewed entries, resolved contexts, and
  source occurrences;
- `sigil graph [path]` returns component and import graph data;
- `sigil context ...` returns agent context JSON with direct dependencies'
  public contracts and decision rationale plus reviewed terminology recognized
  in the selected and related Sigil files, excluding terms whose `agentContext`
  value is `false`;
- `sigil retrieve [path] (--component name | --file file) --purpose
  semantic|architecture|implementation`
  returns a deterministic selected graph, exact evidence, inclusion reasons,
  exclusion frontier, aggregated context, and a content fingerprint; add
  `--format markdown` for a readable context pack;
- `sigil compile [stage] [path] [--component name | --file file
  [--position line:column]]`
  runs profile-scoped deterministic and direct-read agent evaluation. A stage
  operand such as `semantic-readiness` runs that stage and its dependency
  closure. Prefix a colliding path with `./`. Use `--format jsonl` for the
  versioned event stream;
- `sigil render ...` returns Markdown.

Configure agentic compilation under `tools.compile`:

```json
{
  "tools": {
    "compile": {
      "defaultProfile": "standard",
      "adapter": {
        "provider": "codex"
      },
      "budgets": {
        "elapsedTimeMs": 1800000,
        "maxCommands": 512,
        "maxCommandOutputChars": 3000000,
        "maxInputTokens": 1000000,
        "maxOutputTokens": 1000000
      },
      "limits": {
        "maxCompilationRequestChars": 1000000,
        "maxAgentInputChars": 1000000,
        "sessionTtlMs": 86400000
      }
    }
  }
}
```

Each developer may create ignored `.sigil/local.json` containing
`{ "tools": ... }`. It recursively overrides the tracked `tools` object only.
Use `sigil compile --agent` to select `tools.agent.profile`, falling back to
`tools.compile.defaultProfile`.

Profiles may select a fallback evaluator list and stage-specific overrides:

```json
{
  "tools": {
    "compile": {
      "profiles": {
        "standard": {
          "main": ["default"],
          "stages": { "architecture-design": ["deep"] }
        }
      },
      "evaluators": { "deep": { "provider": "codex", "model": "gpt-5.2" } }
    }
  }
}
```

The compiler's Codex adapter runs ephemerally at the workspace root with
read-only filesystem access, disabled network and approval escalation, and
structured output. A configured provider that cannot enforce the same contract
fails closed. Compilation does not generate code or execute implementation
experiments.

### Available adapters

| Provider   | Built-in implementation ID | Version | Model setting    | Availability                                                                                                       |
| ---------- | -------------------------- | ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `codex`    | `builtin.codex-cli`        | `0.7.1` | Optional `model` | Bundled and available through the Codex CLI.                                                                       |
| `claude`   | `builtin.claude-cli`       | `0.7.1` | Optional `model` | Recognized, but the bundled placeholder rejects evaluation; install a compatible adapter implementation to use it. |
| `opencode` | `builtin.opencode-cli`     | `0.7.1` | Optional `model` | Bundled by the Sigil CLI.                                                                                          |
| `pi`       | `builtin.pi-cli`           | `0.7.1` | Optional `model` | Bundled by the Sigil CLI.                                                                                          |

Set `provider`, optional `model`, and, when required, the exact
`implementationId` and `implementationVersion` on `adapter` or a named entry in
`evaluators`. A named evaluator can then be selected by a profile's `main` or
`stages` mapping.

Copy-paste example:

```json
{
  "tools": {
    "agent": {
      "profile": "developer"
    },
    "compile": {
      "defaultProfile": "standard",
      "adapter": {
        "provider": "codex",
        "implementationId": "builtin.codex-cli",
        "implementationVersion": "0.7.1",
        "model": "gpt-5"
      },
      "evaluators": {
        "codex-deep": {
          "provider": "codex",
          "implementationId": "builtin.codex-cli",
          "implementationVersion": "0.7.1",
          "model": "gpt-5.2"
        },
        "opencode-review": {
          "provider": "opencode",
          "implementationId": "builtin.opencode-cli",
          "implementationVersion": "0.7.1",
          "model": "your-opencode-model"
        },
        "pi-review": {
          "provider": "pi",
          "implementationId": "builtin.pi-cli",
          "implementationVersion": "0.7.1",
          "model": "your-pi-model"
        }
      },
      "profiles": {
        "developer": {
          "extends": "standard",
          "main": ["default"],
          "stages": {
            "semantic-readiness": ["codex-deep"],
            "architecture-design": ["opencode-review"],
            "current-code-compatibility": ["pi-review"]
          }
        }
      }
    }
  }
}
```

Put personal provider, model, or profile choices in `.sigil/local.json`; its
`tools` object merges over the tracked configuration. Run
`sigil compile --agent` to use `tools.agent.profile`.

### Compiler configuration reference

`tools.compile.adapter` is the legacy default evaluator. When it is present, it
is exposed to profiles as the evaluator ID `default`; therefore
`"main": ["default"]` uses this adapter for every agentic stage not named in
`stages`. `adapter` accepts `provider`, optional `model`, optional
`implementationId`, and optional `implementationVersion`. Omitting its ID and
version selects the provider's built-in CLI adapter and this Sigil release's
version.

`tools.compile.evaluators` is a map of named bindings with the same fields as
`adapter`. Use these names in `profiles.<name>.main` or
`profiles.<name>.stages.<stage>`. `main` is required when a `stages` map omits
an agentic stage. `evaluatorIds` remains supported for older configurations and
applies to every agentic stage when `main` and `stages` are absent.

`tools.compile.defaultProfile` selects the profile used by ordinary
`sigil compile` commands. `tools.agent.profile` selects the profile used by
`sigil compile --agent`. A profile may use `extends: "standard"` or
`extends: "critical-system"`; `standard` runs deterministic foundation plus the
normal design stages, while `critical-system` also includes `standards-risk` and
requires independent evaluators. A custom profile name must declare one of those
bases with `extends`. `disabledStages` disables optional stages, but cannot
bypass required dependencies.

The valid agentic `stages` keys are `semantic-readiness`, `architecture-design`,
`current-code-compatibility`, and `standards-risk`. `deterministic-foundation`
is built in and does not accept an evaluator binding.

`tools.compile.budgets` contains positive integer limits:

| Field                   |   Default | Purpose                                             |
| ----------------------- | --------: | --------------------------------------------------- |
| `elapsedTimeMs`         | `1800000` | Maximum elapsed evaluator time (30 minutes).        |
| `maxCommands`           |     `512` | Maximum inspection commands an evaluator may issue. |
| `maxCommandOutputChars` | `3000000` | Maximum retained nonessential command output.       |
| `maxInputTokens`        | `1000000` | Maximum configured input-token budget.              |
| `maxOutputTokens`       | `1000000` | Maximum configured output-token budget.             |

`tools.compile.limits` also contains positive integer limits:

| Field                        |    Default | Purpose                                                       |
| ---------------------------- | ---------: | ------------------------------------------------------------- |
| `maxCompilationRequestChars` |  `1000000` | Maximum compiler evaluation request and provider result size. |
| `maxAgentInputChars`         |  `1000000` | Maximum initial agent request size.                           |
| `sessionTtlMs`               | `86400000` | Proposal-compilation session lifetime (24 hours).             |
| `providerCleanupMs`          |     `5000` | Deadline for graceful and forced provider cleanup.            |

The CLI also bundles and registers the independently packaged OpenCode and Pi
compiler adapters. OpenCode evaluation uses `opencode run --format json`,
standard-input guidance, the selected workspace and model, and restrictive
inline permissions. Because OpenCode exposes no ephemeral CLI mode, that adapter
declares persistent state. Pi evaluation uses
`pi --print --mode json
--no-session` with a read-only tool allowlist that
includes bash for inspection commands, and disables Pi skill, context-file, and
extension discovery so compiler focus skills arrive only through the evaluation
prompt. The compiler derives the request persistence requirement from the
exactly selected adapter while keeping read-only, no agent-tool network, and no
approval escalation requirements fixed.

Unless `--no-cache` is set, completed compilation reports are atomically stored
under the operating system's user cache directory and used to derive diagnostic
lifecycle. The cache is never written inside the workspace. JSONL compilation
emits one terminal `completed`, `failed`, or `cancelled` event; profile
configuration failures return exit code `3`.

Empty, unknown, incomplete, and invalid invocations report the problem together
with help for the longest recognized command path.

The deterministic commands return exit code `0` for success or warnings, `1` for
error diagnostics, `2` for usage errors, and `3` for host/runtime failures.
Compilation returns `0` only for green, `1` for red or yellow, and `130` when
cancelled. Use JSON or JSON Lines output for automation; human text and Markdown
are convenience projections. Context output includes resolved concept
namespaces, bounded `agentDependencyContexts`, and a scoped `glossaryContext`;
Markdown render output preserves concept grouping.

Versioned binary distributions place assets at `<version>/integrations/skills`
beside `<version>/bin/sigil`. This keeps each binary paired with the language
semantics and skills shipped for that version.

Run the package tests with:

```bash
deno task test
```
