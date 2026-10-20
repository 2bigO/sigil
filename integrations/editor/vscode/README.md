# VS Code Integration

Implemented pre-production VS Code extension for Sigil.

Language 0.9 responsibilities:

- provide `.sigil` TextMate syntax highlighting and resolver-backed component,
  Tag, and reviewed glossary-term highlighting through LSP semantic tokens;
- run `sigil lsp` for diagnostics, symbols, navigation, hover, and semantic
  highlighting; the `sigil.executable` setting names the `sigil` to run (empty
  uses the `sigil` shipped with the extension, else `sigil` on the `PATH`), and
  changing it restarts the server;
- expose `Sigil: Open Preview`, which renders the whole active `.sigil` file to
  Markdown and opens it in VS Code's built-in Markdown preview, available from
  the Command Palette and from a preview button in the editor title toolbar of
  `.sigil` editors (Markdown-style _Open Preview to the Side_);
- expose explicit file and workspace compilation through the language CLI and
  standalone native `sigilc`;
- display native named states and ranged findings while keeping language support
  and preview independent of the installed compilers.

Use **Sigil: Compile File** or **Sigil: Compile Workspace**, with Design or
Implementation focus. File compilation uses the active physical `.sigil` file
and native import/owner closure; it does not claim cursor-only component scope.
The native report in Sigil output shows the actual included files and witnesses.
The obsolete Compile Component command is removed.

Configure these settings on the extension host:

| Setting                            | Meaning                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `sigil.compile.executable`         | Native `sigilc` executable; default `sigilc`.                                                                        |
| `sigil.compile.focus`              | `ask`, `design`, or `implementation`.                                                                                |
| `sigil.compile.selection`          | Native Implementation selection JSON path, relative to the workspace or absolute; required for Implementation focus. |

The workspace folder must contain its `.sigil/config.json`. Multi-root windows
use the active document's containing folder or prompt for a folder. The
extension invokes `sigilc` directly against the workspace folder and reads its
sources itself. Scope and source selection are resolved by the native compiler. Design-only file runs explicitly
select no Implementation sources and make no Implementation claim.

The status bar displays Coherent/Loose/Disjoint or Closed/Converged/Drift as
returned by the native gate. Green and yellow exit 0, red exits 1; missing
current Design reconstruction leaves comparison unavailable with exit 3 and no
Implementation state. The editor validates those pairings and displays native
findings and truncation counts. It does not interpret eqval tables or infer
color from absent diagnostics. File-only locations do not invent code ranges.

Native compilation requires native report version 2. Old reports are rejected. Ranged findings carry a source
digest and an explicit coordinate convention; the editor verifies disk bytes and
maps them to visible UTF-16 text, including hidden BOMs and normalized line
endings. A stale source cannot publish a successful state or misleading range.

Save workspace documents before compilation. Edits, disk changes and compilation
settings changes invalidate displayed results; replacement runs cancel previous
ones. Stdout is bounded to 64 MiB, stderr to 1 MiB and each subprocess to 120
seconds, with forced termination if cancellation is ignored. No profiles,
stages, retained diagnostic history, JSONL events or model runtime remain in the
editor. See the [native guide](../../../packages/sigilc/README.md) for external
reconstruction and source-selection schemas.

## Document preview

Open a `.sigil` file and either run **Sigil: Open Preview** from the Command
Palette or click the preview icon (`$(open-preview)`) in the editor title
toolbar. The whole file is rendered to Markdown by the language server (every
component declared in the file, with all owned contract sections and Facets) and
shown in the built-in Markdown preview beside the source editor. The preview is
not cursor-dependent — it always renders the entire file. The toolbar button
appears only for Sigil editors; if the language server is unavailable or the
file has no components, an informational message is shown and no preview opens.

This integration should become the first concrete human UI for Sigil.

The extension targets desktop and remote Node extension hosts with file-backed
workspaces. VS Code for the Web, virtual workspaces, telemetry, document
mutation, and custom LSP methods remain outside the initial version.

Development:

```bash
npm install
npm test
SIGIL_TEST_LANGUAGE=/path/to/current/sigil SIGIL_TEST_COMPILER=/path/to/current/sigilc npm run test:extension
npm run package
```

The extension-host test copies the slotted example into an isolated temporary
workspace by default. Set `SIGIL_TEST_WORKSPACE` to test an existing workspace.
It uses the current built tools for real native file scope, ranged
findings and unavailable comparison. `deno task build:sigil` builds the
language CLI into `packages/cli/target/debug/` (the default language test
executable); `deno task build:sigilc` produces the native test executable. The
environment variables above can select other built binaries. On
a headless Linux host, run the extension test under `xvfb-run -a`.

`npm run package` derives the artifact version from `package.json` and creates
`build/sigil-vscode-<version>.vsix`, a package that ships no `sigil`.
`npm run package -- --target <platform> --binary <path to sigil>` (or
`deno task package:vscode --target … --binary …` from the repository root) makes
the platform package `build/sigil-vscode-<version>-<platform>.vsix` with that
`sigil` in its `bin` folder; the platforms are `win32-x64`, `linux-x64`,
`linux-arm64`, `darwin-x64` and `darwin-arm64`. The manifest uses the development publisher
identifier `sigil-dev`; Marketplace publication remains deferred until an
approved publisher identity exists.

Tagged `vscode-vX.Y.Z` releases package the extension and attach the VSIX to a
GitHub Release. Install a downloaded package with **Extensions: Install from
VSIX...** in VS Code or:

```bash
code --install-extension sigil-vscode-VERSION.vsix
```
