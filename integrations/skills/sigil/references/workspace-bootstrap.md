<!--
@sigil implements integrations/skills/sigil/compatibility.sigil::SigilSkillCompatibility::SkillCompatibility interface,logic,constraints,cases
@sigil implements integrations/skills/sigil/workspace-bootstrap.sigil::SigilWorkspaceBootstrap::WorkspaceBootstrap interface,state,logic,constraints,cases
-->

# Workspace bootstrap

Start from the user's selected repository, directory or Sigil file. Find the
eligible ancestor `.sigil/config.json`; use language CLI discovery instead of
inferring workspace membership from package manifests. Preserve excluded or
independent subtrees and unrelated work.

Inspect the actual executable paths and run `sigil --version` and
`sigilc --version`. Read the skill's `compatibility.json`: `cliVersion`,
`coreVersion`, `sigilVersion` and `sigilcVersion` have separate owners. VERSION
is the skill artifact version. Tool declarations use stable caret ranges; the
language version is exact. For a nonzero major, a caret range ends before the
next major; for `^0.m.p`, before the next minor; for `^0.0.p`, before the next
patch. Reject prereleases and ignore build metadata for precedence. Do not infer
core's actual version from the CLI version when it is unavailable.

Use a supported installed binary or build from the selected checkout. Never
silently fall back to an older global executable. Missing tooling needs tool
installation/build; it does not justify a wrapper around removed APIs.

| Configuration evidence | Action |
| --- | --- |
| Valid governing config | `sigil check . --format json`; validate in place |
| No config, existing Sigil | Report unconfigured sources; initialize only within task authorization |
| No config or Sigil | Initialize when the task calls for it |
| Invalid existing config | Preserve it; inspect and report diagnostics |
| Outside selected workspace | Resolve the intended root before dependent work |

Read-only review does not initialize files. When authorized, run `sigil init .`
on the exact selected root and inspect the generated configuration/glossary.
No model/provider setup is needed. Missing config is a bootstrap condition,
not itself a native compatibility failure.

Inspect relevant code and contracts next: use greenfield design for a new
responsibility, brownfield adoption for existing implementation with missing or
conflicting coverage, or established-contract work when coverage already exists.
Do not restart a workspace or its loop state merely because a session resumed.
