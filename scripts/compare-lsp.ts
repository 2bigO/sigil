/**
 * Compares the TypeScript language server with `sigil lsp` (the Rust server)
 * on a real workspace, and times a `didChange` reload on each. It runs by
 * hand before a cutover and is not a CI gate.
 *
 *   deno run -A scripts/compare-lsp.ts <path to the sigil binary> [--root <dir>] [--timing-only]
 *
 * Both servers run as child processes over standard input and output with the
 * workspace root as their current directory. The TypeScript one is started
 * through `scripts/lsp-editor-entry.ts`, so it answers as the editor sees it.
 * The script opens every `.sigil` file under the root with its disk text (a
 * leading byte-order mark is dropped, as an editor drops it, so no mark ever
 * reaches a buffer), then compares per file the final published diagnostics,
 * `documentSymbol`, `semanticTokens/full`, and `definition` and `hover` at the
 * start of every semantic token. It exits 1 on a difference that is not one of
 * these normalizations:
 *
 * - The initialize result compares only `capabilities`, not `serverInfo`,
 *   whose version differs. The `client/registerCapability` request is never
 *   compared (TS sends two registrations under the id
 *   `sigil/ownership-watch/request`; Rust sends one under `sigil/watch/request`);
 *   the client answers it with null.
 * - Hover text loses its `**Owned implementations**` blocks (a blank line, the
 *   bold label and the `- ` items below it); the Rust server never shows them.
 * - Diagnostic messages are masked as the recorded replay masks them
 *   (`KNOWN_DIFFERENCES` in `packages/lsp/tests/support/mod.rs`): the parser's
 *   own text after ` JSON:` in a JSON parse error, and the root path that the
 *   TS core writes into `Source <root>/...` of an unresolved imported
 *   component, where the Rust core writes a relative path.
 * - A file with no diagnostics counts the same as a file never published.
 *
 * `documentSymbol` needs no byte-order-mark shift here, because no buffer
 * carries a mark (the replay shifts only for a disk-sourced file).
 */
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Json = unknown;
type Message = Record<string, Json>;
interface Position {
  line: number;
  character: number;
}

const PATIENCE_MS = 30_000;
const SKIPPED = new Set([".git", "node_modules", "target", "dist", "build"]);
const SHOWN_DIFFERENCES = 15;
const RELOADS = 5;
const repoRoot = new URL("..", import.meta.url).pathname;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// A small LSP client

class Client {
  readonly diagnostics = new Map<string, unknown[]>();
  publishes = 0;
  stderr = "";
  #process: Deno.ChildProcess;
  #writer: WritableStreamDefaultWriter<Uint8Array>;
  #next = 1;
  #pending = new Map<
    number,
    { resolve: (message: Message) => void; method: string }
  >();
  #publishWaiters: (() => void)[] = [];

