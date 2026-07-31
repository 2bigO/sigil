import path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  RevealOutputChannelOn,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { type HoverLike, hoverToMarkdown } from "./preview.ts";
import {
  type CompilationEvent,
  type CompilationProcess,
  type CompilationReport,
  diagnosticDisplayRange,
  runCompilationProcess,
} from "./compilation.ts";

const PREVIEW_COMMAND = "sigil.showComponentPreview";
const PREVIEW_SCHEME = "sigil-preview";
const COMPILE_COMPONENT_COMMAND = "sigil.compileComponent";
const COMPILE_WORKSPACE_COMMAND = "sigil.compileWorkspace";
let client: LanguageClient | undefined;
let activeCompilation: CompilationProcess | undefined;

// @sigil implements integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::ComponentPreview interface,state,logic,cases
class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  readonly #contents = new Map<string, string>();
  #sequence = 0;

  create(content: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: PREVIEW_SCHEME,
      path: "/Component Preview.md",
      query: String(++this.#sequence),
    });
    this.#contents.set(uri.toString(), content);
    return uri;
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
  const compilationDiagnostics = vscode.languages.createDiagnosticCollection(
    "sigil-compile",
  );
  const compilationStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    90,
  );
  compilationStatus.name = "Sigil Compilation";
  compilationStatus.command = COMPILE_COMPONENT_COMMAND;
  compilationStatus.text = "$(play) Sigil Compile";
  compilationStatus.tooltip = "Compile the active Sigil component";
  compilationStatus.show();
  context.subscriptions.push(
    output,
    compilationDiagnostics,
    compilationStatus,
    vscode.workspace.registerTextDocumentContentProvider(
      PREVIEW_SCHEME,
      previews,
    ),
    vscode.commands.registerCommand(PREVIEW_COMMAND, async () => {
      await showComponentPreview(previews);
    }),
    vscode.commands.registerCommand(COMPILE_COMPONENT_COMMAND, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "sigil") {
        await vscode.window.showInformationMessage(
          "Open a Sigil document to compile its component.",
        );
        return;
      }
      const position = editor.selection.active;
      await compileFromEditor(
        context,
        output,
        compilationDiagnostics,
        compilationStatus,
        [
          "--file",
          editor.document.uri.fsPath,
          "--position",
          `${position.line + 1}:${position.character + 1}`,
        ],
        editor.document.uri,
      );
    }),
    vscode.commands.registerCommand(COMPILE_WORKSPACE_COMMAND, async () => {
      await compileFromEditor(
        context,
        output,
        compilationDiagnostics,
        compilationStatus,
        [],
        vscode.window.activeTextEditor?.document.uri,
      );
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
  activeCompilation?.cancel();
  activeCompilation = undefined;
  const running = client;
  client = undefined;
  if (running?.isRunning()) await running.stop();
}

/**
 * @sigil implements integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::CompilationSurface interface,state,logic,constraints,cases
 * @sigil uses packages/cli/#module.sigil::SigilCli::CompilationFacade interface,constraints
 */
async function compileFromEditor(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  status: vscode.StatusBarItem,
  targetArgs: readonly string[],
  preferredUri?: vscode.Uri,
): Promise<void> {
  const folder = await selectCompilationFolder(preferredUri);
  if (!folder) {
    await vscode.window.showInformationMessage(
      "Sigil compilation requires a file-backed workspace.",
    );
    return;
  }
  activeCompilation?.cancel();
  diagnostics.clear();
  const configuration = vscode.workspace.getConfiguration("sigil.compile");
  const executable = configuration.get<string>("executable", "sigil");
  const profile = configuration.get<string>("profile", "standard");
  status.text = "$(sync~spin) Sigil compiling";
  status.tooltip = `Profile: ${profile}`;
  const process = runCompilationProcess(
    executable,
    ["compile", folder.uri.fsPath, ...targetArgs, "--profile", profile],
    folder.uri.fsPath,
    (event) => showCompilationEvent(output, event),
    (line) => output.info(line),
  );
  activeCompilation = process;
  try {
    const report = await process.result;
    if (activeCompilation !== process) return;
    projectCompilationReport(report, diagnostics, status, folder.uri);
    output.show(true);
  } catch (error) {
    if (activeCompilation !== process) return;
    status.text = "$(error) Sigil compile failed";
    const message = error instanceof Error ? error.message : String(error);
    output.error(message);
    const action = await vscode.window.showErrorMessage(
      `Sigil compilation failed: ${message}`,
      "Open Settings",
    );
    if (action === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "sigil.compile.executable",
      );
    }
  } finally {
    if (activeCompilation === process) activeCompilation = undefined;
  }
  void context;
}

