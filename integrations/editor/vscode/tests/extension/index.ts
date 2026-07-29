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

  // Success: previewing the whole Sigil file opens a Markdown preview webview
  // beside the source editor, independent of cursor position.
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
  });
  await vscode.commands.executeCommand("sigil.openPreview");
  const previewTabs = await eventually(() =>
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputWebview)
  );
  assert(previewTabs.length > 0, "Expected a Markdown preview webview tab");

  // Informational path: running preview on a non-Sigil editor shows a
  // non-destructive message and opens no additional preview. The command awaits
  // showInformationMessage, which does not resolve on its own in the headless
  // host, so stub it to resolve immediately and capture the message.
  const plain = await vscode.workspace.openTextDocument({
    content: "not sigil",
    language: "plaintext",
  });
  await vscode.window.showTextDocument(plain, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
  });
  const webviewCountBefore = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview).length;

  const originalShowInfo = vscode.window.showInformationMessage;
  let infoMessage: string | undefined;
  // deno-lint-ignore no-explicit-any
  (vscode.window as any).showInformationMessage = (message: string) => {
    infoMessage = message;
    return Promise.resolve(undefined);
  };
  try {
    await vscode.commands.executeCommand("sigil.openPreview");
  } finally {
    // deno-lint-ignore no-explicit-any
    (vscode.window as any).showInformationMessage = originalShowInfo;
  }

  assert(
    infoMessage?.includes("Open a Sigil document"),
    "A non-Sigil editor should surface the informational message",
  );
  const webviewCountAfter = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview).length;
  assert.equal(
    webviewCountAfter,
    webviewCountBefore,
    "A non-Sigil editor should not open another preview",
  );
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