  constructor(command: string, args: string[], cwd: string) {
    this.#process = new Deno.Command(command, {
      args,
      cwd,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    this.#writer = this.#process.stdin.getWriter();
    this.#readMessages();
    this.#process.stderr.pipeTo(
      new WritableStream({
        write: (chunk) => void (this.stderr += decoder.decode(chunk)),
      }),
    ).catch(() => {});
  }

  async #readMessages() {
    let buffer: Uint8Array = new Uint8Array(0);
    for await (const chunk of this.#process.stdout) {
      buffer = concat(buffer, chunk);
      for (;;) {
        const end = find(buffer, "\r\n\r\n");
        if (end < 0) break;
        const header = decoder.decode(buffer.subarray(0, end));
        const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1]);
        if (buffer.length < end + 4 + length) break;
        const body = buffer.subarray(end + 4, end + 4 + length);
        buffer = buffer.slice(end + 4 + length);
        this.#receive(JSON.parse(decoder.decode(body)));
      }
    }
    for (const { resolve, method } of this.#pending.values()) {
      resolve({ error: `the server closed its output during ${method}` });
    }
  }

  #receive(message: Message) {
    if (typeof message.method === "string") {
      if (message.method === "textDocument/publishDiagnostics") {
        const params = message.params as {
          uri: string;
          diagnostics: unknown[];
        };
        this.diagnostics.set(params.uri, params.diagnostics);
        this.publishes++;
        this.#publishWaiters.splice(0).forEach((wake) => wake());
      } else if (message.id !== undefined) {
        // A request from the server, such as a watch registration.
        this.#send({ jsonrpc: "2.0", id: message.id, result: null });
      }
      return;
    }
    const entry = this.#pending.get(message.id as number);
    this.#pending.delete(message.id as number);
    entry?.resolve(message);
  }

  async #send(message: Message) {
    const body = encoder.encode(JSON.stringify(message));
    await this.#writer.write(
      concat(encoder.encode(`Content-Length: ${body.length}\r\n\r\n`), body),
    );
  }

  request(method: string, params: Json): Promise<Message> {
    const id = this.#next++;
    const answer = new Promise<Message>((resolve) => {
      this.#pending.set(id, { resolve, method });
      setTimeout(() => {
        if (this.#pending.delete(id)) {
          resolve({ error: `no answer to ${method} in ${PATIENCE_MS} ms` });
        }
      }, PATIENCE_MS);
    });
    this.#send({ jsonrpc: "2.0", id, method, params });
    return answer;
  }

  notify(method: string, params: Json) {
    return this.#send({ jsonrpc: "2.0", method, params });
  }

  /** Resolves with the time until the next diagnostics publication arrives. */
  async nextPublish(): Promise<number> {
    const started = performance.now();
    const seen = this.publishes;
    while (this.publishes === seen) {
      await new Promise<void>((wake) => {
        this.#publishWaiters.push(wake);
        setTimeout(wake, PATIENCE_MS);
      });
      if (performance.now() - started >= PATIENCE_MS) {
        throw new Error("no diagnostics after a change");
      }
    }
    return performance.now() - started;
  }

  async stop() {
    await this.request("shutdown", null);
    await this.notify("exit", null);
    await this.#writer.close().catch(() => {});
    const status = await this.#process.status;
    return status.code;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

function find(bytes: Uint8Array, text: string): number {
  const needle = encoder.encode(text);
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Opening the workspace and asking every question

async function sigilFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory) found.push(...await sigilFiles(path));
    else if (entry.isFile && entry.name.endsWith(".sigil")) found.push(path);
  }
  return found.sort();
}

interface Run {
  /** What each question answered, by "<file> <question>". */
  answers: Map<string, Json>;
  /** Token start positions by file, taken from this server's own tokens. */
  tokens: Map<string, Position[]>;
  reloadMs: number[];
}

