# Language server fixtures

`lsp-parity.json` holds sessions recorded from the TypeScript language server:
the messages sent and the messages it answered. The Rust tests in
`packages/lsp/tests/parity.rs` and `hover.rs` replay them against `sigil-lsp`.
The file is now the specification of those answers, so change it by hand and
only when the behavior is meant to change. The `generator` field names the
script that wrote it and no longer exists.

The commit titled "refactor: remove the TypeScript implementation" deleted the
TypeScript tools and the scripts that generated these files. Find it with
`git log --grep "remove the TypeScript implementation"`; its parent is the last
tree that can regenerate them.
