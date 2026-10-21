# Packages

This directory contains buildable or distributable Sigil platform units. Each is a
Rust crate with its own `Cargo.toml`, which owns the crate's version, and an
authored contract beside the code.

Current packages:

- `sigil-core` ([core](core)): the shared Rust library for source capture, parsing, workspace discovery, resolution, formatting, glossary matching and diagnostics.
- `sigil-cli` ([cli](cli)): the `sigil` command line over `sigil-core`, with `init`, `version`, `parse`, `check`, `fmt`, `glossary` and `lsp`.
- `sigil-lsp` ([lsp](lsp)): the editor-facing language server over `sigil-core`, started by `sigil lsp`.
- `sigilc` ([sigilc](sigilc)): the native compiler for computed design and implementation checks.

Host-specific adapters belong under `integrations/`, not here.
