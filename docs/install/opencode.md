# Install Sigil in OpenCode

OpenCode loads Sigil as a plugin from the repository. Read the [prerequisites and
cleanup notes](README.md) once; the steps below point back to them.

This guide covers the OpenCode 1.x plugin API. OpenCode 2.x is not supported yet.

## 1. Remove old copies

If you ever ran `sigil skill install`, remove its Sigil-managed copies first.
OpenCode read them from `~/.agents/skills` (user) and `<project>/.agents/skills`
(project). Follow
[Remove copies from `sigil skill install`](README.md#remove-copies-from-sigil-skill-install)
for each of those folders.

## 2. Install

Add Sigil to the `plugin` array in your global `~/.config/opencode/opencode.json`,
or in a project's `opencode.json` to install it for that repository only:

```json
{
  "plugin": ["sigil@git+https://github.com/qoherent/sigil.git"]
}
```

Restart OpenCode. The plugin registers the repository's `skills/` folder, so the
seven skills appear without a generated copy. OpenCode installs from the
repository's current branch, so a fresh install can be ahead of the latest
release.

To pin a release, add a tag. Replace `X.Y.Z` with a version from the
[releases page](https://github.com/qoherent/sigil/releases):

```json
{
  "plugin": ["sigil@git+https://github.com/qoherent/sigil.git#cli-vX.Y.Z"]
}
```

## 3. Update

OpenCode has no update command, and it may keep the plugin it already fetched.
To update, remove the cached copy and restart OpenCode so it fetches the plugin
again. OpenCode keeps fetched plugins under `~/.cache/opencode/node_modules/`;
delete the `sigil` folder there. A pinned tag never moves, so change the tag to
update.

## 4. Uninstall

Remove the `sigil@git+...` entry from the `plugin` array, delete the cached
`sigil` folder under `~/.cache/opencode/node_modules/`, and restart OpenCode.

## `sigilc` for the compute skills

`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary. See
[Two things to know first](README.md#two-things-to-know-first) for how they
offer to install it.
