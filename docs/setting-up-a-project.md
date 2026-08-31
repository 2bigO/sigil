# Setting Up A Project

Getting Sigil running on a repository, start to finish. Assumes the CLI is
installed (see [Install The CLI](../README.md#install-the-cli)).

## 1. Create the workspace

```bash
sigil init . --name my-project
```

Writes `.sigil/config.json` and `.sigil/glossary.json`. The config declares the
language version, which must match your CLI — `sigil --version` reports the CLI
version, and a mismatch fails every command with `SIGIL_UNSUPPORTED_VERSION`.

## 2. Exclude what is not your code

This is the step that decides whether Sigil works on a real repository.

Sigil reads implementation evidence from every supported source file under the
root. A virtual environment, a vendored tree, or a generated file counts as your
code unless you say otherwise. On a large repository that is the difference
between compiling and failing outright: RIA Hub went from 83,162 files to 4,589
by naming its exclusions, and one generated Go file in it holds 337 MB of
embedded assets.

Edit `files.exclude` in `.sigil/config.json`:

```json
"exclude": [
  ".git/**", "node_modules/**", "build/**", "coverage/**",
  ".venv/**", "vendor/**", "**/bindata.go"
]
```

`sigil init --exclude` **replaces** the default list rather than adding to it,
so either pass every pattern you want or edit the file afterwards.

## 3. Install the agent skill

```bash
sigil skill install
```

No CLI command writes a contract. The skill teaches Codex, Claude Code,
OpenCode, and Pi to author and revise Sigil, and the CLI checks what they write.
Use `--project` for repository-local installation, or `--agent <name>` for one.

## 4. Write the first component

A component is a contract. `goal` says what it owns; `interface` is its public
surface. Ask your agent for one — "model the notification service as a Sigil
component" — or write it yourself. Either way it lands in a `.sigil` file
anywhere in the tree and looks like this.

```sigil
component Notifier {
  goal {
    Deliver notifications to recipients over email.
  }

  interface {
    Delivery {
      send(recipient, message) delivers one message and reports failure to the
      caller.
    }
  }
}
```

Check it:

```bash
sigil check .
```

## 5. Point the contract at the code

Add an ownership annotation as a comment above the implementing symbol:

```ts
// @sigil implements notifier.sigil::Notifier::Delivery interface
export function send(recipient: string, message: string): void {
```

The form is
`@sigil implements|uses|tests <file>::<Component>[::<Concept>]
<sections>`.
Sigil reads these from ordinary comments, including `.vue`, `.html`, `.css`, and
Go templates. A component with no named symbol to hang the note on — most
single-file frontend components — can carry it at file level.

Confirm the link resolved:

```bash
sigil context . --component Notifier
```

## 6. Use it

| Command                                                 | What it gives you                                   |
| ------------------------------------------------------- | --------------------------------------------------- |
| `sigil check .`                                         | Validates every contract and annotation             |
| `sigil context . --component X`                         | One component with its dependencies and owning code |
| `sigil retrieve . --component X --purpose architecture` | Assembled context for an agent                      |
| `sigil compile .`                                       | Runs the review stages and reports red/yellow/green |

Two flags worth knowing early:

- `--max-evidence-bytes N` caps what `retrieve` returns, keeping the closest
  evidence and reporting what it withheld. Large workspaces return more than an
  assistant can accept without it.
- `compile` accepts `--component`, `--file`, `--position`, or `--directory` and
  works out how much to check from what you name. A directory selects the Sigil
  sources beneath it, not the implementation files.

## 7. Choose which evaluator reviews your work

`compile` runs its review stages through an AI evaluator, selected by a
_profile_. `sigil init` seeds profiles for each bundled provider and defaults to
`standard`, which uses Codex. To use a different one:

```bash
sigil config set-default . --profile claude
```

That sets the profile for both `compile` and the agent skill. An unknown name is
rejected, so a typo cannot leave the workspace pointing at a profile that does
not exist.

To build your own — say, a faster profile that skips the standards-risk stage:

```bash
sigil config set-profile fast . --extends standard --main claude   --disable-stage standards-risk
```

Repeating the command edits the same profile, and `--disable-stage` accumulates
across invocations. Binding a stage again with `--stage <stage>=<evaluator>`
re-enables it. `sigil config set-profile --help` lists the evaluator, model, and
per-stage options.

## Adopting into an existing codebase

The steps above work unchanged on a repository that already has code. Four
things differ.

**Exclusions matter more.** Step 2 is the one that decides whether Sigil runs at
all on a large repository, so do it before anything else.

**Start with one boundary, not a survey.** Pick something with a clear entry
point and few dependents. Not the largest area, and not the one you understand
least. Model it, check it, then pick the next.

**Record what the code does, not what it should do.** A contract for existing
code describes current behaviour. Where the behaviour is wrong, say so in a
`decisions` entry rather than quietly writing the fix into the contract — the
contract stops matching the code otherwise.

**Annotate as you go.** A boundary is only half done until
`sigil context .
--component <Name>` shows the contract and its implementing
code together.

Ask your agent to do this a boundary at a time: "adopt Sigil for the ingest
module". It follows
[brownfield-adoption.md](../integrations/skills/sigil/references/brownfield-adoption.md),
which is the full procedure and is written for the agent rather than for you.

## Growing from here

One boundary is correct until a second area has its own reason to change. When
the project earns it, split into areas with their own `_module.sigil` index and
list them in `workspace.members`; see
[greenfield-design.md](../integrations/skills/sigil/references/greenfield-design.md).

[The 0.1 pilot](pilots/0.1-brownfield.md) records one adoption in full, as a
worked example rather than a procedure.
