/**
 * Writes `packages/lsp/tests/fixtures/lsp-parity.json`, the recorded behavior
 * of the TS language server that the Rust server's tests replay.
 *
 * A scenario is a small workspace written to a fresh temp directory plus an
 * ordered list of steps. The script runs the TS server
 * (`packages/lsp/src/server.ts`, class `SigilLanguageServer`) in-process with
 * the real file system (`DenoSigilFileSystem`) and the real temp directory as
 * its current directory, so discovery reads the disk as the Rust server will.
 * The server is built with the same `protocolSource` hook the VS Code
 * extension passes, `(source) => new EditorProtocolSource(source)`, which only
 * changes a disk file that starts with a byte-order mark. A step is one of:
 *
 * - `send`: hand `message` to `SigilLanguageServer.handle` and record the
 *   messages it returns as `output` (an empty array for most notifications).
 *   A step that sends `exit` also records `exitCode` (the server's exit
 *   status, 0 after shutdown and 1 without it).
 * - `write`: write `text` to the workspace file `path` on disk.
 * - `delete`: remove the workspace file `path` from disk.
 *
 * Every send step also records `outcome`, a list of `result` (a non-empty
 * answer or a non-empty diagnostics notification), `empty` (a null, `[]`, `""`
 * or `{"data":[]}` answer, or an empty diagnostics notification) and `error`
 * (a failure response or a diagnostic of severity 1). A scenario's `feature`
 * tag is one of lifecycle, errors, diagnostics, definition, symbols, tokens,
 * hover, render, watch, glossary or bom, and the script refuses to write a
 * fixture in which a feature lacks an outcome it must show.
 *
 * Substitution rule: the temp directory (resolved with `realPath`, because
 * macOS `/var` is a link to `/private/var`) is spelled `<ROOT>` everywhere.
 * `<ROOT>` is the directory path itself, so `file://<ROOT>/contract.sigil` is
 * the URI of a workspace file and `<ROOT>/contract.sigil` its path. A replay
 * substitutes `<ROOT>` with its own temp directory in `files` keys (those are
 * relative), in every `message` (both as a path and inside `file://` URIs) and
 * compares `output` after the same substitution. The percent-encoded form of
 * the directory inside a URI and the raw form are both recorded as `<ROOT>`.
 * Ids, positions and versions are literal. Positions are UTF-16 line and
 * character values computed from the scenario's own text (CR, CRLF and LF all
 * end a line); for a file on disk that starts with a byte-order mark they are
 * the editor-visible ones, which skip the mark on line 0.
 *
 * Left out on purpose: cancellation through `server.cancel` (it is not a
 * message; `$/cancelRequest` is recorded), anything that needs a delayed or
 * failing read, a lone surrogate in a document (JSON cannot carry it), and the
 * ownership features, which the Rust server drops. No scenario contains an
 * implementation source, so hover never lists owned implementations. The TS
 * server still sends its ownership watch registration; it is recorded as sent.
 *
 * Run it after a change to the TS server or to this scenario list
 * (`deno task generate:lsp-fixtures`) and commit the result. A stale fixture is
 * a silent drift risk, so the Rust replay never needs Deno.
 */

import { SIGIL_VERSION } from "@qoherent/sigil-core";
import { EditorProtocolSource } from "../integrations/editor/vscode/src/coordinates.ts";
import {
  DenoSigilFileSystem,
  pathToFileUri,
} from "../packages/lsp/src/filesystem.ts";
import { SigilLanguageServer } from "../packages/lsp/src/server.ts";

const root = new URL("..", import.meta.url).pathname;
const OUTPUT = `${root}packages/lsp/tests/fixtures/lsp-parity.json`;
const PLACEHOLDER = "<ROOT>";

type Json = unknown;
type Message = Record<string, Json>;
type Files = Record<string, string>;
type Outcome = "result" | "empty" | "error";

type Step =
  | { kind: "send"; message: Message }
  | { kind: "write"; path: string; text: string }
  | { kind: "delete"; path: string };

type RecordedStep =
  | {
    kind: "send";
    message: Message;
    output: Message[];
    outcome: Outcome[];
    exitCode?: number | null;
  }
  | { kind: "write"; path: string; text: string }
  | { kind: "delete"; path: string };

const FEATURES = [
  "lifecycle",
  "errors",
  "diagnostics",
  "definition",
  "symbols",
  "tokens",
  "hover",
  "render",
  "watch",
  "glossary",
  "bom",
] as const;
type Feature = typeof FEATURES[number];

interface Scenario {
  name: string;
  feature: Feature;
  /** Files of the temp workspace, by path relative to `<ROOT>`. */
  files: Files;
  steps: Step[];
}

// ---------------------------------------------------------------------------
// Helpers for writing scenarios

const R = PLACEHOLDER;
const uri = (path: string) => `file://${R}/${path}`;
const rootUri = `file://${R}`;
const doc = (path: string) => ({ uri: uri(path) });

interface Position {
  line: number;
  character: number;
}

/** UTF-16 position of `offset` in `text`; CR, CRLF and LF end a line. */
function positionAt(text: string, offset: number): Position {
  const lines = text.slice(0, offset).split(/\r\n|\r|\n/);
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}

/**
 * Position of `needle` inside the first occurrence of `context` in `text`,
 * moved `shift` UTF-16 units to the right. A leading byte-order mark is not
 * counted, because the editor does not see it.
 */
function at(
  text: string,
  context: string,
  needle = context,
  shift = 0,
): Position {
  const visible = text.replace(/^﻿/, "");
  const start = visible.indexOf(context);
  if (start < 0) throw new Error(`context not found: ${context}`);
  const inner = context.indexOf(needle);
  if (inner < 0) throw new Error(`needle not found: ${needle}`);
  const position = positionAt(visible, start + inner);
  return { line: position.line, character: position.character + shift };
}

const config = (name: string) =>
  JSON.stringify({
    sigilVersion: SIGIL_VERSION,
    workspace: { name, members: [] },
    files: { include: ["**/*.sigil"], exclude: [] },
    tools: {},
  });

const minimalConfig = (name: string) =>
  JSON.stringify({
    sigilVersion: SIGIL_VERSION,
    workspace: { name },
    files: { include: ["**/*.sigil"] },
  });

class Builder {
  readonly steps: Step[] = [];
  #id = 0;
  constructor(
    readonly name: string,
    readonly feature: Feature,
    readonly files: Files,
  ) {}

