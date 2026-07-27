# Sigil Open Questions

This file tracks unresolved language and workflow decisions.

## Language

- Should dependencies on collected `expand` details be explicit in Sigil, or should expands remain review and implementation context only?
- How strict should future parsing and validation become while preserving authoring speed?
- How should conflicts between collected expands be represented, detected, and resolved?
- Should imports support aliases, re-exports, or wildcard imports beyond the implemented cycle diagnostics?

## Project Organization

- How should shared abstractions be placed when they do not have one obvious implementation location?

## Platform

- Which additional semantic checks, if any, should move from host integrations into deterministic core diagnostics?
- Should Sigil platform packages support generated diagrams or dependency maps?

## Workflow

- How should approved Sigil be marked?
- Should implementation sessions record which Sigil version they used?
- How should superseded Sigil decisions be preserved beyond the rationale and
  discarded alternatives retained in `decisions`?
- Should the Codex skill update implementation plans from Sigil automatically, or only after explicit user approval?
- How should evidence from brownfield reconciliation remain traceable without becoming Sigil syntax?
- Should standards sources remain in review summaries or gain a durable repository representation?
- How should multiple hosts produce comparable semantic-readiness findings without sharing one model or prompt?

The rejected Receipt, anchor, and generated evidence-record architecture is
preserved for historical analysis in
[ADR-011](decisions/adr-011-generated-rationale-evidence-and-review-records.md).
