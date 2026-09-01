# Quickstart

Zero to a checked contract. Every command is copy-paste; the reasoning is in
[Setting Up A Project](setting-up-a-project.md).

## 1. Install

No release is published yet, so install from source. Requires
[Deno](https://docs.deno.com/runtime/getting_started/installation/); if `deno`
is not found after installing it, open a new terminal.

```sh
git clone https://github.com/qoherent/sigil.git
cd sigil
deno task --cwd packages/cli install
sigil --version
```

Use `git@github.com:qoherent/sigil.git` instead if you have SSH keys set up for
GitHub.

## 2. Set up your repository

```sh
cd /path/to/your-repo
sigil init . --name your-repo
sigil skill install
```

If the repository vendors dependencies or commits generated code, add those
paths to `files.exclude` in `.sigil/config.json` now — Sigil reads every
supported source file under the root as evidence, and on a large repository that
is the difference between working and failing outright.

```json
"exclude": [
  ".git/**", "node_modules/**", "build/**", "coverage/**",
  ".venv/**", "vendor/**", "**/bindata.go"
]
```

## 3. Model one boundary

No CLI command writes a contract. Ask your coding agent, which the skill in step
2 taught to author Sigil:

> Adopt Sigil for the `<module>` in this repository.

Start with one area that has a clear entry point and few dependents. One
boundary at a time, not a survey of the whole repository.

## 4. Check it

```sh
sigil check .                              # validates every contract
sigil context . --component <Name>         # the contract with its code
```

`0 error` means the contract and its annotations are valid. That is the whole
loop — everything above runs offline with no other tools installed.

### Optionally, review the design

`sigil compile .` goes further and judges whether the design is coherent, but it
runs its review stages through an AI CLI that you install separately. The
default profile uses `codex`; without it the run reports

```
RED
unchanged information COMPILER_EVALUATOR_INCOMPLETE: Could not start codex.
```

which means the evaluator is missing, not that the design is wrong. Install one
of `codex`, `claude`, `opencode`, or `pi`, then point Sigil at it:

```sh
sigil config set-default . --profile claude
```

## Next

Repeat step 3 for the next boundary. When you want to know why any of this is
shaped the way it is — exclusions, ownership annotations, evaluator profiles,
adopting across an existing codebase — read
[Setting Up A Project](setting-up-a-project.md).