  /** Send a request with the next id. */
  req(method: string, params?: Json): this {
    return this.reqId(++this.#id, method, params);
  }
  reqId(id: number | string, method: string, params?: Json): this {
    if (typeof id === "number") this.#id = Math.max(this.#id, id);
    const message: Message = { jsonrpc: "2.0", id, method };
    if (params !== undefined) message.params = params;
    this.steps.push({ kind: "send", message });
    return this;
  }
  note(method: string, params?: Json): this {
    const message: Message = { jsonrpc: "2.0", method };
    if (params !== undefined) message.params = params;
    this.steps.push({ kind: "send", message });
    return this;
  }
  resp(id: number | string, result: Json): this {
    this.steps.push({
      kind: "send",
      message: { jsonrpc: "2.0", id, result },
    });
    return this;
  }
  write(path: string, text: string): this {
    this.steps.push({ kind: "write", path, text });
    return this;
  }
  delete(path: string): this {
    this.steps.push({ kind: "delete", path });
    return this;
  }

  /** `initialize` followed by `initialized`. */
  start(params: Json = { rootUri }): this {
    return this.req("initialize", params).note("initialized");
  }
  shutdown(): this {
    return this.req("shutdown").note("exit");
  }

  open(path: string, text: string, version = 1): this {
    return this.note("textDocument/didOpen", {
      textDocument: { uri: uri(path), version, text },
    });
  }
  change(path: string, text: string, version: number): this {
    return this.note("textDocument/didChange", {
      textDocument: { uri: uri(path), version },
      contentChanges: [{ text }],
    });
  }
  close(path: string): this {
    return this.note("textDocument/didClose", {
      textDocument: { uri: uri(path) },
    });
  }
  watch(...changes: [string, 1 | 2 | 3][]): this {
    return this.note("workspace/didChangeWatchedFiles", {
      changes: changes.map(([path, type]) => ({ uri: uri(path), type })),
    });
  }
  lookup(
    method: "definition" | "hover",
    path: string,
    position: Position,
  ): this {
    return this.req(`textDocument/${method}`, {
      textDocument: doc(path),
      position,
    });
  }
  definition(path: string, position: Position): this {
    return this.lookup("definition", path, position);
  }
  hover(path: string, position: Position): this {
    return this.lookup("hover", path, position);
  }
  symbols(path: string): this {
    return this.req("textDocument/documentSymbol", { textDocument: doc(path) });
  }
  tokens(path: string): this {
    return this.req("textDocument/semanticTokens/full", {
      textDocument: doc(path),
    });
  }
  render(path: string): this {
    return this.req("workspace/executeCommand", {
      command: "sigil.renderDocument",
      arguments: [uri(path)],
    });
  }

  done(): Scenario {
    return {
      name: this.name,
      feature: this.feature,
      files: this.files,
      steps: this.steps,
    };
  }
}

// ---------------------------------------------------------------------------
// Sources

const contractSource = `component Thing {
  goal {
    Represent one useful Execution.
  }

  cases {
    Execution {
      Running succeeds. Each Execution ends.
    }
  }

  interface {
    Execution {
      run() starts an Execution.
    }
  }
}
`;

const consumerSource = `@contract.sigil from Thing import { Execution }

component Consumer {
  goal {
    Consume the provider contract for Execution.
  }

  constraints {
    Consumer retries preserve Execution.
  }

  interface {
    ConsumerSurface {
      run() uses Execution.

      execution and ExecutionCache remain prose
      beside Execution.
    }
  }
}
`;

const basicFiles = (): Files => ({
  ".sigil/config.json": config("lsp-test"),
  "contract.sigil": contractSource,
  "consumer.sigil": consumerSource,
});

const tagName = "café results";
/** Provider with CRLF line ends, an emoji before a Tag and a multiword Tag. */
const providerCrlf =
  "component Provider {\r\ngoal {\r\nOwn vocabulary.\r\n}\r\ninterface {\r\n😀 A *café results* carries a response.\r\n}\r\nconstraints {\r\ncafé results {\r\nPreserve exact content.\r\n}\r\n}\r\n}\r\n";
const providerBom = "﻿" + providerCrlf;
/** The same provider with a local group heading and CR-only line ends. */
const providerCr = providerCrlf.replace(
  "😀 A *café results* carries a response.",
  "café results {\r\nOffer a response.\r\n}",
).replaceAll("\r\n", "\r");
const multiwordConsumer =
  "@provider.sigil from Provider import { café results }\ncomponent Consumer {\ngoal {\nServe the caller.\n}\ninterface {\n😀 Use café results now.\n\nRead [café results](./notes.md).\n```text\ncafé results\n```\n}\n}\n";

const multiwordFiles = (provider: string): Files => ({
  ".sigil/config.json": minimalConfig("lsp-090"),
  "provider.sigil": provider,
  "consumer.sigil": multiwordConsumer,
});

const glossaryJson = (terms: unknown[], extra: Json = {}) =>
  JSON.stringify(
    { schemaVersion: 1, terms, contexts: [], ...(extra as object) },
    null,
    2,
  );

// ---------------------------------------------------------------------------
// Scenarios

const scenarios: Scenario[] = [];
const add = (builder: Builder) => scenarios.push(builder.done());

// lifecycle ------------------------------------------------------------------

{
  const s = new Builder(
    "lifecycle-gates-and-shutdown",
    "lifecycle",
    basicFiles(),
  );
  s.req("shutdown"); // before initialize: -32002
  s.hover("contract.sigil", { line: 0, character: 11 }); // -32002
  s.open("contract.sigil", contractSource); // ignored before initialize
  s.note("initialized"); // ignored before initialize
  s.req("initialize", { rootUri, capabilities: {} });
  s.req("initialize", { rootUri }); // second initialize: -32602
  s.note("initialized");
  s.req("shutdown");
  s.symbols("contract.sigil"); // after shutdown: -32600
  s.req("shutdown"); // -32600
  s.open("contract.sigil", contractSource); // ignored after shutdown
  s.note("exit"); // exit status 0
  s.hover("contract.sigil", { line: 0, character: 11 }); // after exit: -32600
  add(s);
}
{
  const s = new Builder("lifecycle-capabilities", "lifecycle", basicFiles());
  s.req("initialize", {
    rootUri,
    capabilities: { general: { positionEncodings: ["utf-16"] } },
  });
  s.note("initialized");
  s.req("shutdown");
  s.note("exit");
  add(s);
}
{
  const s = new Builder(
    "lifecycle-exit-without-shutdown",
    "lifecycle",
    basicFiles(),
  );
  s.start();
  s.note("exit"); // exit status 1
  add(s);
}
{
  const s = new Builder(
    "lifecycle-exit-before-initialize",
    "lifecycle",
    basicFiles(),
  );
  s.note("exit"); // exit status 1
  s.req("initialize", { rootUri }); // after exit: -32600
  add(s);
}
{
  const s = new Builder(
    "lifecycle-initialize-bad-params",
    "lifecycle",
    basicFiles(),
  );
  s.req("initialize", { rootUri: 5 });
  s.req("initialize", { rootUri, workspaceFolders: "x" });
  s.req("initialize", { rootUri, workspaceFolders: [{ name: "no uri" }] });
  s.req("initialize", {
    rootUri,
    capabilities: {
      workspace: { didChangeWatchedFiles: { dynamicRegistration: "yes" } },
    },
  });
  s.req("initialize", { rootUri, capabilities: 7 });
  s.req("initialize", 3);
  s.symbols("contract.sigil"); // still not initialized: -32002
  s.start(); // a failed initialize leaves the server uninitialized
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}
{
  // No params at all: the server starts at its current directory.
  const s = new Builder(
    "lifecycle-initialize-without-params",
    "lifecycle",
    basicFiles(),
  );
  s.req("initialize");
  s.note("initialized");
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}
{
  // The start folder comes from workspaceFolders before rootUri, and the
  // workspace is found by walking up from it.
  const s = new Builder("lifecycle-workspace-folder-start", "lifecycle", {
    ".sigil/config.json": config("lsp-folder"),
    "contract.sigil": contractSource,
    "pkg/inner.sigil": consumerSource,
  });
  s.req("initialize", {
    rootUri: "file://<ROOT>/elsewhere",
    workspaceFolders: [{ uri: uri("pkg"), name: "pkg" }],
  });
  s.note("initialized");
  s.symbols("pkg/inner.sigil");
  s.symbols("contract.sigil");
  s.req("initialize", { rootUri: null, workspaceFolders: null });
  s.shutdown();
  add(s);
}
{
  const s = new Builder("lifecycle-null-root-uri", "lifecycle", basicFiles());
  s.req("initialize", { rootUri: null });
  s.note("initialized");
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}

// errors ---------------------------------------------------------------------

{
  const s = new Builder("errors-bad-requests", "errors", basicFiles());
  s.start();
  s.req("textDocument/hover", {}); // -32602
  s.req("textDocument/hover"); // no params: -32602
  s.req("textDocument/hover", {
    textDocument: doc("contract.sigil"),
    position: { line: -1, character: 0 },
  });
  s.req("textDocument/hover", {
    textDocument: doc("contract.sigil"),
    position: { line: 0, character: 1.5 },
  });
  s.req("textDocument/hover", {
    textDocument: doc("contract.sigil"),
    position: "start",
  });
  s.req("textDocument/definition", {
    textDocument: { uri: 5 },
    position: { line: 0, character: 0 },
  });
  s.req("textDocument/definition", {
    textDocument: { uri: "http://example.com/contract.sigil" },
    position: { line: 0, character: 0 },
  }); // -32603: only file URIs
  s.req("textDocument/documentSymbol", {});
  s.req("textDocument/documentSymbol", { textDocument: 3 });
  s.req("textDocument/semanticTokens/full", {});
  s.req("unknown/method"); // -32601
  s.req("textDocument/references", { textDocument: doc("contract.sigil") });
  s.reqId("abc", "unknown/method"); // string ids are echoed
  s.reqId("abc-2", "textDocument/documentSymbol", {
    textDocument: doc("contract.sigil"),
  });
  s.note("unknown/notification", { a: 1 }); // ignored
  s.note("$/setTrace", { value: "off" }); // ignored
  s.resp(99, null); // a response from the client: nothing to send
  s.resp("sigil/unknown", null);
  s.shutdown();
  add(s);
}
{
  // Notifications with bad parameters are ignored without a reply.
  const s = new Builder(
    "errors-bad-notification-params",
    "errors",
    basicFiles(),
  );
  s.start();
  s.note("textDocument/didOpen", {});
  s.note("textDocument/didOpen", {
    textDocument: { uri: uri("contract.sigil"), version: "1", text: "" },
  });
  s.note("textDocument/didChange", {
    textDocument: { uri: uri("contract.sigil"), version: 2 },
    contentChanges: "none",
  });
  s.note("textDocument/didClose", {});
  s.note("workspace/didChangeWatchedFiles", { changes: [{ uri: 5, type: 1 }] });
  s.note("workspace/didChangeWatchedFiles", {
    changes: [{ uri: uri("contract.sigil"), type: 9 }],
  });
  s.note("workspace/didChangeWatchedFiles", {});
  s.note("textDocument/didOpen", {
    textDocument: { uri: "http://example.com/x.sigil", version: 1, text: "" },
  });
  s.symbols("contract.sigil"); // the server still answers
  s.shutdown();
  add(s);
}
{
  // `$/cancelRequest` makes the next request with that id answer -32800 once.
  const s = new Builder(
    "errors-cancel-request-notification",
    "errors",
    basicFiles(),
  );
  s.start();
  s.note("$/cancelRequest", { id: 7 });
  s.reqId(7, "textDocument/documentSymbol", {
    textDocument: doc("contract.sigil"),
  });
  s.reqId(7, "textDocument/documentSymbol", {
    textDocument: doc("contract.sigil"),
  });
  s.note("$/cancelRequest", { id: "seven" });
  s.reqId("seven", "textDocument/documentSymbol", {
    textDocument: doc("contract.sigil"),
  });
  s.note("$/cancelRequest", { id: true }); // not an id: ignored
  s.note("$/cancelRequest"); // ignored
  s.note("$/cancelRequest", { id: 8 });
  s.reqId(8, "unknown/method"); // cancellation is checked before the method
  s.note("$/cancelRequest", { id: 9 });
  s.reqId(9, "shutdown");
  s.shutdown();
  add(s);
}

// watch ----------------------------------------------------------------------

{
  const s = new Builder("watch-dynamic-registration", "watch", basicFiles());
  s.req("initialize", {
    rootUri,
    capabilities: {
      workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
    },
  });
  s.note("initialized"); // sends client/registerCapability
  s.resp("sigil/ownership-watch/request", null); // accepted and ignored
  s.note("initialized"); // not registered twice
  s.resp("sigil/other", { ok: true });
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}
{
  const s = new Builder(
    "watch-registration-not-supported",
    "watch",
    basicFiles(),
  );
  s.req("initialize", { rootUri });
  s.note("initialized");
  s.shutdown();
  add(s);
}
{
  const s = new Builder("watch-registration-declined", "watch", basicFiles());
  s.req("initialize", {
    rootUri,
    capabilities: {
      workspace: { didChangeWatchedFiles: { dynamicRegistration: false } },
    },
  });
  s.note("initialized");
  s.shutdown();
  add(s);
}
{
  // A provider edited on disk is picked up when the watcher reports it.
  const edited = contractSource.replaceAll("Execution", "Session");
  const s = new Builder("watch-provider-change-reloads", "watch", basicFiles());
  s.start();
  s.open("consumer.sigil", consumerSource);
  s.definition(
    "consumer.sigil",
    at(consumerSource, "import { Execution }", "Execution"),
  );
  s.write("contract.sigil", edited); // not seen until the watcher fires
  s.definition(
    "consumer.sigil",
    at(consumerSource, "import { Execution }", "Execution"),
  );
  s.watch(["contract.sigil", 2]);
  s.definition(
    "consumer.sigil",
    at(consumerSource, "import { Execution }", "Execution"),
  );
  s.symbols("contract.sigil");
  s.write("contract.sigil", contractSource);
  s.watch(["contract.sigil", 2]);
  s.definition(
    "consumer.sigil",
    at(consumerSource, "import { Execution }", "Execution"),
  );
  s.shutdown();
  add(s);
}
{
  // Created and deleted `.sigil` files reload the workspace.
  const s = new Builder(
    "watch-created-and-deleted-files",
    "watch",
    basicFiles(),
  );
  s.start();
  s.open("consumer.sigil", consumerSource);
  s.delete("contract.sigil");
  s.watch(["contract.sigil", 3]);
  s.write("contract.sigil", contractSource);
  s.watch(["contract.sigil", 1]);
  s.write("extra.sigil", consumerSource);
  s.watch(["extra.sigil", 1]);
  s.symbols("extra.sigil");
  s.delete("extra.sigil");
  s.watch(["extra.sigil", 3]);
  s.symbols("extra.sigil");
  s.shutdown();
  add(s);
}
{
  // Only `.sigil` files and the three `.sigil/*.json` files reload. A broken
  // provider is written to disk and reported through each path in turn; a path
  // that does not reload leaves the earlier reading in place.
  const broken = "component Thing {\n  mystery {\n  }\n}\n";
  const s = new Builder("watch-reload-triggers", "watch", basicFiles());
  s.start();
  const ignored = [
    "notes.md",
    "src/a.ts",
    "src/b.rs",
    "README.md",
    "sub/.sigil/other.json",
    ".sigil/config.json.bak",
    "notsigil/config.json",
    "contract.sigil.md",
  ];
  for (const path of ignored) {
    s.write("contract.sigil", broken);
    s.watch([path, 2]);
    s.write("contract.sigil", contractSource);
  }
  const reloading = [
    ".sigil/local.json",
    ".sigil/glossary.json",
    ".sigil/config.json",
    "sub/.sigil/config.json",
    "other.sigil",
    "deep/dir/x.sigil",
    "contract.sigil",
  ];
  for (const path of reloading) {
    s.write("contract.sigil", broken);
    s.watch([path, 2]);
    s.write("contract.sigil", contractSource);
    s.watch([path, 2]);
  }
  s.write("contract.sigil", broken);
  s.watch(["notes.md", 2], ["src/a.ts", 2], ["README.md", 3]); // none reloads
  s.watch(["notes.md", 2], ["contract.sigil", 2]); // one reloads
  s.write("contract.sigil", contractSource);
  s.watch(["notes.md", 2], ["consumer.sigil", 2], ["contract.sigil", 2]);
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}
{
  // A watched `.sigil` file that an open buffer shadows keeps the buffer.
  const s = new Builder("watch-open-buffer-wins", "watch", basicFiles());
  s.start();
  s.open("contract.sigil", "component Thing {\n  mystery {\n  }\n}\n");
  s.write("contract.sigil", contractSource);
  s.watch(["contract.sigil", 2]);
  s.symbols("contract.sigil");
  s.close("contract.sigil");
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}
{
  // The `.sigil/config.json` file is repaired on disk and reported.
  const s = new Builder("watch-config-repaired", "watch", {
    ".sigil/config.json": "{",
    "contract.sigil": contractSource,
    "consumer.sigil": consumerSource,
  });
  s.start();
  s.write(".sigil/config.json", config("repaired"));
  s.watch([".sigil/config.json", 2]);
  s.symbols("contract.sigil");
  s.write(".sigil/config.json", "{");
  s.watch([".sigil/config.json", 2]);
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}

// diagnostics ----------------------------------------------------------------

{
  const malformed = "component Thing {\n  mystery {\n    broken\n  }\n}\n";
  const s = new Builder(
    "diagnostics-open-change-close",
    "diagnostics",
    basicFiles(),
  );
  s.start();
  s.open("contract.sigil", malformed, 1);
  s.change("contract.sigil", contractSource, 2);
  s.change("contract.sigil", malformed, 2); // same version: ignored
  s.change("contract.sigil", malformed, 1); // older version: ignored
  s.change("consumer.sigil", consumerSource, 5); // never opened: ignored
  s.note("textDocument/didChange", {
    textDocument: { uri: uri("contract.sigil"), version: 9 },
    contentChanges: [],
  }); // no changes: ignored
  s.note("textDocument/didChange", {
    textDocument: { uri: uri("contract.sigil"), version: 10 },
    contentChanges: [{ text: "ignored" }, { text: malformed }],
  }); // the last full text wins
  s.close("contract.sigil");
  s.close("contract.sigil"); // closed twice
  s.close("consumer.sigil"); // never opened
  s.shutdown();
  add(s);
}
{
  // A document that is not on disk gets diagnostics and then a clearing
  // notification when it closes.
  const s = new Builder(
    "diagnostics-unsaved-document",
    "diagnostics",
    basicFiles(),
  );
  s.start();
  s.open("draft.sigil", "component Draft {\n}\n");
  s.change(
    "draft.sigil",
    "component Draft {\n  goal {\n    Draft it.\n  }\n}\n",
    2,
  );
  s.close("draft.sigil");
  s.symbols("draft.sigil");
  s.shutdown();
  add(s);
}
{
  const source = `component Feature {
  goal {
    Explain the feature.
  }

  state {
    Track the feature.
  }

  logic {
    Compute the feature.
  }

  constraints {
    Bound the feature.
  }

  cases {
    Handle the feature.
  }

  interface {
    Expose the feature.
  }

  decisions {
    Prefer the feature.
  }
}
`;
  const s = new Builder(
    "diagnostics-untagged-facet-exemptions",
    "diagnostics",
    {
      ".sigil/config.json": config("lsp-untagged-facets"),
      "contract.sigil": source,
    },
  );
  s.start();
  s.open("contract.sigil", source);
  s.shutdown();
  add(s);
}
{
  const consumer = (name: string) =>
    `@glossary.sigil from SigilGlossaryEngine import { GlossaryInspection }

component ${name} {
  goal {
    Present glossary inspection.
  }

  interface {
    GlossaryInspection {
      A local facade for SigilGlossaryEngine GlossaryInspection.
    }
  }
}
`;
  const moduleSource = consumer("SigilCore");
  const s = new Builder(
    "diagnostics-tag-collision-across-files",
    "diagnostics",
    {
      ".sigil/config.json": config("lsp-concept-ambiguity"),
      "glossary.sigil": `component SigilGlossaryEngine {
  goal {
    Inspect glossary data.
  }

  interface {
    GlossaryInspection {
      Inspect reviewed glossary terms.
    }
  }
}
`,
      "_module.sigil": moduleSource,
      "workspace.sigil": consumer("SigilWorkspace"),
    },
  );
  s.start();
  s.open("_module.sigil", moduleSource);
  s.symbols("workspace.sigil");
  s.hover(
    "workspace.sigil",
    at(
      consumer("SigilWorkspace"),
      "GlossaryInspection {",
      "GlossaryInspection",
    ),
  );
  s.close("_module.sigil");
  s.shutdown();
  add(s);
}
{
  // The same Tag name defined in two components is not a collision.
  const first = `component First {
  goal {
    Own the shared name.
  }

  interface {
    Shared {
      The first definition.
    }
  }
}
`;
  const second = first.replace("First", "Second").replace(
    "The first definition.",
    "The second definition.",
  );
  const s = new Builder(
    "diagnostics-same-tag-in-two-components",
    "diagnostics",
    {
      ".sigil/config.json": config("lsp-collision"),
      "first.sigil": first,
      "second.sigil": second,
    },
  );
  s.start();
  s.open("second.sigil", second);
  s.definition("second.sigil", at(second, "Shared {", "Shared"));
  s.hover("second.sigil", at(second, "Shared {", "Shared"));
  s.change("second.sigil", second.replace("Shared", "Unique"), 2);
  s.close("second.sigil");
  s.shutdown();
  add(s);
}
{
  // A local group that collides with an imported Tag, with related locations.
  const text = multiwordConsumer.replace(
    "interface {",
    "interface {\ncafé results {\nA local collision.\n}\n",
  );
  const s = new Builder(
    "diagnostics-related-locations-and-collision",
    "diagnostics",
    multiwordFiles(providerCrlf),
  );
  s.start();
  s.open("consumer.sigil", text);
  s.change(
    "consumer.sigil",
    multiwordConsumer.replace(
      "Provider import { café results }",
      "Provider import { missing results }",
    ),
    2,
  );
  s.change("consumer.sigil", multiwordConsumer, 3);
  s.shutdown();
  add(s);
}
{
  const s = new Builder(
    "diagnostics-unresolved-import-and-lowercase-tag",
    "diagnostics",
    {
      ".sigil/config.json": config("lsp-unresolved"),
      "only.sigil": `@missing.sigil from Nowhere import { Ghost }

component Only {
  goal {
    Consume Ghost.
  }

  interface {
    Ghost {
      A local declaration of Ghost.
    }
  }
}
`,
    },
  );
  s.start();
  s.open(
    "only.sigil",
    `@missing.sigil from Nowhere import { Ghost }

component Only {
  goal {
    Consume Ghost.
  }

  interface {
    run()
  }
}
`,
  );
  s.shutdown();
  add(s);
}
{
  const source = contractSource.replaceAll("Execution", "session-lifecycle");
  const s = new Builder(
    "diagnostics-exact-tag-spelling-is-clean",
    "diagnostics",
    {
      ".sigil/config.json": config("lsp-style-test"),
      "contract.sigil": source,
    },
  );
  s.start();
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}
{
  // An invalid character in an editor buffer is a diagnostic, not a crash.
  const s = new Builder(
    "diagnostics-invalid-character-in-buffer",
    "diagnostics",
    basicFiles(),
  );
  s.start();
  s.open("contract.sigil", "component Thing {\u0000}\n");
  s.change("contract.sigil", contractSource, 2);
  s.shutdown();
  add(s);
}
{
  const s = new Builder("diagnostics-config-parse-failure", "diagnostics", {
    ".sigil/config.json": "{",
    "contract.sigil": contractSource,
  });
  s.start();
  s.symbols("contract.sigil");
  s.definition(
    "contract.sigil",
    at(contractSource, "Execution {", "Execution"),
  );
  s.hover("contract.sigil", { line: 0, character: 11 });
  s.tokens("contract.sigil");
  s.render("contract.sigil");
  s.open("contract.sigil", contractSource);
  s.close("contract.sigil");
  s.shutdown();
  add(s);
}
{
  const s = new Builder("diagnostics-config-invalid-fields", "diagnostics", {
    ".sigil/config.json": JSON.stringify({ workspace: "no" }),
    "contract.sigil": contractSource,
  });
  s.start();
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}
{
  const s = new Builder("diagnostics-no-config-workspace", "diagnostics", {
    "contract.sigil": contractSource,
    "consumer.sigil": consumerSource,
  });
  s.start();
  s.symbols("contract.sigil");
  s.definition(
    "consumer.sigil",
    at(consumerSource, "import { Execution }", "Execution"),
  );
  s.hover(
    "consumer.sigil",
    at(consumerSource, "import { Execution }", "Execution"),
  );
  s.tokens("consumer.sigil");
  s.render("contract.sigil");
  s.open("contract.sigil", "component Thing {\n  mystery {\n  }\n}\n");
  s.close("contract.sigil");
  s.shutdown();
  add(s);
}
{
  const s = new Builder("diagnostics-empty-workspace", "diagnostics", {
    ".sigil/config.json": config("lsp-empty"),
  });
  s.start();
  s.symbols("contract.sigil");
  s.open("contract.sigil", contractSource);
  s.symbols("contract.sigil");
  s.close("contract.sigil");
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}
{
  // Diagnostics for CRLF and CR-only sources use UTF-16 columns.
  const crlf =
    "component Thing {\r\n  mystery {\r\n    😀 broken\r\n  }\r\n}\r\n";
  const cr = crlf.replaceAll("\r\n", "\r");
  const s = new Builder("diagnostics-crlf-and-cr-sources", "diagnostics", {
    ".sigil/config.json": config("lsp-eol"),
    "crlf.sigil": crlf,
    "cr.sigil": cr,
  });
  s.start();
  s.open("crlf.sigil", crlf);
  s.open("cr.sigil", cr);
  s.change("cr.sigil", cr.replace("component Thing", "component Other"), 2);
  s.close("crlf.sigil");
  s.close("cr.sigil");
  s.shutdown();
  add(s);
}

// definition -----------------------------------------------------------------

{
  const s = new Builder(
    "definition-tags-provider-and-consumer",
    "definition",
    basicFiles(),
  );
  s.start();
  const importLine = "import { Execution }";
  s.definition(
    "consumer.sigil",
    at(consumerSource, "from Thing import", "Thing"),
  ); // component name in the import
  s.definition("consumer.sigil", at(consumerSource, importLine, "Execution"));
  s.definition(
    "consumer.sigil",
    at(consumerSource, importLine, "Execution", 9),
  ); // end of the name: no Tag
  s.definition(
    "consumer.sigil",
    at(
      consumerSource,
      "Consume the provider contract for Execution.",
      "Execution",
    ),
  );
  s.definition(
    "consumer.sigil",
    at(consumerSource, "Consumer retries preserve Execution.", "Execution"),
  );
  s.definition(
    "consumer.sigil",
    at(consumerSource, "run() uses Execution.", "Execution"),
  );
  s.definition(
    "consumer.sigil",
    at(consumerSource, "beside Execution.", "Execution"),
  );
  s.definition(
    "consumer.sigil",
    at(consumerSource, "Execution.", "Execution", 4),
  ); // inside the name
  s.definition(
    "consumer.sigil",
    at(consumerSource, "execution and ExecutionCache", "execution"),
  ); // lowercase prose
  s.definition(
    "consumer.sigil",
    at(consumerSource, "execution and ExecutionCache", "ExecutionCache"),
  ); // longer word
  s.definition(
    "consumer.sigil",
    at(consumerSource, "Consume the provider", "Consume the provider"),
  ); // prose
  s.definition(
    "consumer.sigil",
    at(consumerSource, "ConsumerSurface {", "ConsumerSurface"),
  ); // its own declaration
  s.definition(
    "contract.sigil",
    at(contractSource, "Execution {\n      Running", "Execution"),
  ); // a declaration
  s.definition(
    "contract.sigil",
    at(contractSource, "Each Execution ends", "Execution"),
  );
  s.definition("contract.sigil", { line: 99, character: 0 }); // past the end
  s.definition("contract.sigil", { line: 0, character: 400 }); // past the line
  s.definition("absent.sigil", { line: 0, character: 0 }); // unknown file
  s.definition("consumer.sigil", { line: -1, character: 0 }); // bad position
  s.shutdown();
  add(s);
}
{
  const indexedConsumer =
    "@module/contract.sigil from Thing import { Execution }\n\ncomponent Consumer {\n  goal {\n    Consume Execution.\n  }\n\n  interface {\n    run()\n  }\n}\n";
  const s = new Builder("definition-explicit-file-import", "definition", {
    ".sigil/config.json": config("lsp-index-test"),
    "module/_module.sigil": "",
    "module/contract.sigil": contractSource,
    "indexed-consumer.sigil": indexedConsumer,
  });
  s.start();
  s.definition("indexed-consumer.sigil", { line: 0, character: 28 });
  s.definition(
    "indexed-consumer.sigil",
    at(indexedConsumer, "import { Execution }", "Execution"),
  );
  s.definition(
    "indexed-consumer.sigil",
    at(indexedConsumer, "@module/contract.sigil", "module"),
  );
  s.definition(
    "indexed-consumer.sigil",
    at(indexedConsumer, "Consume Execution.", "Execution"),
  );
  s.hover("indexed-consumer.sigil", { line: 0, character: 28 });
  s.symbols("indexed-consumer.sigil");
  s.shutdown();
  add(s);
}
{
  // Multiword Tags, references and headings, in CRLF sources with an emoji
  // before the Tag.
  const s = new Builder(
    "definition-multiword-crlf-emoji",
    "definition",
    multiwordFiles(providerCrlf),
  );
  s.start();
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "import { café results }", "café results"),
  );
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "Use café results now.", "café results"),
  );
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "Use café results now.", "café results", 5),
  ); // inside the name
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "Use café results now.", "café results", 12),
  ); // end of the name
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "Read [café results](./notes.md)", "café results"),
  ); // link label
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "```text\ncafé results", "café results"),
  ); // payload
  s.definition(
    "provider.sigil",
    at(providerCrlf, "A *café results* carries", "café results"),
  );
  s.definition(
    "provider.sigil",
    at(providerCrlf, "café results {\r\nPreserve", "café results"),
  );
  s.definition("provider.sigil", at(providerCrlf, "😀 A", "A"));
  s.shutdown();
  add(s);
}
{
  const s = new Builder(
    "definition-earliest-group-heading-cr-source",
    "definition",
    multiwordFiles(providerCr),
  );
  s.start();
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "Use café results now.", "café results"),
  );
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "import { café results }", "café results"),
  );
  s.definition(
    "provider.sigil",
    at(providerCr, "café results {\rOffer", "café results"),
  );
  s.definition(
    "provider.sigil",
    at(providerCr, "café results {\rPreserve", "café results"),
  );
  s.hover(
    "consumer.sigil",
    at(multiwordConsumer, "Use café results now.", "café results"),
  );
  s.symbols("provider.sigil");
  s.tokens("provider.sigil");
  s.shutdown();
  add(s);
}
{
  // An overlay of the provider invalidates the consumer's reference, and a
  // close restores the disk text.
  const changed = providerCrlf.replaceAll(tagName, "changed results");
  const useCafe = at(
    multiwordConsumer,
    "Use café results now.",
    "café results",
  );
  const s = new Builder(
    "definition-provider-overlay-and-close",
    "definition",
    multiwordFiles(providerCrlf),
  );
  s.start();
  s.open("provider.sigil", changed, 1);
  s.definition("consumer.sigil", useCafe);
  s.change("provider.sigil", providerCrlf, 2);
  s.definition("consumer.sigil", useCafe);
  s.change(
    "provider.sigil",
    providerCrlf.replaceAll(tagName, "old results"),
    1,
  ); // older version: ignored
  s.definition("consumer.sigil", useCafe);
  s.close("provider.sigil");
  s.definition("consumer.sigil", useCafe);
  s.shutdown();
  add(s);
}
{
  // A name that no provider defines has no definition and no hover.
  const source = `component Lonely {
  goal {
    Mention Ghost without declaring it.
  }

  interface {
    Runner {
      run() uses Ghost.
    }
  }
}
`;
  const s = new Builder("definition-undefined-tag", "definition", {
    ".sigil/config.json": config("lsp-undefined"),
    "lonely.sigil": source,
  });
  s.start();
  s.definition("lonely.sigil", at(source, "Mention Ghost", "Ghost"));
  s.definition("lonely.sigil", at(source, "run() uses Ghost.", "Ghost"));
  s.hover("lonely.sigil", at(source, "Mention Ghost", "Ghost"));
  s.definition("lonely.sigil", at(source, "Runner {", "Runner"));
  s.hover("lonely.sigil", at(source, "Runner {", "Runner"));
  s.shutdown();
  add(s);
}

