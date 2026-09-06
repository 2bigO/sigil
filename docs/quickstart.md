# Quickstart

This walkthrough takes a repository from an empty Sigil configuration to a
checked semantic world and an independently verifiable implementation handoff.
The compiler is deterministic: proposal providers may suggest assertions, but
the fixed egglog kernel decides whether a world is consistent and whether
observations cover its obligations.

## 1. Install the CLI

For repository development, install from a checkout:

```sh
git clone https://github.com/qoherent/sigil.git
cd sigil
deno task --cwd packages/cli install
sigil --version
```

The standalone release contains Sigil's native egglog and TypeScript 7.0.2
runtime. It does not need Deno, Node, Rust, or a source checkout. If a release
is available, use the installer described in [the root README](../README.md).

## 2. Initialize the target repository

```sh
cd /path/to/your-repo
sigil init . --name your-repo
sigil skill install --project
```

Review `.sigil/config.json` before checking a large repository. Exclude vendored,
generated, build, and dependency trees explicitly:

```json
"exclude": [
  ".git/**", "node_modules/**", "build/**", "coverage/**",
  ".venv/**", "vendor/**", "**/bindata.go"
]
```

The compiler never captures or stages the target repository's installed
packages. Those paths are excluded from discovery and are not part of a retained
handoff.

## 3. Author and check one boundary

Write a small authored `.sigil` contract, or ask the installed skill to draft
one. A component declares its public purpose and interface:

```sigil
component Notifier {
  goal {
    Deliver notifications to recipients over email.
  }

  interface {
    send(recipient, message) delivers one message and reports failure.
  }
}
```

Check syntax, imports, ownership annotations, and configuration:

```sh
sigil check .
sigil context . --component Notifier
```

`check` validates authored source. It does not create a semantic interpretation
or inspect generated managed views as authored input.

## 4. Interpret intent through a proposal provider

The semantic namespace is intentionally empty after `sigil init`. Configure one
provider only if the project needs natural-language interpretation:

```sh
sigil config set-provider local . \
  --kind command --command /absolute/path/to/provider --arg --json
sigil config set-provider-default local .
```

The command provider receives a prompt on standard input and must emit exactly
one version-1 JSON proposal envelope on standard output. It returns Turtle
additions and retractions; it never returns a verdict or implementation proof.
Bundled `codex`, `claude`, `opencode`, and `pi` providers use the same
envelope through their installed host executables.

Submit an intent and save a named beam:

```sh
sigil semantic intent . \
  --text "The parser must reject filesystem access." \
  --provider local --beam parser
sigil semantic status . --beam parser
```

If the candidates leave a consequential choice unresolved, `status` displays
the exact proposition. Answer that proposition by its fact identity:

```sh
sigil semantic answer . --beam parser --fact <fact-id> --value no
sigil semantic status . --beam parser
```

Acceptance requires one uniquely selected green candidate. It is the only
operation that replaces canonical world meaning:

```sh
sigil semantic accept . --beam parser
sigil compile . --focus design
```

The accepted world is lossless assertion-only egglog under
`.sigil/world/<revision>/assertions.egg`, with a tracked `world/current.json`
pointer and manifest. Original Turtle and derived caches are not needed to
reconstruct it.

## 5. Publish and inspect generated views

Generate companion human views from the accepted green world:

```sh
sigil semantic project . --check
sigil semantic project . --write --expected-revision <revision>
```

The command writes `.sigil/views/<entity-hash>.sigil` and the tracked
`.sigil/views/current.json`. Generated views are excluded from authored intent
and implementation discovery. Change meaning through `semantic intent` and
`semantic accept`; do not edit a generated view to change the world. An
interrupted write can be inspected and recovered explicitly:

```sh
sigil semantic project . --recover --transaction <transaction-id>
```

## 6. Hand off implementation and verify the return

Select one canonical component and export an exact retained assignment:

```sh
sigil semantic slice . --component Notifier --format text
```

The handoff is stored under ignored `.sigil/handoffs/<id>`. It contains the
focused `.egg` assertions, complete boundary obligations, protected inputs,
world identity, and host verifier policy. Give that assignment to the external
implementation workflow; Sigil does not generate patches or run a coding and
repair loop.

When the implementation workflow returns, import its untrusted claims:

```sh
sigil semantic receipts . --handoff <id> \
  --claims /tmp/claims.ttl --locations /tmp/locations.json
sigil semantic verify . --handoff <id> --receipts <receipt-id>
```

Use `--handoff-root /path/to/original/repo` when verifying a returned checkout
from another directory. Receipt locations and claims are checked for identity,
hash, scope, and safe paths, then compared with fresh native TypeScript 7 and
host checks. A receipt never closes an obligation merely because it names a
symbol. Results distinguish independently covered obligations, unsupported or
opaque behavior, and command failures.

## 7. Know which files are authoritative

`.sigil/world` and the verifier policy are committed. Generated `.sigil/views`
and its `current.json` receipt are committed when the project chooses to publish
human views. The following are operational claims, assignments, or caches and
are ignored by the generated `.sigil/.gitignore`:

- `.sigil/receipts/` for returned claim submissions;
- `.sigil/handoffs/` for retained assignments;
- `.sigil/runs/`, `.sigil/cache/`, and `.sigil/beams/` for execution and search
  state;
- `.sigil/cache/view-transactions/` for interrupted view publication.

Initialize or inspect this layout at any time:

```sh
sigil semantic artifacts .
```

`sigil doctor --format json` validates the packaged native runtime. A published
library consumer must select a matching runtime with `SIGIL_RUNTIME_DIR`.

For the complete contracts, artifact schemas, migration rules, and acceptance
matrix, read [compile.md](../compile.md).
