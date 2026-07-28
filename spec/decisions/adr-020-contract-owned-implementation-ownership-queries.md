# ADR-020: Contract-Owned Implementation Ownership Queries

**Status:** Accepted

**Owner:** _TBD_

**Reviewers:** _TBD_

**Last updated:** 2026-07-28

## Context

Sigil already records durable contracts for components, and CLI and LSP both need a shared way to answer which implementation artifacts belong to a given contract.

The first release should not add new Sigil syntax or a persisted ownership index. That would make the feature heavier than necessary and would introduce a hard caching and invalidation problem before the basic ownership query is proven useful.

Ownership also needs to include some Markdown files, because a number of repository Markdown files function as agent-facing instructions or workflow documents that shape implementation behavior.

## Decision

Sigil will add a shared core query that returns the implementation targets owned by a Sigil contract.

The first version is contract-owned, not implementation-owned. A Sigil contract is the owner, and the query returns the implementation artifacts it owns.

The query is optional concept-scoped, so callers can ask for the whole contract or a narrower contract concept.

Ownership links are stored in implementation comments that point back to the governing Sigil contract. This implementation-to-contract link direction does not change the contract-owned query: callers still select a contract or concept and receive matching implementation targets.

The annotation payload is:

```text
@sigil <relation> <file>::<component>[::<concept>]
```

`file` is a repository-relative Sigil path. `component` is required and `concept` is optional.

Relations:

- `follows` — this artifact follows the selected Sigil.
- `implements` — this artifact implements the concept.
- `tests` — this artifact tests the concept.
- `validates` — this artifact validates a constraint or case.
- `related` — informational link only.

The first version includes:

- code;
- tests;
- agent-facing instruction or workflow Markdown.

The first version excludes:

- general prose documentation;
- configs;
- non-text artifacts;
- new Sigil syntax;
- persisted ownership storage;
- caching.

The shared core result should prefer symbol-level targets when available and fall back to file-level targets when symbol resolution is unavailable.

## Consequences

Benefits:

- CLI and LSP can share one ownership view;
- the contract remains the source of truth;
- the language grammar does not need to change yet;
- Markdown instruction files that shape agent behavior remain part of the feature.

Costs:

- the first version will not persist ownership across sessions;
- no cache is introduced in the first attempt;
- implementation coverage remains smaller than a future persisted system.

## Revisit when

- persisted ownership storage becomes worth the cost;
- cross-session caching becomes necessary;
- implementation-first navigation becomes a primary user need;
- the artifact scope needs to expand beyond code, tests, and agent-facing Markdown.