// symbols --------------------------------------------------------------------

{
  const s = new Builder("symbols-hierarchy", "symbols", basicFiles());
  s.start();
  s.symbols("contract.sigil");
  s.symbols("consumer.sigil");
  s.symbols("absent.sigil"); // unknown file: []
  s.req("textDocument/documentSymbol", {
    textDocument: { uri: "http://example.com/contract.sigil" },
  }); // -32603
  s.req("textDocument/documentSymbol", { textDocument: {} }); // -32602
  s.shutdown();
  add(s);
}
{
  const s = new Builder(
    "symbols-inline-introductions-crlf",
    "symbols",
    multiwordFiles(providerCrlf),
  );
  s.start();
  s.symbols("provider.sigil");
  s.symbols("consumer.sigil");
  s.open("provider.sigil", providerCr, 1);
  s.symbols("provider.sigil");
  s.shutdown();
  add(s);
}
{
  const s = new Builder("symbols-two-components-in-a-file", "symbols", {
    ".sigil/config.json": config("lsp-two"),
    "two.sigil": `component One {
  goal {
    First.
  }
}

component Two {
  goal {
    Second.
  }

  interface {
    TwoSurface {
      Second surface.
    }
  }
}
`,
    "empty.sigil": "",
  });
  s.start();
  s.symbols("two.sigil");
  s.symbols("empty.sigil");
  s.shutdown();
  add(s);
}

