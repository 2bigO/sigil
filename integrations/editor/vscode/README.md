# VS Code Integration

Implemented pre-production VS Code extension for Sigil.

Version 0.6 responsibilities:

- provide `.sigil` TextMate syntax highlighting and resolver-backed component
  concept, and reviewed glossary-term highlighting through LSP semantic tokens;
- bundle and connect to `sigil-lsp` for diagnostics, symbols, navigation, hover,
  and semantic highlighting;
- expose `Sigil: Show Component Preview` using the standard LSP hover response,
  available from the Command Palette and from a preview button in the editor
  title toolbar of `.sigil` editors (Markdown-style *Open Preview to the Side*);
- provide editor-native affordances without duplicating `sigil-core` behavior.

## Component preview

Open a `.sigil` file and place the cursor on a component reference, then either
run **Sigil: Show Component Preview** from the Command Palette or click the
preview icon (`$(open-preview)`) in the editor title toolbar. The component
contract and its collected expansions open as read-only Markdown beside the
source editor. The toolbar button appears only for Sigil editors and reuses the
same command; if no component is available at the cursor, an informational
message is shown and no preview opens.

This integration should become the first concrete human UI for Sigil.

Version 0.6 targets desktop and remote Node extension hosts with file-backed
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
