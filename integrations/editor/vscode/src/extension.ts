import path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  RevealOutputChannelOn,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

const PREVIEW_COMMAND = "sigil.openPreview";
const RENDER_DOCUMENT_COMMAND = "sigil.renderDocument";
const PREVIEW_SCHEME = "sigil-preview";
let client: LanguageClient | undefined;

// @sigil implements integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::ComponentPreview interface,state,logic,cases
class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  readonly #contents = new Map<string, string>();
  readonly #emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.#emitter.event;

  // One stable preview URI per source document so re-running the command
  // refreshes the same preview rather than opening a new tab. The `.md` path
  // makes VS Code treat the virtual document as Markdown.
  previewUri(source: vscode.Uri): vscode.Uri {
    const name = source.path.split("/").pop() ?? "preview";
    return vscode.Uri.from({
      scheme: PREVIEW_SCHEME,
      path: `/${name}.md`,
      query: source.toString(),
    });
  }

  set(uri: vscode.Uri, content: string): void {
    this.#contents.set(uri.toString(), content);
    this.#emitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.#contents.get(uri.toString()) ?? "";
  }
}

/**
 * @sigil implements integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,state,logic,constraints,cases
 * @sigil implements integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::ComponentPreview interface,state,logic,cases
 * @sigil implements integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::SupportedExtensionHosts interface,constraints,cases
 * @sigil implements integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::ReadOnlyEditorSupport interface,constraints
 * @sigil implements integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,logic,constraints
 */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const output = vscode.window.createOutputChannel("Sigil", { log: true });
  const previews = new PreviewContentProvider();
  context.subscriptions.push(
    output,
    vscode.workspace.registerTextDocumentContentProvider(
      PREVIEW_SCHEME,
      previews,
    ),
    vscode.commands.registerCommand(PREVIEW_COMMAND, async () => {
      await openPreview(previews);
    }),
  );

  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio },
  };
  client = new LanguageClient(
    "sigil",
    "Sigil",
    serverOptions,
    {
      documentSelector: [{ scheme: "file", language: "sigil" }],
      outputChannel: output,
      revealOutputChannelOn: RevealOutputChannelOn.Error,
    },
  );

  try {
    await client.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Failed to start Sigil language server: ${message}`);
    const action = await vscode.window.showErrorMessage(
      "The Sigil language server failed to start.",
      "Open Output",
    );
    if (action === "Open Output") output.show(true);
  }
}

// @sigil implements integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,state,logic,constraints,cases
export async function deactivate(): Promise<void> {
  const running = client;
  client = undefined;
  if (running?.isRunning()) await running.stop();
}

async function openPreview(previews: PreviewContentProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "sigil") {
    await vscode.window.showInformationMessage(
      "Open a Sigil document to preview it.",
    );
    return;
  }
  if (!client?.isRunning()) {
    await vscode.window.showInformationMessage(
      "The Sigil language server is not available.",
    );
    return;
  }
  const markdown = await client.sendRequest<string>(
    "workspace/executeCommand",
    {
      command: RENDER_DOCUMENT_COMMAND,
      arguments: [editor.document.uri.toString()],
    },
  );
  if (!markdown?.trim()) {
    await vscode.window.showInformationMessage(
      "No Sigil components are available to preview in this file.",
    );
    return;
  }
  const previewUri = previews.previewUri(editor.document.uri);
  previews.set(previewUri, markdown);
  await vscode.workspace.openTextDocument(previewUri);
  await vscode.commands.executeCommand(
    "markdown.showPreviewToSide",
    previewUri,
  );
}