// tokens ---------------------------------------------------------------------

{
  const s = new Builder(
    "tokens-tags-and-protected-content",
    "tokens",
    multiwordFiles(providerCrlf),
  );
  s.start();
  s.tokens("consumer.sigil"); // emoji before a Tag; link and code fence are protected
  s.tokens("provider.sigil"); // CRLF
  s.tokens("absent.sigil"); // unknown file
  s.req("textDocument/semanticTokens/full", {
    textDocument: { uri: "http://example.com/x.sigil" },
  }); // -32603
  s.req("textDocument/semanticTokens/full", {}); // -32602
  s.shutdown();
  add(s);
}
{
  const s = new Builder(
    "tokens-provider-consumer-and-prose",
    "tokens",
    basicFiles(),
  );
  s.start();
  s.tokens("contract.sigil");
  s.tokens("consumer.sigil"); // lowercase prose and longer words carry no Tag token
  s.open(
    "consumer.sigil",
    consumerSource.replace("Consume the provider", "Consume the"),
    1,
  );
  s.tokens("consumer.sigil");
  s.close("consumer.sigil");
  s.shutdown();
  add(s);
}
{
  const s = new Builder(
    "tokens-cr-only-source",
    "tokens",
    multiwordFiles(providerCr),
  );
  s.start();
  s.tokens("provider.sigil");
  s.tokens("consumer.sigil");
  s.shutdown();
  add(s);
}
{
  const empty = "component Plain {\n  goal {\n    No tags here.\n  }\n}\n";
  const s = new Builder("tokens-source-without-tags", "tokens", {
    ".sigil/config.json": config("lsp-plain"),
    "plain.sigil": empty,
  });
  s.start();
  s.tokens("plain.sigil");
  s.shutdown();
  add(s);
}

