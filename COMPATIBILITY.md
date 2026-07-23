# Compatibility

| Contract                 | Version | Compatible dependencies                        |
| ------------------------ | ------- | ---------------------------------------------- |
| Sigil                    | 0.4.0   | `.sigil/config.json` sigilVersion 0.4.0        |
| `.sigil/config.json`     | 0.4.0   | core `packages/core/deno.json`                 |
| `@qoherent/sigil-core`   | 0.5.0   | `.sigil/config.json` sigilVersion 0.4.0        |
| `@qoherent/sigil`        | 0.5.0   | core `0.5.x`                                   |
| `@qoherent/sigil-lsp`    | 0.5.0   | core `0.5.x`; LSP 3.18                         |
| VS Code extension        | 0.5.0   | `@qoherent/sigil-lsp` 0.5.x; VS Code `^1.91.0` |
| Coding-agent Sigil skill | 0.5.0   | CLI/core `^0.5.0`; Sigil 0.4.0                 |

The language contract in `spec/language.sigil` owns the Sigil version. Core
exposes that supported language version independently from the core artifact
version owned by `packages/core/deno.json`. A tool must reject a configured
`sigilVersion` it does not explicitly support.