async function selectCompilationFolder(
  preferredUri?: vscode.Uri,
): Promise<vscode.WorkspaceFolder | undefined> {
  if (preferredUri?.scheme === "file") {
    const enclosing = vscode.workspace.getWorkspaceFolder(preferredUri);
    if (enclosing?.uri.scheme === "file") return enclosing;
  }
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) =>
    folder.uri.scheme === "file"
  );
  if (folders.length === 1) return folders[0];
  if (folders.length < 2) return undefined;
  const selected = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder: "Select the workspace folder to compile" },
  );
  return selected?.folder;
}

function showCompilationEvent(
  output: vscode.LogOutputChannel,
  event: CompilationEvent,
): void {
  if (event.type === "stage-started") {
    output.info(`Running ${String(event.payload.stage)}...`);
  } else if (event.type === "diagnostic") {
    const diagnostic = event.payload.diagnostic as
      | { severity?: string; code?: string; message?: string }
      | undefined;
    if (diagnostic) {
      output.info(
        `${diagnostic.severity ?? "information"} ${
          diagnostic.code ?? "COMPILER"
        }: ${diagnostic.message ?? ""}`,
      );
    }
  }
}

function projectCompilationReport(
  report: CompilationReport,
  collection: vscode.DiagnosticCollection,
  status: vscode.StatusBarItem,
  root: vscode.Uri,
): void {
  const byUri = new Map<string, vscode.Diagnostic[]>();
  for (const item of report.diagnostics) {
    if (!item.filePath) continue;
    const uri = path.isAbsolute(item.filePath)
      ? vscode.Uri.file(item.filePath)
      : vscode.Uri.joinPath(root, item.filePath);
    const displayRange = diagnosticDisplayRange(item);
    const range = displayRange
      ? new vscode.Range(
        Math.max(0, displayRange.start.line - 1),
        Math.max(0, displayRange.start.column - 1),
        Math.max(0, displayRange.end.line - 1),
        Math.max(0, displayRange.end.column - 1),
      )
      : new vscode.Range(0, 0, 0, 1);
    const severity = item.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : item.severity === "warning"
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;
    const diagnostic = new vscode.Diagnostic(range, item.message, severity);
    diagnostic.code = item.code;
    diagnostic.source = "sigil compile";
    const key = uri.toString();
    byUri.set(key, [...(byUri.get(key) ?? []), diagnostic]);
  }
  collection.set(
    [...byUri].map(([uri, items]) => [vscode.Uri.parse(uri), items]),
  );
  const icon = report.status === "green"
    ? "$(pass-filled)"
    : report.status === "yellow"
    ? "$(warning)"
    : "$(error)";
  status.text = `${icon} Sigil ${report.status}`;
  status.tooltip = `${
    report.componentNames.join(", ") || "Workspace"
  }: ${report.diagnostics.length} findings`;
}

async function showComponentPreview(
  previews: PreviewContentProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "sigil") {
    await vscode.window.showInformationMessage(
      "Open a Sigil document and place the cursor on a component to preview it.",
    );
    return;
  }
  if (!client?.isRunning()) {
    await vscode.window.showInformationMessage(
      "The Sigil language server is not available.",
    );
    return;
  }
  const hover = await client.sendRequest<HoverLike | null>(
    "textDocument/hover",
    {
      textDocument: { uri: editor.document.uri.toString() },
      position: {
        line: editor.selection.active.line,
        character: editor.selection.active.character,
      },
    },
  );
  const markdown = hoverToMarkdown(hover);
  if (!markdown) {
    await vscode.window.showInformationMessage(
      "No Sigil component is available at the active cursor.",
    );
    return;
  }
  const document = await vscode.workspace.openTextDocument(
    previews.create(markdown),
  );
  await vscode.window.showTextDocument(document, {
    preview: true,
    preserveFocus: false,
    viewColumn: vscode.ViewColumn.Beside,
  });
}
