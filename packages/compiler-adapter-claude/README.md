# @qoherent/sigil-compiler-adapter-claude

Claude Code evaluator adapter for `@qoherent/sigil-compiler`.

The adapter invokes `claude` in print/stream-json mode with explicit read-only
tools, plan permissions, bare startup, and `--no-session-persistence`. It uses
implementation identity `builtin.claude-cli` and is bundled by the Sigil CLI.

Prerequisites: `claude` on `PATH` and authenticated for the selected model.

Direct compiler callers can register `new ClaudeAdapter()` or
`new ClaudeAdapter("claude-sonnet-4-...")`. Registry matching is exact on
provider, implementation id, version, and optional model.
