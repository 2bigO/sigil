import assert from "node:assert/strict";
import path from "node:path";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const repository = process.env.SIGIL_REPO_ROOT;
  assert(repository, "SIGIL_REPO_ROOT is required");
  const source = vscode.Uri.file(
    path.join(repository, "examples/slotted/auth.sigil"),
  );
  const document = await vscode.workspace.openTextDocument(source);
  const editor = await vscode.window.showTextDocument(document);
  assert.equal(document.languageId, "sigil");

  const extension = vscode.extensions.getExtension("sigil-dev.sigil");
  assert(extension, "Sigil extension was not discovered");
  await extension.activate();

  const position = new vscode.Position(0, 31);
  editor.selection = new vscode.Selection(position, position);

  const hovers = await eventually(async () =>
    await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      source,
      position,
    )
  );
  assert(hovers.length > 0, "Expected a Sigil hover result");
  assert(
    hovers.some((hover) =>
      hover.contents.some((content) =>
        (typeof content === "string" ? content : content.value).includes(
          "UserProfile",
        )
      )
    ),
    "Hover should contain the imported component contract",
  );

  const definitions = await eventually(async () =>
    await vscode.commands.executeCommand<
      Array<vscode.Location | vscode.LocationLink>
    >(
      "vscode.executeDefinitionProvider",
      source,
      position,
    )
  );
  assert(definitions.length > 0, "Expected go-to-definition results");

  const sectionPosition = new vscode.Position(27, 22);
  const sectionHovers = await eventually(async () =>
    await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      source,
      sectionPosition,
    )
  );
  assert(
    sectionHovers.some((hover) =>
      hover.contents.some((content) =>
        (typeof content === "string" ? content : content.value).includes(
          "User",
        )
      )
    ),
    "A component reference inside a section should provide hover",
  );
  const sectionDefinitions = await eventually(async () =>
    await vscode.commands.executeCommand<
      Array<vscode.Location | vscode.LocationLink>
    >(
      "vscode.executeDefinitionProvider",
      source,
      sectionPosition,
    )
  );
  assert(
    sectionDefinitions.length > 0,
    "A component reference inside a section should provide a definition",
  );

  await vscode.commands.executeCommand("sigil.showComponentPreview");
  await eventually(() => {
    const active = vscode.window.activeTextEditor;
    return active?.document.uri.scheme === "sigil-preview" ? [active] : [];
  });
  const preview = vscode.window.activeTextEditor?.document;
  assert.equal(preview?.uri.scheme, "sigil-preview");
  assert(preview.getText().includes("UserProfile"));

  // Empty case: with the cursor away from any component reference, the same
  // command (invoked by the editor-title action) leaves editors unchanged and
  // shows an informational message rather than opening a preview.
  //
  // The command awaits showInformationMessage; in the headless host that
  // promise does not resolve on its own, so stub it to resolve immediately and
  // capture the surfaced message.
  const sourceEditor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
  });
  const blankPosition = new vscode.Position(1, 0);
  sourceEditor.selection = new vscode.Selection(blankPosition, blankPosition);

  const originalShowInfo = vscode.window.showInformationMessage;
  let infoMessage: string | undefined;
  // deno-lint-ignore no-explicit-any
  (vscode.window as any).showInformationMessage = (message: string) => {
    infoMessage = message;
    return Promise.resolve(undefined);
  };
  try {
    await vscode.commands.executeCommand("sigil.showComponentPreview");
  } finally {
    // deno-lint-ignore no-explicit-any
    (vscode.window as any).showInformationMessage = originalShowInfo;
  }

  assert(
    infoMessage?.includes("No Sigil component"),
    "Empty preview should surface the existing informational message",
  );
  const activeAfterEmpty = vscode.window.activeTextEditor;
  assert.equal(
    activeAfterEmpty?.document.uri.scheme,
    "file",
    "No component at the cursor should not open a preview editor",
  );
  assert.equal(activeAfterEmpty?.document.languageId, "sigil");
}

async function eventually<T>(
  operation: () => T[] | Promise<T[]>,
): Promise<T[]> {
  const deadline = Date.now() + 10_000;
  let result: T[] = [];
  while (Date.now() < deadline) {
    result = await operation();
    if (result.length) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return result;
}
