# Install Sigil in Cursor

Cursor installs Sigil as a plugin. Individual users can install only from the
Cursor marketplace; until Sigil is listed there, use the team import or the manual
copy below. Read the [prerequisites and cleanup notes](README.md) once; the steps
below point back to them.

## 1. Remove old copies

If you ever ran `sigil skill install`, remove its Sigil-managed copies first.
Cursor reads skills from `~/.agents/skills` and `<project>/.agents/skills`, which
is where the old command wrote them. Follow
[Remove copies from `sigil skill install`](README.md#remove-copies-from-sigil-skill-install)
for each of those folders. (The `.claude/skills` folders were written for Claude
Code; Cursor does not need them cleaned.)

## 2. Install

**From the marketplace**, once Sigil is listed there. In Cursor Agent chat:

```text
/add-plugin sigil
```

Or search for "sigil" in the Cursor plugin marketplace.

**Through a team marketplace** (Teams and Enterprise plans). A team admin opens
Dashboard, then Settings, then Plugins, chooses **Import** under Team
Marketplaces, and pastes `https://github.com/qoherent/sigil`. Cursor reads the
repository's `.cursor-plugin/marketplace.json`. Team members then install `sigil`
from the team marketplace.

**By hand**, for one user or one repository. Clone the repository and copy all
seven skill folders together, since the skills refer to one another:

```bash
git clone --depth 1 https://github.com/qoherent/sigil /tmp/sigil
mkdir -p ~/.cursor/skills            # or <project>/.cursor/skills for one repository
cp -R /tmp/sigil/skills/. ~/.cursor/skills/
```

A manual copy comes from the repository's current branch, so it can be ahead of
the latest release. Check the copied folders into the project, or add them to
`.gitignore`, and keep a project's copy out of a Sigil workspace's source
selection if the folder holds `.sigil` files.

## 3. Update

Cursor's plugin update check is not documented, so this guide does not promise
that it notices a new Sigil release. If an installed plugin does not update,
remove it and install it again from the marketplace, or ask your team admin to
refresh the team marketplace import in the dashboard. For a manual copy, repeat
the `git clone` and `cp` steps from a fresh clone.

## 4. Uninstall

Remove the plugin in Cursor's plugin settings. For a manual copy, delete the
seven `sigil-*` folders from `~/.cursor/skills` or `<project>/.cursor/skills`.

## `sigilc` for the compute skills

`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary. See
[Two things to know first](README.md#two-things-to-know-first) for how they
offer to install it.
