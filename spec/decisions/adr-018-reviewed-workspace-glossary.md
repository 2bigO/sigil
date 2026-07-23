# ADR-018: Reviewed Workspace Glossary

**Status:** Accepted

**Owner:** _TBD_

**Reviewers:** _TBD_

**Last updated:** 2026-07-23

## Context

Sigil contracts and their supporting documents use domain-specific words whose
meaning depends on the project and, sometimes, on a bounded context within the
project.

Concept identifiers group semantic content inside Sigil contracts, but they do
not define the meaning of every domain term used in free-form prose. A word can
therefore drift between components, documentation, implementation discussions,
and agent-generated changes without producing a structural Sigil error.

This repository maintains `spec/glossary.md` manually, but Sigil workspaces have
no standard, machine-readable glossary that core, CLI, skills, and language
servers can resolve consistently.

A generated glossary would not be a safe authority. Extraction can discover
candidate vocabulary and conflicting usage, but inferred definitions require
human review before they govern project language.

## Decision

Sigil will support an optional, committed workspace glossary at:

```text
.sigil/glossary.json
```

The glossary is a versioned, human-reviewed authority for project terminology.
Tools may inspect it, validate it, and propose changes, but no deterministic
tool, language server, or model-assisted workflow may silently modify it.

An approved normative contract remains authoritative when it conflicts with the
glossary. The conflict must be reported and the glossary corrected rather than
allowing the glossary to override the contract.

### Glossary Structure

The initial schema has:

- a `schemaVersion`;
- workspace-wide terms;
- zero or more bounded contexts;
- workspace-relative include and exclude globs for each context;
- a stable context identifier;
- a canonical term and definition;
- optional aliases for a term.

A representative document is:

```json
{
  "schemaVersion": 1,
  "terms": [
    {
      "term": "component",
      "definition": "A coherent system unit with a stable contract relied upon by dependents."
    }
  ],
  "contexts": [
    {
      "id": "booking",
      "include": [
        "features/booking/**/*.sigil"
      ],
      "exclude": [],
      "terms": [
        {
          "term": "hold",
          "definition": "A temporary reservation of booking capacity before confirmation.",
          "aliases": [
            "temporary reservation"
          ]
        }
      ]
    }
  ]
}
```

The final JSON Schema and exact field constraints will be specified with the
corresponding Sigil contracts before implementation.

### Context Resolution

A `.sigil` source may match at most one bounded context.

Matching more than one bounded context is an error. Context ordering does not
resolve overlap.

Workspace terms are available to every included `.sigil` source. A term defined
inside the resolved bounded context takes precedence over a workspace definition
with the same spelling.

A source matching no bounded context receives only workspace-wide definitions.

Context globs use the workspace root as their base and follow the workspace's
established path and containment rules.

### Term Recognition

Canonical terms and aliases are matched:

- case-insensitively;
- as whole words or whole phrases;
- with the longest matching phrase taking precedence.

For example, `workspace root` is selected before `workspace` when both exist.

The initial implementation recognizes terms only in free-form Sigil prose. It
does not reinterpret component names, concept identifiers, import syntax, code
fences, inline code, URLs, or other structural syntax as glossary occurrences.

Terms and aliases that resolve to multiple entries in the same effective
context are invalid.

The deterministic matcher does not guess whether an unknown word is a domain
term and does not infer definitions from surrounding prose.

### Platform Responsibilities

`sigil-core` owns:

- glossary loading and schema validation;
- context-glob resolution;
- collision and overlap diagnostics;
- deterministic term occurrence matching;
- source ranges and projections consumed by other tools.

`sigil-cli` exposes glossary validation and occurrence inspection using core
results. Ordinary workspace checking includes invalid glossary diagnostics.

The Sigil skill owns model-assisted glossary review. It may:

- extract candidate domain terms from Sigil prose;
- find inconsistent or ambiguous usage;
- propose canonical terms, definitions, aliases, context placement, or removal;
- present supporting occurrences and exact proposed JSON changes.

The skill must obtain human approval before changing
`.sigil/glossary.json`. After writing an approved change, it validates the
workspace and stops for review under the normal Sigil approval gate.

`sigil-lsp` consumes core glossary projections and initially supports glossary
features in `.sigil` files:

- semantic highlighting for resolved glossary occurrences;
- hover showing the canonical term, definition, context, and matched alias;
- go-to-definition navigation to the authoritative JSON entry;
- diagnostics for invalid glossary structure, overlapping contexts, and term
  collisions.

The language server remains read-only and never creates or updates glossary
entries.

### Relationship To Sigil Concepts

Glossary terms and Sigil concept identifiers are separate mechanisms.

A concept identifier groups related semantic lines within component resolution.
A glossary entry defines vocabulary across files in a workspace or bounded
context.

A glossary occurrence does not create a concept identity, import a concept,
alter component resolution, or change the meaning of Sigil syntax.

## Consequences

Benefits:

- authors and agents share reviewed project vocabulary;
- the same spelling can have deterministic meanings in separate bounded
  contexts;
- hover makes definitions available where terms are used;
- extraction assists glossary maintenance without turning inference into
  authority;
- glossary drift can be reviewed independently from structural Sigil validity.

Costs:

- teams must review and maintain another committed workspace artifact;
- context globs must be kept non-overlapping;
- deterministic matching can identify occurrences but cannot prove that prose
  uses a term coherently;
- JSON is less narrative than Markdown, though it is easier to validate and
  consume consistently.

## Initial Scope

The first delivery includes:

1. the versioned `.sigil/glossary.json` schema;
2. core loading, resolution, matching, projections, and diagnostics;
3. CLI validation and occurrence inspection;
4. the reviewed skill extraction and maintenance workflow;
5. LSP highlighting, hover, and definition navigation for `.sigil` prose.

Markdown scanning and editor support are compatible with the model but deferred
until the `.sigil` workflow has been validated.

## Alternatives Considered

### Markdown as the authoritative artifact

Not selected because deterministic parsing would require a rigid Markdown
subset or embedded metadata whose contract would be less explicit than a JSON
schema.

### Generated glossary as authority

Rejected because extraction can reproduce accidental or ambiguous usage.
Generated candidates require human review before becoming project language.

### New glossary syntax inside `.sigil` files

Not selected because vocabulary management does not require changing the Sigil
language grammar or overloading component and concept semantics.

### One workspace-wide namespace without bounded contexts

Rejected because the same word can legitimately have different meanings in
separate domain boundaries.

### Explicit context declarations in every source

Not selected initially because they would add repetitive annotations to Sigil
and documentation. Workspace-relative globs provide deterministic context
resolution without changing source syntax.

## Revisit Conditions

Revisit this decision if:

- path-based contexts cannot represent common repository boundaries safely;
- glossary size makes whole-workspace matching impractical;
- authors need explicit local context declarations;
- aliases produce excessive false-positive highlighting;
- Markdown or another document format requires a different occurrence adapter;
- practical usage shows that glossary terms and concept identifiers need an
  explicit reviewed relationship.
