/**
 * A short language-server session against a built `sigil`, for the release
 * smoke test and the extension package check: initialize, open one `.sigil`
 * document, expect its published diagnostics and a non-empty document symbol
 * answer, then shut down and exit. Opening a document is what exercises the
 * file URI to path conversion, which the server's own session tests cannot do
 * on Windows.
 *
 * Usage: deno run --allow-read --allow-run --allow-env scripts/lsp-smoke.ts <sigil> <workspace> <document>
 */
import { pathToFileURL } from "node:url";

interface Message {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export interface SmokeOptions {
  executable: string;
  /** The workspace folder holding `.sigil/config.json`. */
  workspace: string;
  /** The `.sigil` document to open, an absolute path inside the workspace. */
  document: string;
  env?: Record<string, string>;
  clearEnv?: boolean;
  timeoutMs?: number;
}

export interface SmokeResult {
  diagnostics: number;
  symbols: number;
  stderr: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function frame(message: Message): Uint8Array {
  const body = encoder.encode(JSON.stringify({ jsonrpc: "2.0", ...message }));
  const head = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

/** Cuts a byte stream into the JSON messages of `Content-Length` frames. */
async function* messages(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Message> {
  let buffer = new Uint8Array(0);
  const append = (chunk: Uint8Array) => {
    const next = new Uint8Array(buffer.length + chunk.length);
    next.set(buffer);
    next.set(chunk, buffer.length);
    buffer = next;
  };
  const reader = stream.getReader();
  try {
    for (;;) {
      for (;;) {
        const text = decoder.decode(
          buffer.subarray(0, Math.min(buffer.length, 512)),
        );
        const end = text.indexOf("\r\n\r\n");
        if (end < 0) break;
        const length = /Content-Length:\s*(\d+)/i.exec(text.slice(0, end));
        if (!length) throw new Error(`A frame has no Content-Length: ${text}`);
        const headBytes = encoder.encode(text.slice(0, end + 4)).length;
        const total = headBytes + Number(length[1]);
        if (buffer.length < total) break;
        const body = buffer.slice(headBytes, total);
        buffer = buffer.slice(total);
        yield JSON.parse(decoder.decode(body)) as Message;
      }
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.length > 0) throw new Error("The server ended mid-frame");
        return;
      }
      append(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function lspSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const text = await Deno.readTextFile(options.document);
  const uri = pathToFileURL(options.document).href;
  const child = new Deno.Command(options.executable, {
    args: ["lsp"],
    cwd: options.workspace,
    env: options.env,
    clearEnv: options.clearEnv,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stderr = new Response(child.stderr).text();
  const writer = child.stdin.getWriter();
  const send = (message: Message) => writer.write(frame(message));
  const timer = setTimeout(() => {
    try {
      child.kill();
    } catch { /* already gone */ }
  }, options.timeoutMs ?? 30_000);

  let diagnostics: number | undefined;
  let symbols: number | undefined;
  const incoming = messages(child.stdout);
  const nextMessage = async (): Promise<Message> => {
    const { done, value } = await incoming.next();
    if (done) {
      throw new Error(`The server ended its output early: ${await stderr}`);
    }
    return value;
  };
  /** Reads until `done` holds, answering any request the server makes. */
  const until = async (done: () => boolean, what: string) => {
    while (!done()) {
      const message = await nextMessage();
      if (message.id !== undefined && message.method) {
        await send({ id: message.id, result: null });
      } else if (message.method === "textDocument/publishDiagnostics") {
        const params = message.params as {
          uri: string;
          diagnostics: unknown[];
        };
        if (params.uri === uri) diagnostics = params.diagnostics.length;
      } else if (message.id === 2) {
        const result = message.result as unknown[] | null;
        symbols = Array.isArray(result) ? result.length : 0;
      }
    }
    return what;
  };
  let initialized = false;
  try {
    await send({
      id: 1,
      method: "initialize",
      params: {
        processId: null,
        rootUri: pathToFileURL(options.workspace).href,
        capabilities: {},
      },
    });
    for (;;) {
      const message = await nextMessage();
      if (message.id === 1 && message.method === undefined) {
        if (message.error) {
          throw new Error(
            `initialize failed: ${JSON.stringify(message.error)}`,
          );
        }
        initialized = true;
        break;
      }
      if (message.id !== undefined && message.method) {
        await send({ id: message.id, result: null });
      }
    }
    await send({ method: "initialized", params: {} });
    await send({
      method: "textDocument/didOpen",
      params: {
        textDocument: { uri, languageId: "sigil", version: 1, text },
      },
    });
    await until(() => diagnostics !== undefined, "published diagnostics");
    await send({
      id: 2,
      method: "textDocument/documentSymbol",
      params: { textDocument: { uri } },
    });
    await until(() => symbols !== undefined, "document symbols");
    await send({ id: 3, method: "shutdown" });
    let shutdown = false;
    while (!shutdown) {
      const message = await nextMessage();
      if (message.id === 3 && message.method === undefined) shutdown = true;
      else if (message.id !== undefined && message.method) {
        await send({ id: message.id, result: null });
      }
    }
    await send({ method: "exit" });
    await writer.close();
    // Let the server finish writing, then expect a clean end.
    for await (const _ of incoming) { /* drain */ }
  } catch (error) {
    try {
      child.kill();
    } catch { /* already gone */ }
    await child.status.catch(() => undefined);
    throw new Error(
      `${
        (error as Error).message
      } (initialized: ${initialized}, stderr: ${await stderr})`,
    );
  } finally {
    clearTimeout(timer);
  }
  const status = await child.status;
  const err = await stderr;
  if (!status.success || err !== "") {
    throw new Error(`sigil lsp exited ${status.code} with stderr: ${err}`);
  }
  if (!diagnostics && diagnostics !== 0) {
    throw new Error("No diagnostics were published for the opened document");
  }
  if (!symbols) throw new Error("The document symbol answer was empty");
  return { diagnostics: diagnostics!, symbols, stderr: err };
}

if (import.meta.main) {
  const [executable, workspace, document] = Deno.args;
  if (!executable || !workspace || !document) {
    throw new Error("Usage: lsp-smoke.ts <sigil> <workspace> <document>");
  }
  const result = await lspSmoke({ executable, workspace, document });
  console.log(JSON.stringify(result));
}
