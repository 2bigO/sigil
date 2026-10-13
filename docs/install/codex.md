# Install Sigil in Codex

Codex installs Sigil from a plugin marketplace. Read the [prerequisites and
cleanup notes](README.md) once; the steps below point back to them.

## 1. Remove old copies

If you ever ran `sigil skill install`, remove its Sigil-managed copies first.
Codex read them from `~/.agents/skills` (user) and `<project>/.agents/skills`
(project). Follow
[Remove copies from `sigil skill install`](README.md#remove-copies-from-sigil-skill-install)
for each of those folders.

## 2. Install

Codex plugins install per user only. There is no project-scoped install.

```bash
codex plugin marketplace add qoherent/sigil
codex plugin add sigil@sigil
```

Restart Codex afterwards. You can also run `/plugins` in Codex, find the `sigil`
marketplace and install the `sigil` plugin there. In the Codex app, open
**Plugins**, choose **Add marketplace**, enter `qoherent/sigil` as the source,
then install **sigil**.

For a non-default profile, run both commands with the same `CODEX_HOME`:

```bash
CODEX_HOME="$HOME/.codex/profiles/work" codex plugin marketplace add qoherent/sigil
CODEX_HOME="$HOME/.codex/profiles/work" codex plugin add sigil@sigil
```

Codex installs from the repository's current branch, so a fresh install can be
ahead of the latest release.

## 3. Update

Codex does not update plugins on its own, and there is no `codex plugin update`.
Refresh the marketplace snapshot, then add the plugin again:

```bash
codex plugin marketplace upgrade sigil
codex plugin add sigil@sigil
```

## 4. Uninstall

```bash
codex plugin remove sigil@sigil
codex plugin marketplace remove sigil
```

## `sigilc` for the compute skills

`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary. See
[Two things to know first](README.md#two-things-to-know-first) for how they
offer to install it.
