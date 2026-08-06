# @qoherent/sigil-compiler-adapter-opencode

OpenCode CLI evaluator adapter for `@qoherent/sigil-compiler`.

The package is independently publishable. The Sigil CLI imports and registers it,
so native and JSR CLI distributions include OpenCode support without making the
provider-neutral compiler depend on this package.

OpenCode currently exposes no ephemeral execution option. This adapter therefore
declares persistent state while retaining read-only workspace, no agent-tool
network, and no approval-escalation declarations. These declarations are
self-reported compatibility metadata, not independently verified guarantees.
