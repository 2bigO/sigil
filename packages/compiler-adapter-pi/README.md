# @qoherent/sigil-compiler-adapter-pi

Pi coding-agent evaluator adapter for `@qoherent/sigil-compiler`.

This package implements `AgentAdapter` for provider `pi` with implementation
identity `builtin.pi-cli`. The provider-neutral compiler does not depend on this
package. The Sigil CLI bundles and registers it.

## Prerequisites

- `pi` on `PATH` and authenticated for the model you select
- `@qoherent/sigil-compiler` (and usually the Sigil CLI) at a matching release

## Identity

| Field | Value |
| --- | --- |
| `provider` | `pi` |
| `implementationId` | `builtin.pi-cli` |
| `implementationVersion` | this package version (currently `0.7.1`) |
| optional `model` | Pi model pattern or id when not using the provider default |

Registry matching is exact on provider, implementation id, version, and model
(including “no model” vs a concrete model).

## Capabilities

Self-reported metadata (not independently verified):

- `workspaceAccess`: `read-only`
- `agentToolNetwork`: `false`
- `approvalEscalation`: `false`
- `statePersistence`: `ephemeral` (via `pi --no-session`)

Invocation shape:

```text
pi --print --mode json --no-session \
  --tools read,grep,find,ls,bash \
  --no-skills --no-context-files --no-extensions \
  --no-approve --offline \
  [--model <model>]
```

Guidance is sent on standard input as the evaluation prompt. Working directory is
the selected workspace root.

Notes:

- `--tools` enables read tools plus bash so the evaluator can run compiler
  inspection families (`sigil version/parse/check/...`, `rg`, `sed`, git
  inspection). Edit and write tools are not enabled. Per-command shell policy
  still depends on the model following the evaluation prompt.
- `--no-skills` disables Pi skill discovery. Compiler focus stages still work:
  stage guidance arrives only through the compiler’s `evaluationPrompt`.
- `--no-context-files` and `--no-extensions` keep project/user Pi resources from
  competing with evaluator instructions.

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
        "provider": "pi",
        "implementationId": "builtin.pi-cli",
        "implementationVersion": "0.7.1",
        "model": "openai/gpt-5"
      }
    }
  }
}
```

Omit `model` to use Pi’s provider default. Then:

```sh
sigil compile .
sigil compile semantic-readiness .
sigil compile . --focus design
```

`implementationVersion` must equal this package’s version exactly. When the CLI
bundles the adapter, that version is the adapter package version shipped with the
CLI release.

Named evaluators:

```json
{
  "tools": {
    "compile": {
      "evaluators": {
        "reviewer": {
          "provider": "pi",
          "implementationId": "builtin.pi-cli",
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
import { PiAdapter } from "@qoherent/sigil-compiler-adapter-pi";

const report = await compile(workspacePath, { kind: "workspace" }, {
  adapters: [
    new PiAdapter(), // provider default model
    new PiAdapter("openai/gpt-5"), // exact model binding
  ],
});
```

Pass every model you bind in config (including `undefined` for the default) or
registry resolution fails with zero/multiple matches.

The compiler does not auto-create a Pi adapter. Without host registration (CLI
bundle or `options.adapters`), a profile bound to `builtin.pi-cli` cannot
resolve.

## Trust note

Capability and observability declarations are self-reported compatibility
metadata. Selecting this adapter accepts the risk that Pi, its tools, or the
model may not preserve filesystem, network, approval, persistence, or
data-handling restrictions. Pi does not provide a hard OS sandbox; tool flags
and the evaluation prompt are the adapter’s declared boundary.
