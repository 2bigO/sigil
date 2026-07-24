# Compatibility

| Contract                 | Version | Compatible dependencies                        |
| ------------------------ | ------- | ---------------------------------------------- |
| Sigil                    | 0.5.0   | `.sigil/config.json` sigilVersion 0.5.0        |
| `.sigil/config.json`     | 0.5.0   | core `packages/core/deno.json`                 |
| `@qoherent/sigil-core`   | 0.6.0   | `.sigil/config.json` sigilVersion 0.5.0        |
| `@qoherent/sigil`        | 0.6.0   | core `0.6.x`                                   |
| `@qoherent/sigil-lsp`    | 0.6.0   | core `0.6.x`; LSP 3.18                         |
| VS Code extension        | 0.6.0   | `@qoherent/sigil-lsp` 0.6.x; VS Code `^1.91.0` |
| Coding-agent Sigil skill | 0.6.0   | CLI/core `^0.6.0`; Sigil 0.5.0                 |

The language contract in `spec/language.sigil` owns the Sigil version. Core
exposes that supported language version independently from the core artifact
version owned by `packages/core/deno.json`. A tool must reject a configured
`sigilVersion` it does not explicitly support.
