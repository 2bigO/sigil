# Core fixtures

These files hold what the TypeScript core produced: parsed documents, resolved
workspaces, diagnostics, inline links, formatter output (`format/`), glossary
terms (`glossary/`), and configuration verdicts (`config-parity.json`). The
`*_parity.rs`, `format_corpus.rs` and `glossary.rs` tests in `packages/core/tests`
replay them against `sigil-core`. They are now the specification of that
behavior, so change them by hand and only when the behavior is meant to change.

`commonmark-inline-links.json` comes from the CommonMark 0.31.2 specification
(its header names the source and licence), and the `design-*-080.json` files are
design inputs that the `sigilc` tests read; neither is recorded TypeScript
output.

The commit titled "refactor: remove the TypeScript implementation" deleted the
TypeScript tools and the scripts that generated these files. Find it with
`git log --grep "remove the TypeScript implementation"`; its parent is the last
tree that can regenerate them.