async function run(
  name: string,
  client: Client,
  root: string,
  files: string[],
  options: { timingOnly: boolean; positions?: Map<string, Position[]> },
): Promise<Run> {
  const answers = new Map<string, Json>();
  const tokens = new Map<string, Position[]>();
  const rootUri = pathToFileURL(root).href;
  const initialize = await client.request("initialize", {
    processId: null,
    rootUri,
    capabilities: {
      workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
    },
  });
  answers.set(
    "initialize capabilities",
    (initialize.result as Message)?.capabilities,
  );
  await client.notify("initialized", {});

  const texts = new Map<string, string>();
  for (const file of files) {
    const text = (await Deno.readTextFile(file)).replace(/^﻿/, "");
    texts.set(file, text);
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: pathToFileURL(file).href,
        languageId: "sigil",
        version: 1,
        text,
      },
    });
  }
  // Requests are answered in order, so once this one answers every open has
  // been applied and published.
  await client.request("textDocument/documentSymbol", {
    textDocument: { uri: pathToFileURL(files[0]).href },
  });

  if (!options.timingOnly) {
    for (const file of files) {
      const label = relative(root, file);
      const textDocument = { uri: pathToFileURL(file).href };
      const ask = async (question: string, method: string, params: Message) => {
        const answer = await client.request(method, {
          textDocument,
          ...params,
        });
        answers.set(`${label} ${question}`, answer.error ?? answer.result);
        return answer.result;
      };
      await ask("documentSymbol", "textDocument/documentSymbol", {});
      const full = await ask(
        "semanticTokens",
        "textDocument/semanticTokens/full",
        {},
      ) as
        | { data: number[] }
        | undefined;
      const starts = options.positions?.get(label) ??
        tokenStarts(full?.data ?? []);
      tokens.set(label, starts);
      for (let i = 0; i < starts.length; i += 50) {
        await Promise.all(
          starts.slice(i, i + 50).flatMap((position) => {
            const at = `${position.line}:${position.character}`;
            return [
              ask(`definition ${at}`, "textDocument/definition", { position }),
              ask(`hover ${at}`, "textDocument/hover", { position }),
            ];
          }),
        );
      }
    }
    // Every file the server published for, not only the opened ones: a config
    // or glossary file has diagnostics too. A file with none counts the same
    // as a file never published.
    for (const [uri, diagnostics] of client.diagnostics) {
      if (!diagnostics.length) continue;
      const label = uri.startsWith("file:")
        ? relative(root, fileURLToPath(uri))
        : uri;
      answers.set(`${label} diagnostics`, diagnosticsView(diagnostics, root));
    }
  }

  // Reload time: change one provider file to its own text and time the wait
  // for the first publication. A server may publish for many files, so a
  // request after the change answers only once all of them are out; its time
  // is the whole reload.
  const changed = files.find((file) => file.endsWith("core.sigil")) ?? files[0];
  const reloadMs: number[] = [], settledMs: number[] = [];
  for (let version = 2; version < 2 + RELOADS; version++) {
    const started = performance.now();
    const published = client.nextPublish();
    await client.notify("textDocument/didChange", {
      textDocument: { uri: pathToFileURL(changed).href, version },
      contentChanges: [{ text: texts.get(changed)! }],
    });
    reloadMs.push(await published);
    await client.request("textDocument/documentSymbol", {
      textDocument: { uri: pathToFileURL(changed).href },
    });
    settledMs.push(performance.now() - started);
  }
  const show = (times: number[]) =>
    `median ${median(times).toFixed(1)} ms (${
      times.map((ms) => ms.toFixed(1)).join(", ")
    })`;
  console.log(`${name}: didChange to first publication ${show(reloadMs)}`);
  console.log(`${name}: didChange to reload answered   ${show(settledMs)}`);
  return { answers, tokens, reloadMs };
}

function tokenStarts(data: number[]): Position[] {
  const starts: Position[] = [];
  let line = 0, character = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    line += data[i];
    character = data[i] ? data[i + 1] : character + data[i + 1];
    starts.push({ line, character });
  }
  return starts;
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// ---------------------------------------------------------------------------
// Normalizing and comparing

function diagnosticsView(diagnostics: unknown[], root: string): unknown[] {
  return diagnostics.map((item) => {
    const diagnostic = item as Message;
    let message = String(diagnostic.message);
    const json = message.indexOf(" JSON:");
    if (json >= 0) message = message.slice(0, json + " JSON:".length);
    message = message.replace(`Source ${root}/`, "Source ");
    return { ...diagnostic, message };
  });
}

/** Drops the TS server's ownership blocks from a hover answer. */
function withoutOwnership(answers: Map<string, Json>): Map<string, Json> {
  const view = new Map(answers);
  for (const [key, value] of view) {
    const contents = (value as { contents?: { value?: string } } | null)
      ?.contents;
    if (!key.includes(" hover ") || typeof contents?.value !== "string") {
      continue;
    }
    view.set(key, {
      ...(value as Message),
      contents: {
        ...contents,
        value: contents.value.replace(
          /\n\n\*\*Owned implementations\*\*(?:\n- .*)+/g,
          "",
        ),
      },
    });
  }
  return view;
}

