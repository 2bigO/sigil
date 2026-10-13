# Install Sigil in Pi

Pi installs Sigil as a package from the repository. Read the [prerequisites and
cleanup notes](README.md) once; the steps below point back to them.

## 1. Remove old copies

If you ever ran `sigil skill install`, remove its Sigil-managed copies first. Pi
read them from `~/.agents/skills` (user) and `<project>/.agents/skills`
(project). Follow
[Remove copies from `sigil skill install`](README.md#remove-copies-from-sigil-skill-install)
for each of those folders.

## 2. Install

For your user account:

```bash
pi install git:github.com/qoherent/sigil
```

For one repository, add `-l`. Pi records the package in the repository's
`.pi/settings.json`, which you can share with your team (Pi installs it for them
once they trust the project), and clones it to
`.pi/git/github.com/qoherent/sigil` inside the repository:

```bash
pi install git:github.com/qoherent/sigil -l
```

The clone contains `.sigil` files, so if the project is itself a Sigil
workspace, add `.pi/**` to the `files.exclude` list in `.sigil/config.json` so
Sigil does not read the clone as your sources, or install globally instead.

Pi installs from the repository's current branch, so a fresh install can be
ahead of the latest release. To pin a release, add a ref:
`git:github.com/qoherent/sigil@cli-vX.Y.Z`. A pinned ref never moves on update.

## 3. Update

```bash
pi update git:github.com/qoherent/sigil
```

This reconciles the checkout of an unpinned install with the repository's
current branch. A bare `pi update` updates Pi itself, not your packages.

## 4. Uninstall

```bash
pi remove git:github.com/qoherent/sigil
```

Add `-l` to remove a project install.

## `sigilc` for the compute skills

`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary. See
[Two things to know first](README.md#two-things-to-know-first) for how they
offer to install it.
