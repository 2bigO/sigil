# sigil-lsp

Implemented pre-production language-server package for editor-facing Sigil
semantics for language 0.9. The artifact version is declared independently in
`deno.json`.

The language server should be the reusable bridge between `sigil-core` and
concrete editor integrations.

Language 0.9 responsibilities:

- implement Language Server Protocol 3.18 over standard input and output;
- implement initialize, initialized, shutdown, and exit lifecycle handling;
- synchronize open files using full-document changes and in-memory overlays;
- surface diagnostics inline;
- navigate explicit provider selections, local Tag introductions and resolved
  references using their captured source spans;
- provide document symbols for components, sections, local Tag groups and inline
  definitions;
- show complete provider contracts alongside consumer-owned Facets in Tag hover;
- provide resolver-backed semantic highlighting for component and Tag names
  through full-document semantic tokens;
- prefer the owning inline definition as a Tag destination, otherwise the earliest
  valid grouping heading;
- highlight reviewed glossary occurrences with the `term` semantic-token type;
- show canonical glossary definitions and bounded context through hover;
- navigate glossary occurrences to their authoritative JSON entries;
- publish glossary parse, schema, context-overlap, and collision diagnostics;

Deferred responsibilities:

- formatting and structure actions;
- completion, references, rename, and code actions;
- non-file URI schemes and transports other than standard input and output.

Non-responsibilities:

- implement VS Code-specific UI;
- duplicate parser or resolver logic;
- own Codex-specific behavior;
- replace the CLI for automation.

Run the server locally:

```bash
deno task start
```

Run package tests:

```bash
deno task test
```

## The Rust server

The same language server also exists in Rust, in this package's `rust/`
directory (crate `sigil-lsp`, a library over `sigil-core`), and the Rust `sigil`
binary starts it:

```bash
sigil lsp
```

`sigil lsp` takes no options and speaks the protocol on standard input and
output. The Deno server above still ships, and the VS Code extension still
launches it; nothing switches to the Rust server yet.

Run its tests (replayed against sessions recorded from the Deno server, plus
real-process tests in `packages/cli`):

```bash
cargo test --manifest-path packages/lsp/Cargo.toml
```

Compare the two servers on this repository with a built Rust binary:

```bash
deno task build:sigil
deno run -A scripts/compare-lsp.ts packages/cli/target/debug/sigil
```

The Rust server drops what the contract no longer asks of a language server:

- Hover never lists owned implementations, and there is no ownership scanner.
- There is no ownership file-watch registration or its cache.

It also differs from the Deno server in these ways:

- A client that supports dynamic registration gets one watch registration
  (`sigil/language-watch`, request id `sigil/watch/request`) instead of two.
- A request that has a document change or a relevant file-change event already
  queued behind it answers content modified, because its answer would be
  discarded. A burst of edits is applied with one reload.
- The process exits with status 0 when the editor sends `exit` after
  `shutdown`, 1 when it sends `exit` without `shutdown`, and 3 when standard
  input or output fails.
- A byte-order mark at the start of a file read from disk is hidden in every
  position, document symbols included, as the editor hides it. The Deno server
  only does this through the extension's source hook.

## Source snapshots and freshness

Disk Sigil, config and glossary inputs retain original UTF-8 bytes. Open documents
supply validated scalar text. One captured generation supplies navigation,
diagnostics, related locations, symbols and tokens; requests do not reread source
to reinterpret byte ranges. Protocol positions and token lengths use UTF-16,
including BOM, supplementary characters and CR/LF/CRLF boundaries.

Late reloads cannot overwrite newer overlays. Pending requests return content
modified when their workspace generation changes. Closing an overlay restores disk
content, and older document versions do not overwrite a newer edit.

Clients supporting dynamic registration receive a language workspace watcher and
the existing precise implementation-source watchers. Source/config changes reload
the language snapshot; implementation changes invalidate the ownership scan and
hover cache. Unsupported clients retain document synchronization and reload-based
freshness. Ownership links remain advisory and retain the consumer scope and
separate originating Tag owner.