/** JSON with sorted keys, so key order never counts as a difference. */
function canonical(value: Json): string {
  return JSON.stringify(
    value,
    (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a < b ? -1 : 1),
        )
        : item,
  ) ?? "undefined";
}

/** The first difference of two texts, with a little context on each side. */
function around(a: string, b: string): string {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  const window = (text: string) => text.slice(Math.max(0, at - 30), at + 60);
  return `TS ...${window(a)}...\n      Rust ...${window(b)}...`;
}

function compare(ts: Run, rust: Run): number {
  const view = new Map(withoutOwnership(ts.answers));
  const differences: string[] = [];
  let compared = 0;
  for (const key of new Set([...view.keys(), ...rust.answers.keys()])) {
    compared++;
    const left = canonical(view.get(key)),
      right = canonical(rust.answers.get(key));
    if (left !== right) {
      differences.push(`${key}\n      ${around(left, right)}`);
    }
  }
  const kinds = new Map<string, number>();
  for (const [key, value] of rust.answers) {
    const kind = key.split(" ")[1];
    const empty = value == null || (Array.isArray(value) && !value.length);
    kinds.set(kind, (kinds.get(kind) ?? 0) + (empty ? 0 : 1));
  }
  console.log(
    `compared ${compared} answers over ${ts.tokens.size} files; non-empty: ${
      [...kinds].map(([kind, count]) => `${kind} ${count}`).join(", ")
    }`,
  );
  for (const text of differences.slice(0, SHOWN_DIFFERENCES)) {
    console.log(`DIFF ${text}`);
  }
  if (differences.length > SHOWN_DIFFERENCES) {
    console.log(`... and ${differences.length - SHOWN_DIFFERENCES} more`);
  }
  console.log(
    differences.length ? `${differences.length} differences` : "no differences",
  );
  return differences.length;
}

// ---------------------------------------------------------------------------

const args = [...Deno.args];
const timingOnly = args.includes("--timing-only");
const rootIndex = args.indexOf("--root");
const rootArg = rootIndex >= 0 ? args[rootIndex + 1] : repoRoot;
const binary = args.find((arg, index) =>
  !arg.startsWith("--") && args[index - 1] !== "--root"
);
if (!binary) {
  console.error(
    "usage: compare-lsp.ts <sigil binary> [--root <dir>] [--timing-only]",
  );
  Deno.exit(2);
}
try {
  await Deno.stat(binary);
} catch {
  console.error(`the sigil binary does not exist: ${binary}`);
  Deno.exit(2);
}
const root = await Deno.realPath(rootArg);
const files = await sigilFiles(root);
if (!files.length) {
  console.error(`no .sigil files under ${root}`);
  Deno.exit(2);
}
console.log(`${files.length} .sigil files under ${root}`);

const entry = new URL("./lsp-editor-entry.ts", import.meta.url).pathname;
const ts = new Client("deno", ["run", "-A", entry], root);
const tsRun = await run("TS  ", ts, root, files, { timingOnly });
const tsCode = await ts.stop();
const rust = new Client(await Deno.realPath(binary), ["lsp"], root);
const rustRun = await run("Rust", rust, root, files, {
  timingOnly,
  positions: tsRun.tokens,
});
const rustCode = await rust.stop();
for (
  const [name, code, stderr] of [["TS", tsCode, ts.stderr], [
    "Rust",
    rustCode,
    rust.stderr,
  ]] as const
) {
  if (code !== 0 || stderr) {
    console.log(
      `${name} server exited ${code}${
        stderr ? `, stderr: ${stderr.trim()}` : ""
      }`,
    );
  }
}
Deno.exit(timingOnly ? 0 : compare(tsRun, rustRun) ? 1 : 0);
