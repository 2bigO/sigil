import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::EditorLanguageSupport
 * @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::ComponentPreview
 */
test("manifest contributes the Sigil language, grammar, and preview command", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.publisher, "sigil-dev");
  assert.equal(manifest.engines.vscode, "^1.91.0");
  assert.deepEqual(manifest.capabilities, {
    untrustedWorkspaces: {
      supported: false,
      description:
        "Sigil language features require a trusted file-backed workspace.",
    },
    virtualWorkspaces: {
      supported: false,
      description: "Sigil language features require a file-backed workspace.",
    },
  });
  assert.deepEqual(manifest.contributes.languages[0].extensions, [".sigil"]);
  assert.equal(manifest.contributes.grammars[0].scopeName, "source.sigil");
  assert.equal(
    manifest.contributes.commands[0].command,
    "sigil.showComponentPreview",
  );
});

/*
 * @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::ExtensionPackage
 * @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::ArtifactVersionOwnership
 */
test("package command derives the VSIX filename from the manifest version", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const packaging = await readFile("scripts/package-extension.mjs", "utf8");
  assert.equal(manifest.scripts.package.includes("sigil-vscode-0.6.0"), false);
  assert.equal(packaging.includes("manifest.version"), true);
  assert.equal(
    packaging.includes("sigil-vscode-${manifest.version}.vsix"),
    true,
  );
});

// @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::EditorLanguageSupport
test("TextMate grammar colors syntax without treating capitalized prose as names", async () => {
  const grammar = JSON.parse(
    await readFile("syntaxes/sigil.tmLanguage.json", "utf8"),
  );
  assert.equal(grammar.scopeName, "source.sigil");
  assert(grammar.repository.imports);
  assert(grammar.repository.declarations);
  assert(grammar.repository.sections);
  assert(grammar.repository.concepts);
  assert.equal(
    grammar.repository.sections.patterns[0].match.includes("decisions"),
    true,
  );
  assert.equal(grammar.repository["type-names"], undefined);
  assert.equal(
    JSON.stringify(grammar).includes("\\\\b[A-Z][A-Za-z0-9_]*\\\\b"),
    false,
  );
  assert.equal(
    JSON.stringify(grammar).includes("entity.name.type.concept.sigil"),
    true,
  );
  assert.equal(JSON.stringify(grammar).includes("comment"), false);
});

// @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::EditorLanguageSupport
test("manifest maps concept and glossary semantic tokens to a visible TextMate scope", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.deepEqual(
    manifest.contributes.semanticTokenScopes[0],
    {
      language: "sigil",
      scopes: {
        concept: ["entity.name.type.concept.sigil"],
        term: ["entity.name.type.concept.sigil"],
      },
    },
  );
});