// hover ----------------------------------------------------------------------

{
  const s = new Builder("hover-component-and-tag", "hover", basicFiles());
  s.start();
  s.hover("consumer.sigil", at(consumerSource, "from Thing import", "Thing")); // component, from the import
  s.hover("contract.sigil", { line: 0, character: 11 }); // component name
  s.hover("contract.sigil", { line: 0, character: 12 });
  s.hover(
    "contract.sigil",
    at(contractSource, "Execution {\n      Running", "Execution"),
  ); // cases declaration
  s.hover(
    "contract.sigil",
    at(contractSource, "Execution {\n      run()", "Execution"),
  ); // interface declaration
  s.hover(
    "contract.sigil",
    at(contractSource, "Each Execution ends", "Execution"),
  ); // reference
  s.hover(
    "consumer.sigil",
    at(consumerSource, "import { Execution }", "Execution"),
  );
  s.hover(
    "consumer.sigil",
    at(consumerSource, "run() uses Execution.", "Execution"),
  );
  s.hover(
    "consumer.sigil",
    at(
      consumerSource,
      "Consume the provider contract for Execution.",
      "Consume",
    ),
  ); // prose
  s.hover(
    "consumer.sigil",
    at(consumerSource, "execution and ExecutionCache", "execution"),
  ); // lowercase
  s.hover(
    "consumer.sigil",
    at(consumerSource, "ConsumerSurface {", "ConsumerSurface"),
  );
  s.hover("contract.sigil", { line: 1, character: 3 }); // a section keyword
  s.hover("contract.sigil", { line: 99, character: 0 });
  s.hover("absent.sigil", { line: 0, character: 0 }); // unknown file
  s.hover("contract.sigil", { line: 0, character: -4 }); // bad position
  s.shutdown();
  add(s);
}
{
  const s = new Builder(
    "hover-provider-and-consumer-roles",
    "hover",
    multiwordFiles(providerCrlf),
  );
  s.start();
  s.hover(
    "consumer.sigil",
    at(multiwordConsumer, "Use café results now.", "café results"),
  );
  s.hover(
    "consumer.sigil",
    at(multiwordConsumer, "import { café results }", "café results"),
  );
  s.hover(
    "provider.sigil",
    at(providerCrlf, "A *café results* carries", "café results"),
  );
  s.hover(
    "provider.sigil",
    at(providerCrlf, "café results {\r\nPreserve", "café results"),
  );
  s.hover(
    "consumer.sigil",
    at(multiwordConsumer, "Read [café results](./notes.md)", "café results"),
  ); // link label
  s.hover(
    "consumer.sigil",
    at(multiwordConsumer, "```text\ncafé results", "café results"),
  ); // payload
  s.shutdown();
  add(s);
}
{
  const linkedProvider = providerCrlf.replace(
    "Own vocabulary.",
    'Own [notes](<./notes (v2).md> "Provider notes") and ![image](./image.svg).',
  );
  const s = new Builder(
    "hover-authored-links",
    "hover",
    multiwordFiles(linkedProvider),
  );
  s.start();
  s.hover(
    "consumer.sigil",
    at(multiwordConsumer, "Use café results now.", "café results"),
  );
  s.hover("provider.sigil", { line: 0, character: 12 });
  s.render("provider.sigil");
  s.shutdown();
  add(s);
}
{
  // Markdown in authored text: escaping, literal blocks, lists and links.
  const source = `component Mark {
  goal {
    Show *emphasis*, \`code\`, [a link](https://example.com/a_b) and snake_case_words.
    Use <angle> brackets & ampersands.
  }

  interface {
    MarkTag {
      A first line.
      A second line with a [relative link](docs/readme.md) and [anchor](#top).

      \`\`\`text
      literal  text *kept*
      \`\`\`
    }
  }
}
`;
  const s = new Builder("hover-markdown-escaping", "hover", {
    ".sigil/config.json": config("lsp-markdown"),
    "mark.sigil": source,
  });
  s.start();
  s.hover("mark.sigil", { line: 0, character: 12 });
  s.hover("mark.sigil", at(source, "MarkTag {", "MarkTag"));
  s.render("mark.sigil");
  s.shutdown();
  add(s);
}
{
  // Hover on an overlaid provider and a changed workspace keeps one reading.
  const s = new Builder("hover-after-edits", "hover", basicFiles());
  s.start();
  s.open(
    "contract.sigil",
    contractSource.replace("Running succeeds.", "Running is overlaid."),
    1,
  );
  s.hover("consumer.sigil", at(consumerSource, "from Thing import", "Thing"));
  s.hover(
    "contract.sigil",
    at(contractSource, "Execution {\n      Running", "Execution"),
  );
  s.close("contract.sigil");
  s.hover("consumer.sigil", at(consumerSource, "from Thing import", "Thing"));
  s.shutdown();
  add(s);
}

