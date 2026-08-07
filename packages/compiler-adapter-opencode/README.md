# @qoherent/sigil-compiler-adapter-opencode

OpenCode evaluator adapter for `@qoherent/sigil-compiler`.

This package implements `AgentAdapter` for provider `opencode` with
implementation identity `builtin.opencode-cli`. The provider-neutral compiler
does not depend on this package. The Sigil CLI bundles and registers it.

## Prerequisites

- `opencode` on `PATH` and authenticated for the model you select
- `@qoherent/sigil-compiler` (and usually the Sigil CLI) at a matching release

## Identity

| Field | Value |
| --- | --- |
| `provider` | `opencode` |
| `implementationId` | `builtin.opencode-cli` |
| `implementationVersion` | this package version (currently `0.7.1`) |
| optional `model` | OpenCode model id when not using the provider default |

Registry matching is exact on provider, implementation id, version, and model
(including “no model” vs a concrete model).

## Capabilities

Self-reported metadata (not independently verified):

- `workspaceAccess`: `read-only`
- `agentToolNetwork`: `false`
- `approvalEscalation`: `false`
- `statePersistence`: `persistent` (OpenCode has no ephemeral CLI mode)

Invocation shape:

```text
opencode run --format json --dir <workspaceRoot> [--model <model>]
```

Guidance is sent on standard input. The adapter injects restrictive inline
OpenCode configuration (allow read and bash; deny edit, network fetch, tasks,
external directories, and interactive questions). Bash remains available so the
evaluator can run the compiler’s read-only inspection command families; compliance
still depends on the model following the evaluation prompt.

## Use with the Sigil CLI (recommended)

The CLI already registers this adapter. Select it from workspace config:

```json
{
  "sigilVersion": "0.7.0",
  "workspace": { "name": "example", "members": [] },
  "files": { "include": ["**/*.sigil"], "exclude": [] },
  "tools": {
    "compile": {
      "adapter": {
        "provider": "opencode",
        "implementationId": "builtin.opencode-cli",
        "implementationVersion": "0.7.1",
        "model": "openai/gpt-5"
      }
    }
  }
}
```

Omit `model` to use OpenCode’s provider default. Then:

```sh
sigil compile .
sigil compile semantic-readiness .
sigil compile . --focus design
```

`implementationVersion` must equal this package’s version exactly. When the CLI
bundles the adapter, that version is the adapter package version shipped with the
CLI release.

Named evaluators work the same way:

```json
{
  "tools": {
    "compile": {
      "evaluators": {
        "reviewer": {
          "provider": "opencode",
          "implementationId": "builtin.opencode-cli",
          "implementationVersion": "0.7.1"
        }
      }
    }
  }
}
```

## Use with the compiler API directly

Direct `compile()` callers must register the adapter themselves:

```ts
import { compile } from "@qoherent/sigil-compiler";
import { OpenCodeAdapter } from "@qoherent/sigil-compiler-adapter-opencode";

const report = await compile(workspacePath, { kind: "workspace" }, {
  adapters: [
    new OpenCodeAdapter(), // provider default model
    new OpenCodeAdapter("openai/gpt-5"), // exact model binding
  ],
});
```

Pass every model you bind in config (including `undefined` for the default) or
registry resolution fails with zero/multiple matches.

## Trust note

Capability and observability declarations are self-reported compatibility
metadata. Selecting this adapter accepts the risk that OpenCode, its plugins, or
the model may not preserve filesystem, network, approval, persistence, or
data-handling restrictions.
