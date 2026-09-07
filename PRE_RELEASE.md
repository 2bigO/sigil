# Sigil pre-release status

Sigil remains a pre-production 0.x toolchain. The language frontend, native
compiler, skill, LSP and editor have independent versions owned by their manifests.
The skill's [compatibility metadata](integrations/skills/sigil/compatibility.json)
declares supported language, CLI, core and sigilc combinations.

Current architecture:

- The language frontend owns parsing, resolution, inspection and structural export.
- Rust `sigilc` owns source identity, disposable worlds, fixed semantic rules,
  ordered scope, catalogs and Design/Implementation reports.
- The portable skill instructs models/operators to use native commands directly.
- The retained VS Code extension provides language features, preview/navigation
  and native gate status/diagnostics.
- Independent reconstruction, model execution and the coding loop remain external.

Acceptance requires applicable formatting, lint, type and behavioral checks,
editor integration, executable skill examples, packaging checks and real use.
Fixed fixtures prove protocol behavior; they do not prove application delivery
or faithful independent reconstruction.

Native release acceptance requires all five supported targets to build and run
on matching environments, include both binaries and the compatible skill, pass
relocated/source-free consumption checks and have SHA-256 manifests. A foreign
cargo check is not an executable platform test. Linux x86_64 has local execution
evidence; other retained platforms still require their execution evidence.

The ongoing refactor's complete delivery, semantic comparison and temporary-state
retirement gate is defined in [track.md](track.md). A pre-release milestone does
not waive it. Publishing or deploying requires separate authorization.