// render ---------------------------------------------------------------------

{
  const s = new Builder("render-document", "render", basicFiles());
  s.start();
  s.render("contract.sigil");
  s.render("consumer.sigil");
  s.render("absent.sigil"); // no component: ""
  s.req("workspace/executeCommand", { command: "sigil.unknown" }); // -32602
  s.req("workspace/executeCommand", { command: "sigil.renderDocument" }); // -32602
  s.req("workspace/executeCommand", {
    command: "sigil.renderDocument",
    arguments: [],
  });
  s.req("workspace/executeCommand", {
    command: "sigil.renderDocument",
    arguments: [5],
  });
  s.req("workspace/executeCommand", {
    command: "sigil.renderDocument",
    arguments: "x",
  });
  s.req("workspace/executeCommand", { arguments: [uri("contract.sigil")] });
  s.req("workspace/executeCommand");
  s.req("workspace/executeCommand", {
    command: "sigil.renderDocument",
    arguments: ["http://example.com/contract.sigil"],
  }); // -32603
  s.open(
    "contract.sigil",
    "component Thing {\n  goal {\n    Overlaid goal.\n  }\n}\n",
    1,
  );
  s.render("contract.sigil");
  s.close("contract.sigil");
  s.render("contract.sigil");
  s.shutdown();
  add(s);
}
{
  const s = new Builder(
    "render-crlf-and-cr-sources",
    "render",
    multiwordFiles(providerCrlf),
  );
  s.start();
  s.render("provider.sigil");
  s.render("consumer.sigil");
  s.open("provider.sigil", providerCr, 1);
  s.render("provider.sigil");
  s.shutdown();
  add(s);
}

// glossary -------------------------------------------------------------------

