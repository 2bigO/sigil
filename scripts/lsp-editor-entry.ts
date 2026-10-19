/**
 * Runs the TypeScript language server the way the VS Code extension does: the
 * same `protocolSource` hook, so a disk file's byte-order mark is hidden from
 * every position. `scripts/compare-lsp.ts` starts it next to `sigil lsp`.
 */
import { EditorProtocolSource } from "../integrations/editor/vscode/src/coordinates.ts";
import { runLanguageServer } from "../packages/lsp/src/protocol.ts";
import { SigilLanguageServer } from "../packages/lsp/src/server.ts";

try {
  const server = new SigilLanguageServer({
    protocolSource: (source) => new EditorProtocolSource(source),
  });
  const exitCode = await runLanguageServer(
    Deno.stdin.readable,
    Deno.stdout.writable,
    server,
  );
  Deno.exit(exitCode);
} catch (error) {
  await Deno.stderr.write(
    new TextEncoder().encode(
      `${error instanceof Error ? error.message : String(error)}\n`,
    ),
  );
  Deno.exit(1);
}
