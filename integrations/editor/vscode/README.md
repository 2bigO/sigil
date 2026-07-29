# VS Code Integration

Implemented pre-production VS Code extension for Sigil.

Version 0.7 responsibilities:

- provide `.sigil` TextMate syntax highlighting and resolver-backed component
  concept, and reviewed glossary-term highlighting through LSP semantic tokens;
- bundle and connect to `sigil-lsp` for diagnostics, symbols, navigation, hover,
  and semantic highlighting;
- expose `Sigil: Open Preview`, which renders the whole active `.sigil` file to
  Markdown and opens it in VS Code's built-in Markdown preview, available from
  the Command Palette and from a preview button in the editor title toolbar of
  `.sigil` editors (Markdown-style *Open Preview to the Side*);
- provide editor-native affordances without duplicating `sigil-core` behavior.

## Document preview

Open a `.sigil` file and either run **Sigil: Open Preview** from the Command
Palette or click the preview icon (`$(open-preview)`) in the editor title
toolbar. The whole file is rendered to Markdown by the language server (every
component declared in the file, with its collected expansions) and shown in the
built-in Markdown preview beside the source editor. The preview is not
cursor-dependent — it always renders the entire file. The toolbar button appears
only for Sigil editors; if the language server is unavailable or the file has no
components, an informational message is shown and no preview opens.

This integration should become the first concrete human UI for Sigil.

Version 0.7 targets desktop and remote Node extension hosts with file-backed
workspaces. VS Code for the Web, virtual workspaces, telemetry, document
mutation, and custom LSP methods remain outside the initial version.

The approved member-root contract lives in [#module.sigil](./%23module.sigil).

Development:

```bash
npm install
npm test
npm run test:extension
npm run package
```

`npm run package` derives the artifact version from `package.json` and creates
`build/sigil-vscode-<version>.vsix`. The manifest uses the development publisher
identifier `sigil-dev`; Marketplace publication remains deferred until an
approved publisher identity exists.

Tagged `vscode-vX.Y.Z` releases package the extension and attach the VSIX to a
GitHub Release. Install a downloaded package with **Extensions: Install from
VSIX...** in VS Code or:

```bash
code --install-extension sigil-vscode-VERSION.vsix
```
