# Pinned snapdir-core dependency

Source: https://github.com/bermi/snapdir
Revision: `5fef1d97e0cbf073fb5b443f8e7e26d147625e98`
Crate: `crates/snapdir-core`, version 1.10.0, MIT (see LICENSE).

This directory copies the upstream crate source and tests. `portability.patch`
records every source/manifest change: standalone Cargo metadata, conditional
Unix permissions and mmap-fault classification, a documentary Windows permission
value, and unavailable non-Unix CPU telemetry returning None. Hashing and walk
algorithms are unchanged. Do not count upstream dependency lines as new Sigil
implementation or as code deleted by this refactor.

Sigil uses only source walking, manifests and BLAKE3 hashing. It does not adopt
snapshot stores, backup orchestration or resource telemetry. The pinned Git
requirement in sigilc is overridden by this distributable Cargo patch so a clean
checkout builds without `repos/` or an unpublished upstream change. Sigil enables
BLAKE3's pure Rust implementation to avoid requiring platform assembler tools
when checking the release matrix; this does not change checksums.

To update, compare the entire crate with the pinned upstream source and review
this patch. Keep the upstream license and regression tests. Native release
linking and runtime checks remain separate from cross-target compile checks.
