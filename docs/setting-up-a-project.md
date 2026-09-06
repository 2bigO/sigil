# Setting Up A Project

This guide configures a repository for deterministic semantic worlds and
returned implementation verification. It assumes the CLI is installed; see
[Install The CLI](../README.md#install-the-cli).

## 1. Create the workspace

Run this at the repository root:

```sh
sigil init . --name my-project
```

This writes `.sigil/config.json` and, when absent, `.sigil/glossary.json`. The
config declares the language version, workspace name, source include/exclude
patterns, and optional semantic-provider settings. `sigil --version` reports
the CLI contract version; a mismatch fails commands with
`SIGIL_UNSUPPORTED_VERSION`.

`sigil init` never overwrites an existing config or glossary. Review both files
in version control before adding authored contracts.

## 2. Exclude non-source trees

Sigil reads supported source files under the configured root for structural and
host observations. A virtual environment, vendored tree, generated output, or
dependency directory is therefore part of the scan unless excluded. The target
project's installed packages are never captured or staged for a handoff.

Edit `files.exclude` in `.sigil/config.json`:

```json
"exclude": [
  ".git/**", "node_modules/**", "build/**", "coverage/**",
  ".venv/**", "vendor/**", "**/bindata.go"
]
```

`sigil init --exclude` replaces the default list. Pass every desired pattern or
edit the file afterwards. Exclusion wins over inclusion, and patterns are
workspace-relative POSIX paths.

Generated managed views under `.sigil/views/` are excluded automatically from
authored intent and implementation discovery. They remain available for explicit
syntax/navigation access.

## 3. Install the repository skill

```sh
sigil skill install --project
```

The installed skill helps an agent author syntax, inspect imports, and use the
semantic workflow. It does not supply a verdict. The CLI and fixed egglog kernel
remain the semantic authority.

Use `sigil skill install` for global installation, or add `--agent codex`,
`--agent claude`, `--agent opencode`, or `--agent pi` to select one host.

## 4. Author the first component

A component declares a responsibility and public interface. Write it yourself
or ask the skill to draft it:

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

Keep this authored file near the boundary it describes. Add ownership comments
above implementing symbols when the repository has a concrete implementation:

```ts
// @sigil implements notifier.sigil::Notifier::send interface
export function send(recipient: string, message: string): void {
```

The annotation is a navigational claim. It is not implementation proof.

Check the workspace and inspect context:

```sh
sigil check .
sigil context . --component Notifier
sigil retrieve . --component Notifier --purpose semantic
```

## 5. Configure optional proposal providers

Natural-language interpretation is explicit and optional. `sigil init` leaves
the semantic provider map empty. To use a command provider:

```sh
sigil config set-provider local . \
  --kind command --command /absolute/path/to/provider --arg --json
sigil config set-provider-default local .
```

The executable receives a bounded prompt on standard input and must return only:

```json
{
  "version": 1,
  "candidates": [
    {"id": "one", "additions": "Turtle assertions", "retractions": ""}
  ]
}
```

The compiler validates vocabulary, identities, retractions, and the base
fingerprint, then runs deterministic candidate search. A provider cannot return
scores, findings, proof, or executable rules. Bundled `codex`, `claude`, `pi`,
and `opencode` entries use their corresponding host executable and the same
strict transport.

Provider configuration lives under `tools.semantic` in the root config. Use
`sigil config set-provider`, `config set-provider-default`, and
`config migrate`; do not put runtime executable paths in project config. Legacy
`tools.compile` evaluator fields remain readable for one compatibility release,
but ordinary compile and semantic verify never invoke them.

## 6. Accept a canonical world

Submit user intent and save a named beam:

```sh
sigil semantic intent . --text "The parser must reject filesystem access." \
  --provider local --beam parser
sigil semantic status . --beam parser
```

When status displays a consequential unresolved proposition, answer its exact
fact identity:

```sh
sigil semantic answer . --beam parser --fact <fact-id> --value no
```

Accept only when one candidate is uniquely green:

```sh
sigil semantic accept . --beam parser
```

Acceptance writes the canonical world and its atomic pointer:

```text
.sigil/
  world/
    current.json
    <revision>/
      assertions.egg
      manifest.json
```

The assertion `.egg` file is the lossless accepted meaning. It preserves fact
identities and literal details and can be loaded without original Turtle,
provider output, or derived caches. Turtle remains an import/export format.
Compiler-owned kernel rules and untrusted receipt claims stay separate.

## 7. Publish managed views

Project the current green world into generated human-readable companions:

```sh
sigil semantic project . --check
sigil semantic project . --write --expected-revision <revision>
```

The write is transactional and idempotent. It publishes one stable hashed
`.sigil` file per canonical Component/System entity plus the tracked receipt
`.sigil/views/current.json`. The generated files contain labels, prose, and
canonical IDs for reading; they are never fed back into intent extraction.
Change meaning by submitting new intent and accepting a new world.

If a process stops during publication, inspect and recover the named transaction:

```sh
sigil semantic project . --recover --transaction <transaction-id>
```

A changed authored source, policy, world pointer, or generated view is reported
as drift. `--check` never writes.

## 8. Export a retained implementation handoff

Select the canonical component by name or entity ID:

```sh
sigil semantic slice . --component Notifier --format text
```

Before exporting, declare the host-owned implementation policy in
`.sigil/implementation.json`. Bind exact component file inventories and any
mandatory checks. Mark an inventory `exhaustive: true` only when the host can
defend that claim.

The retained handoff under ignored `.sigil/handoffs/<id>` includes:

- the complete boundary obligation set, including obligations outside the slice;
- focused canonical `.egg` assertions and their fact identities;
- source, world, kernel, policy, and baseline-code fingerprints;
- protected specifications, configuration, lock files, and declared oracles;
- the verifier policy and the original workspace identity.

Keep the handoff ID separately from any returned checkout. Sigil prepares the
assignment; an external implementation workflow owns coding and repair.

## 9. Import and verify returned claims

The external workflow may return an assertion-only Turtle receipt and a location
sidecar. Import them as untrusted claims:

```sh
sigil semantic receipts . --handoff <id> \
  --claims /tmp/claims.ttl --locations /tmp/locations.json
sigil semantic verify . --handoff <id> --receipts <receipt-id>
```

For a separate returned checkout, add
`--handoff-root /path/to/original/repository`. Receipt import rejects invented
obligation IDs, mismatched propositions, duplicate identities, unsafe paths,
wrong file hashes, and malformed envelopes. Successful import writes ignored
`.sigil/receipts/<id>` and returns no verdict.

Verification reparses the retained world, recomputes all obligations with the
fixed egglog kernel, resolves native TypeScript 7 selectors, and runs the
declared host checks. It reports:

- independent coverage established by current observations;
- each receipt claim and whether it matched an obligation;
- unsupported or opaque behavior, which remains yellow;
- failed mandatory commands or operational failures, which cannot become green;
- stale protected inputs or handoff mismatches.

A source annotation or receipt location is a pointer for inspection. It cannot
close an obligation by itself.

## 10. Artifact and Git policy

Run this command to initialize the complete layout and scoped ignore file:

```sh
sigil semantic artifacts .
```

Commit these project meaning files:

- authored `.sigil` contracts and configuration;
- `.sigil/world/**` canonical assertion revisions and `world/current.json`;
- `.sigil/implementation.json` verifier policy;
- `.sigil/views/**` and `views/current.json` when generated views are published.

Keep these operational artifacts ignored:

- `.sigil/beams/` candidate-search checkpoints;
- `.sigil/handoffs/` retained assignments;
- `.sigil/receipts/` returned claims and location metadata;
- `.sigil/runs/` reports and stage results;
- `.sigil/cache/` derived data, locks, and interrupted view transactions.

The generated `.sigil/.gitignore` is scoped to this artifact layout and does not
hide authored contracts or accepted world revisions.

## 11. Runtime checks

A standalone release validates its adjacent native egglog and TypeScript 7.0.2
runtime automatically. Run:

```sh
sigil doctor --format json
```

A published library consumer has no source checkout to search. Set
`SIGIL_RUNTIME_DIR` to a matching runtime directory, then run the same doctor
check. The resolver validates manifest versions, target, file hashes, kernel
identity, and TypeScript extractor version before semantic work begins.

Read [compile.md](../compile.md) for the exact schemas, supported status codes,
migration/CAS rules, and acceptance matrix.
