# Install Sigil in Gemini CLI or Antigravity

Gemini CLI and Antigravity (`agy`) both install Sigil straight from the
repository. Antigravity replaced Gemini CLI for consumer accounts; paid and
enterprise accounts can still use Gemini CLI. Read the [prerequisites and cleanup
notes](README.md) once; the steps below point back to them.

## 1. Remove old copies

If you ever ran `sigil skill install`, remove its Sigil-managed copies first.
Gemini CLI reads skills from `~/.agents/skills` and `<project>/.agents/skills`,
which is where the old command wrote them. Follow
[Remove copies from `sigil skill install`](README.md#remove-copies-from-sigil-skill-install)
for each of those folders. If skills appear twice after you install, check both
`.agents/skills` folders again.

## 2. Install

Both agents install per user. There is no project-scoped install.

**Gemini CLI**:

```bash
gemini extensions install https://github.com/qoherent/sigil
```

**Antigravity**:

```bash
agy plugin install https://github.com/qoherent/sigil
agy plugin list
```

Start a new session afterwards. Both install from the repository's current
branch, so a fresh install can be ahead of the latest release. To pin a version,
Gemini CLI takes `--ref <tag>` (for example `--ref cli-vX.Y.Z`); with Antigravity,
clone that tag and run `agy plugin install ./sigil`.

## 3. Update

**Gemini CLI** updates on request, or automatically if you installed with
`--auto-update`:

```bash
gemini extensions update sigil
```

**Antigravity** has no documented update command. To update, uninstall the plugin
and install it again.

## 4. Uninstall

```bash
gemini extensions uninstall sigil
agy plugin uninstall sigil
```

## `sigilc` for the compute skills

`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary. See
[Two things to know first](README.md#two-things-to-know-first) for how they
offer to install it.