{
  const source = `component Booking {
  goal {
    A temporary reservation creates a hold.

    Ignore \`temporary reservation\`.
  }

  interface {
    BookingTerm {
      The hold remains visible.
    }
  }
}
`;
  const s = new Builder("glossary-term-hover-definition-tokens", "glossary", {
    ".sigil/config.json": config("lsp-glossary-test"),
    ".sigil/glossary.json": JSON.stringify(
      {
        schemaVersion: 1,
        terms: [],
        contexts: [{
          id: "booking",
          include: ["**/*.sigil"],
          exclude: [],
          terms: [{
            term: "hold",
            definition: "Booking capacity before confirmation.",
            aliases: ["temporary reservation"],
          }],
        }],
      },
      null,
      2,
    ),
    "contract.sigil": source,
  });
  s.start();
  s.hover(
    "contract.sigil",
    at(
      source,
      "A temporary reservation creates a hold.",
      "temporary reservation",
      3,
    ),
  );
  s.definition(
    "contract.sigil",
    at(
      source,
      "A temporary reservation creates a hold.",
      "temporary reservation",
      3,
    ),
  );
  s.hover("contract.sigil", at(source, "creates a hold.", "hold"));
  s.definition("contract.sigil", at(source, "creates a hold.", "hold"));
  s.hover("contract.sigil", at(source, "The hold remains visible.", "hold"));
  s.hover(
    "contract.sigil",
    at(source, "Ignore `temporary reservation`.", "temporary reservation"),
  ); // protected: nothing
  s.definition(
    "contract.sigil",
    at(source, "Ignore `temporary reservation`.", "temporary reservation"),
  );
  s.hover("contract.sigil", at(source, "A temporary reservation", "A")); // not a term
  s.definition("contract.sigil", at(source, "A temporary reservation", "A"));
  s.tokens("contract.sigil");
  s.hover("contract.sigil", at(source, "BookingTerm {", "BookingTerm")); // a Tag next to terms
  s.shutdown();
  add(s);
}
{
  const source = `component Thing {
  goal {
    Run Execution.
  }

  interface {
    Execution {
      run()
    }
  }
}
`;
  const s = new Builder("glossary-tag-and-term-hover", "glossary", {
    ".sigil/config.json": config("lsp-concept-glossary-test"),
    ".sigil/glossary.json": JSON.stringify({
      schemaVersion: 1,
      terms: [],
      contexts: [{
        id: "runtime",
        include: ["**/*.sigil"],
        exclude: [],
        terms: [{
          term: "execution model",
          definition: "Reviewed execution meaning.",
          aliases: ["Execution"],
        }],
      }],
    }),
    "contract.sigil": source,
  });
  s.start();
  s.hover("contract.sigil", { line: 6, character: 8 });
  s.definition("contract.sigil", { line: 2, character: 9 }); // the Tag wins
  s.hover("contract.sigil", { line: 6, character: 6 }); // the declaration
  s.tokens("contract.sigil"); // a Tag token, no term token
  s.render("contract.sigil");
  s.shutdown();
  add(s);
}
{
  const s = new Builder("glossary-parse-diagnostic", "glossary", {
    ".sigil/config.json": config("lsp-glossary-error"),
    ".sigil/glossary.json": "{",
    "contract.sigil": contractSource,
  });
  s.start();
  s.symbols("contract.sigil");
  s.hover(
    "contract.sigil",
    at(contractSource, "Each Execution ends", "Execution"),
  );
  s.tokens("contract.sigil");
  s.write(".sigil/glossary.json", glossaryJson([]));
  s.watch([".sigil/glossary.json", 2]);
  s.shutdown();
  add(s);
}
{
  const s = new Builder("glossary-invalid-shape", "glossary", {
    ".sigil/config.json": config("lsp-glossary-shape"),
    ".sigil/glossary.json": JSON.stringify({ schemaVersion: 2, terms: "none" }),
    "contract.sigil": contractSource,
  });
  s.start();
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}
{
  const s = new Builder("glossary-term-collision", "glossary", {
    ".sigil/config.json": config("lsp-glossary-collision"),
    ".sigil/glossary.json": glossaryJson([
      { term: "run", definition: "First meaning." },
      { term: "run", definition: "Second meaning." },
    ]),
    "contract.sigil": contractSource,
  });
  s.start();
  s.hover("contract.sigil", at(contractSource, "run() starts", "run"));
  s.tokens("contract.sigil");
  s.shutdown();
  add(s);
}
{
  const s = new Builder("glossary-context-overlap", "glossary", {
    ".sigil/config.json": config("lsp-glossary-overlap"),
    ".sigil/glossary.json": JSON.stringify({
      schemaVersion: 1,
      terms: [],
      contexts: [
        {
          id: "one",
          include: ["**/*.sigil"],
          exclude: [],
          terms: [{ term: "run", definition: "One." }],
        },
        {
          id: "two",
          include: ["contract.sigil"],
          exclude: [],
          terms: [{ term: "run", definition: "Two." }],
        },
      ],
    }),
    "contract.sigil": contractSource,
  });
  s.start();
  s.hover("contract.sigil", at(contractSource, "run() starts", "run"));
  s.shutdown();
  add(s);
}
{
  // A glossary written after startup is used once the watcher reports it.
  const s = new Builder(
    "glossary-added-through-watcher",
    "glossary",
    basicFiles(),
  );
  s.start();
  s.hover(
    "contract.sigil",
    at(contractSource, "starts an Execution", "starts"),
  );
  s.write(
    ".sigil/glossary.json",
    glossaryJson([
      { term: "starts", definition: "Begins something.", aliases: ["begins"] },
    ]),
  );
  s.watch([".sigil/glossary.json", 1]);
  s.hover(
    "contract.sigil",
    at(contractSource, "starts an Execution", "starts"),
  );
  s.definition(
    "contract.sigil",
    at(contractSource, "starts an Execution", "starts"),
  );
  s.tokens("contract.sigil");
  s.delete(".sigil/glossary.json");
  s.watch([".sigil/glossary.json", 3]);
  s.hover(
    "contract.sigil",
    at(contractSource, "starts an Execution", "starts"),
  );
  s.shutdown();
  add(s);
}
{
  // Glossary occurrences in an open buffer that is not on disk.
  const s = new Builder("glossary-term-in-unsaved-buffer", "glossary", {
    ".sigil/config.json": config("lsp-glossary-buffer"),
    ".sigil/glossary.json": glossaryJson([
      {
        term: "hold",
        definition: "Booking capacity.",
        aliases: ["reservation"],
      },
    ]),
  });
  const text =
    "component Draft {\n  goal {\n    A reservation is a hold.\n  }\n}\n";
  s.start();
  s.open("draft.sigil", text);
  s.hover("draft.sigil", at(text, "A reservation is", "reservation"));
  s.definition("draft.sigil", at(text, "is a hold", "hold"));
  s.tokens("draft.sigil");
  s.close("draft.sigil");
  s.tokens("draft.sigil");
  s.shutdown();
  add(s);
}

// bom ------------------------------------------------------------------------

{
  // The provider on disk starts with a byte-order mark, which the editor does
  // not see, so positions on line 0 are the visible ones.
  const s = new Builder("bom-disk-provider", "bom", {
    ...multiwordFiles(providerBom),
    "bom-broken.sigil":
      "﻿stray text before a component\ncomponent Broken {\n}\n",
  });
  s.start();
  s.symbols("provider.sigil");
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "import { café results }", "café results"),
  );
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "Use café results now.", "café results"),
  );
  s.hover(
    "consumer.sigil",
    at(multiwordConsumer, "from Provider import", "Provider"),
  );
  s.hover("provider.sigil", { line: 0, character: 10 }); // the component name, with the mark hidden
  s.hover("provider.sigil", { line: 0, character: 9 });
  s.definition(
    "provider.sigil",
    at(providerBom, "A *café results* carries", "café results"),
  );
  s.tokens("provider.sigil");
  s.render("provider.sigil");
  s.symbols("bom-broken.sigil");
  s.open(
    "bom-broken.sigil",
    "stray text before a component\ncomponent Broken {\n}\n",
  ); // the editor buffer has no mark
  s.close("bom-broken.sigil");
  s.open(
    "provider.sigil",
    providerCrlf.replaceAll(tagName, "changed results"),
    1,
  );
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "Use café results now.", "café results"),
  );
  s.close("provider.sigil");
  s.definition(
    "consumer.sigil",
    at(multiwordConsumer, "Use café results now.", "café results"),
  );
  s.shutdown();
  add(s);
}
{
  // A contract on disk that starts with a byte-order mark, with a glossary.
  const s = new Builder("bom-contract-with-glossary-on-disk", "bom", {
    ".sigil/config.json": config("lsp-bom-glossary"),
    ".sigil/glossary.json": glossaryJson([
      { term: "run", definition: "Start.", aliases: ["starts"] },
    ]),
    "contract.sigil": "\uFEFF" + contractSource,
  });
  s.start();
  s.symbols("contract.sigil");
  s.hover("contract.sigil", { line: 0, character: 10 });
  s.hover("contract.sigil", { line: 0, character: 9 });
  s.hover("contract.sigil", at(contractSource, "run() starts", "run"));
  s.definition("contract.sigil", at(contractSource, "run() starts", "starts"));
  s.tokens("contract.sigil");
  s.render("contract.sigil");
  s.shutdown();
  add(s);
}
{
  // A glossary with a byte-order mark does not parse as JSON.
  const s = new Builder("bom-glossary-on-disk", "bom", {
    ".sigil/config.json": config("lsp-bom-glossary-file"),
    ".sigil/glossary.json": "\uFEFF" + glossaryJson([]),
    "contract.sigil": contractSource,
  });
  s.start();
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}
{
  // A configuration file with a byte-order mark does not parse as JSON.
  const s = new Builder("bom-config-on-disk", "bom", {
    ".sigil/config.json": "\uFEFF" + config("lsp-bom-config"),
    "contract.sigil": contractSource,
  });
  s.start();
  s.symbols("contract.sigil");
  s.shutdown();
  add(s);
}

