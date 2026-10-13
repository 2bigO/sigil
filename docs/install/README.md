# Install the Sigil skills

The Sigil skills install through your coding agent's own plugin system, straight
from `qoherent/sigil`. You do not need the `sigil` binary first. Every install
brings the same seven skills as one set: `sigil-understand`, `sigil-evaluate`,
`sigil-write`, `sigil-align`, `sigil-egglog`, `sigil-compute-design` and
`sigil-compute-align`. They need each other, so install them together.

Pick your agent:

| Agent | Guide | Installs per project | Updates itself |
| --- | --- | --- | --- |
| Claude Code | [claude-code.md](claude-code.md) | Yes | Opt in |
| Codex | [codex.md](codex.md) | No, per user only | No |
| OpenCode | [opencode.md](opencode.md) | Yes | No |
| Pi | [pi.md](pi.md) | Yes | On `pi update` |
| Cursor | [cursor.md](cursor.md) | Manual copy only | Not documented |
| Gemini CLI and Antigravity | [gemini-antigravity.md](gemini-antigravity.md) | No, per user only | Gemini CLI on request; Antigravity no |

Each guide runs in the same order: remove old copies, install, update,
uninstall.

## Two things to know first

**The compute skills need `sigilc`.** `sigil-compute-design` and
`sigil-compute-align` run the native `sigilc` binary. The other five skills do
not. If `sigilc` is missing, the compute skills stop before doing any work, tell
you so, and show the official installer. They run it only if you say yes. You
can also install it yourself first, with the same installer that installs the
`sigil` CLI:

```bash
# macOS or Linux
curl -fsSL https://github.com/qoherent/sigil/releases/latest/download/install.sh | sh
```

```powershell
# Windows PowerShell
irm https://github.com/qoherent/sigil/releases/latest/download/install.ps1 | iex
```

**A fresh install can be ahead of the latest release.** Pi, OpenCode, Gemini CLI,
Antigravity and Codex clone the repository's current branch, so a new install
can include skill changes that no release has shipped yet. Claude Code offers an
update only when a release raises the plugin version, so it stays on released
skills.

## Remove copies from `sigil skill install`

Older versions of the CLI installed these skills with `sigil skill install`.
That command is gone. If you ran it, remove its copies before you install through
your agent, or the skills appear twice.

The command wrote into two folders, for your user account and, with `--project`,
for one repository:

| Folder | Read by |
| --- | --- |
| `~/.agents/skills` and `<project>/.agents/skills` | Codex, OpenCode, Pi, Cursor, Gemini CLI, Antigravity |
| `~/.claude/skills` and `<project>/.claude/skills` | Claude Code |

Each guide names the folders its agent reads. A folder holds Sigil-managed
copies when it contains a `.sigil-managed.json` file. Its `entries` object names
every skill the installer owns, each a symlink into the CLI install or a plain
copy. In a project folder the installer also wrote a `.gitignore` whose first
line is `# Managed by sigil skill install` (older versions wrote
`# Managed by sigil install`). Skills you added yourself are not listed there and
stay untouched.

On macOS or Linux, run this for each folder your agent reads. It prints each
entry it removes, deletes the manifest, and removes the lines the installer wrote
from the managed `.gitignore`, deleting the file only when nothing else is left.
Change `dir` to the folder you are cleaning:

```bash
dir="$HOME/.claude/skills"   # or ~/.agents/skills, or <project>/.claude/skills ...
manifest="$dir/.sigil-managed.json"
if [ -f "$manifest" ]; then
  owned="$(mktemp)"
  printf '%s\n' "# Managed by sigil skill install" "# Managed by sigil install" \
    "/.sigil-managed.json" > "$owned"
  sed -n 's/^    "\([^"/][^"/]*\)": {$/\1/p' "$manifest" | while read -r name; do
    echo "removing $dir/$name"
    rm -rf -- "${dir:?}/$name"
    printf '/%s\n' "$name" >> "$owned"
  done
  rm -f -- "$manifest"
  case "$(head -n 1 "$dir/.gitignore" 2>/dev/null)" in
    "# Managed by sigil skill install" | "# Managed by sigil install")
      # Drop only the lines the installer wrote; keep any rules you added.
      grep -vxF -f "$owned" "$dir/.gitignore" > "$dir/.gitignore.new"
      if grep -q '[^[:space:]]' "$dir/.gitignore.new"; then
        mv -- "$dir/.gitignore.new" "$dir/.gitignore"
      else
        rm -f -- "$dir/.gitignore.new" "$dir/.gitignore"
      fi ;;
  esac
  rm -f -- "$owned"
fi
```

Removing a symlink leaves the CLI install it pointed at alone. On Windows, open
`.sigil-managed.json`, delete the folders or links its `entries` name from the
same directory, then delete the manifest and the managed `.gitignore`. If
`.gitignore` has other lines of yours, delete only `/.sigil-managed.json`, the
`/<skill>` lines and the marker line.