// ---------------------------------------------------------------------------
// Running scenarios

const names = new Set<string>();
for (const scenario of scenarios) {
  if (names.has(scenario.name)) {
    throw new Error(`duplicate scenario name: ${scenario.name}`);
  }
  names.add(scenario.name);
}

/** Replace the temp directory by `<ROOT>` in every string of a message. */
function scrubber(raw: string, real: string): (value: Json) => Json {
  const encoded = (path: string) => pathToFileUri(path).slice("file://".length);
  const forms = [
    ...new Set([encoded(real), encoded(raw), real, raw]),
  ].sort((a, b) => b.length - a.length);
  const text = (value: string) => {
    let out = value;
    for (const form of forms) out = out.replaceAll(form, PLACEHOLDER);
    return out;
  };
  const walk = (value: Json): Json => {
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [text(key), walk(item)]),
      );
    }
    return value;
  };
  return walk;
}

/** Replace `<ROOT>` by the real directory; URIs get the encoded spelling. */
function expander(real: string): (value: Json) => Json {
  const encoded = pathToFileUri(real).slice("file://".length);
  const text = (value: string) =>
    value.replaceAll(`file://${PLACEHOLDER}`, `file://${encoded}`).replaceAll(
      PLACEHOLDER,
      real,
    );
  const walk = (value: Json): Json => {
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, walk(item)]),
      );
    }
    return value;
  };
  return walk;
}

function isEmptyResult(result: Json): boolean {
  if (result === null || result === "") return true;
  if (Array.isArray(result)) return result.length === 0;
  if (typeof result === "object" && result !== null) {
    const data = (result as { data?: Json }).data;
    return Array.isArray(data) && data.length === 0 &&
      Object.keys(result).length === 1;
  }
  return false;
}

function outcomeOf(output: Message[]): Outcome[] {
  const found = new Set<Outcome>();
  for (const message of output) {
    if ("error" in message) found.add("error");
    else if ("result" in message) {
      found.add(isEmptyResult(message.result) ? "empty" : "result");
    } else if (message.method === "textDocument/publishDiagnostics") {
      const diagnostics =
        (message.params as { diagnostics?: Message[] }).diagnostics ?? [];
      if (diagnostics.length === 0) found.add("empty");
      else found.add("result");
      if (diagnostics.some((item) => item.severity === 1)) found.add("error");
    } else found.add("result");
  }
  return [...found].sort() as Outcome[];
}

async function run(scenario: Scenario) {
  const raw = await Deno.makeTempDir({ prefix: "sigil-lsp-parity-" });
  // Use the real path throughout so the server's current directory, every URI
  // and every recorded path spell the same directory.
  const real = await Deno.realPath(raw);
  try {
    const scrub = scrubber(raw, real);
    const expand = expander(real);
    const writeFile = async (path: string, text: string) => {
      const target = `${real}/${path}`;
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeTextFile(target, text);
    };
    for (const [path, text] of Object.entries(scenario.files)) {
      await writeFile(path, text);
    }
    const server = new SigilLanguageServer({
      fs: new DenoSigilFileSystem(),
      currentDirectory: real,
      protocolSource: (source) => new EditorProtocolSource(source),
    });
    const steps: RecordedStep[] = [];
    for (const step of scenario.steps) {
      if (step.kind === "write") {
        await writeFile(step.path, step.text);
        steps.push(step);
      } else if (step.kind === "delete") {
        await Deno.remove(`${real}/${step.path}`);
        steps.push(step);
      } else {
        const outgoing = await server.handle(
          expand(step.message) as Parameters<typeof server.handle>[0],
        );
        const output = scrub(
          JSON.parse(JSON.stringify(outgoing)),
        ) as Message[];
        const recorded: RecordedStep = {
          kind: "send",
          message: step.message,
          output,
          outcome: outcomeOf(output),
        };
        if (step.message.method === "exit") {
          recorded.exitCode = server.exitCode ?? null;
        }
        steps.push(recorded);
      }
    }
    return {
      name: scenario.name,
      feature: scenario.feature,
      files: scenario.files,
      steps,
    };
  } finally {
    await Deno.remove(raw, { recursive: true });
  }
}

const records = [];
for (const scenario of scenarios) records.push(await run(scenario));

// ---------------------------------------------------------------------------
// Checks on the recording

const REQUIRED: Record<Feature, Outcome[]> = {
  lifecycle: ["result", "empty", "error"],
  errors: ["error"],
  diagnostics: ["result", "empty", "error"],
  definition: ["result", "empty", "error"],
  symbols: ["result", "empty", "error"],
  tokens: ["result", "empty", "error"],
  hover: ["result", "empty", "error"],
  render: ["result", "empty", "error"],
  watch: ["result", "empty"],
  glossary: ["result", "empty", "error"],
  bom: ["result"],
};

const seen = new Map<Feature, Set<Outcome>>();
for (const record of records) {
  const set = seen.get(record.feature) ?? new Set<Outcome>();
  seen.set(record.feature, set);
  let hasOutput = false;
  for (const step of record.steps) {
    if (step.kind !== "send") continue;
    for (const outcome of step.outcome) set.add(outcome);
    if (step.output.length > 0) hasOutput = true;
  }
  if (!hasOutput) throw new Error(`${record.name}: no step has output`);
}
for (const feature of FEATURES) {
  for (const outcome of REQUIRED[feature]) {
    if (!seen.get(feature)?.has(outcome)) {
      throw new Error(`feature ${feature} records no ${outcome} step`);
    }
  }
}

// A recording must never carry the machine it was made on.
for (const record of records) {
  const text = JSON.stringify(record);
  if (
    /sigil-lsp-parity-/.test(text) ||
    /\/(?:private\/)?var\/folders\//.test(text) ||
    /\/tmp\//.test(text)
  ) {
    throw new Error(`${record.name}: a temp path leaked into the recording`);
  }
}

const perFeature = new Map<string, { scenarios: number; steps: number }>();
let totalSteps = 0;
let sendSteps = 0;
for (const record of records) {
  const entry = perFeature.get(record.feature) ??
    { scenarios: 0, steps: 0 };
  entry.scenarios++;
  entry.steps += record.steps.length;
  perFeature.set(record.feature, entry);
  totalSteps += record.steps.length;
  sendSteps += record.steps.filter((step) => step.kind === "send").length;
}

const fixture = {
  generator: "scripts/generate-lsp-fixtures.ts",
  placeholder: PLACEHOLDER,
  counts: {
    scenarios: records.length,
    steps: totalSteps,
    sendSteps,
    perFeature: Object.fromEntries(
      FEATURES.map((feature) => [feature, perFeature.get(feature)]),
    ),
  },
  scenarios: records,
};

await Deno.mkdir(OUTPUT.slice(0, OUTPUT.lastIndexOf("/")), { recursive: true });
await Deno.writeTextFile(OUTPUT, JSON.stringify(fixture, null, 2) + "\n");

console.log(
  `${records.length} scenarios, ${totalSteps} steps (${sendSteps} sent) written to ${OUTPUT}`,
);
console.log(
  "per feature: " +
    FEATURES.map((feature) => {
      const entry = perFeature.get(feature)!;
      return `${feature}=${entry.scenarios}/${entry.steps}`;
    }).join(" ") + " (scenarios/steps)",
);
