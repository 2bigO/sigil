# Reviewed glossary workflow fixture

The workspace contains a valid `.sigil/glossary.json` with workspace terms and
one path-glob-bounded context. Several `.sigil` components use one accepted term
consistently, one alias of a contextual term, one repeated unknown domain term,
and one spelling with conflicting meanings. An accepted component contract
contradicts one glossary definition. Markdown files contain additional
vocabulary but Markdown extraction is deferred. Deterministic glossary
inspection returns zero diagnostics even though the changed Sigil prose still
contains unknown candidate vocabulary requiring model-assisted review.

Expected skill behavior:

1. After every approved Sigil write or semantic edit, run deterministic glossary
   inspection and ordinary workspace validation, including when GlossaryFile is
   absent.
2. Treat deterministic inspection and model-assisted candidate extraction as
   separate mandatory stages.
3. Never infer that no glossary changes are needed from zero CLI diagnostics;
   zero diagnostics establish only a valid deterministic projection.
4. Perform model-assisted extraction from changed semantic lines regardless of
   diagnostic count or GlossaryFile presence.
5. Treat accepted entries and resolved occurrences as authority, not extraction
   suggestions.
6. Keep concept identifiers and glossary terms as separate identities.
7. Extract candidate vocabulary only from eligible free-form `.sigil` prose.
8. Exclude structural syntax, code fences, inline code, and URLs.
9. Collect source, owner, section, occurrence text, variants, and supported
   meaning for every candidate.
10. Avoid proposing ordinary English merely because it is frequent.
11. Present the conflicting unknown term as a review question rather than
   inventing one merged definition.
12. Treat approved Sigil as normative and propose correction of the conflicting
   glossary entry.
13. Recommend workspace or bounded-context scope from semantic ownership and
    verify that proposed globs do not overlap.
14. Explain any context-local replacement of a workspace spelling.
15. Present canonical term, definition, aliases, scope, evidence, rejected
    alternatives, classification, and exact JSON changes.
16. Leave GlossaryFile unchanged until the exact proposal is explicitly
    approved.
17. After approval, write only the accepted JSON, run `sigil glossary` and
    `sigil check`, inspect occurrences, and stop for review.
18. Block Sigil review and implementation only when terminology could materially
    change behavior, ownership, state, APIs, or implementation.
19. Allow ordinary unambiguous vocabulary to proceed without requiring a
    glossary entry.
20. When model-assisted extraction finds no material candidate, report the
    changed semantic lines and relevant surrounding occurrences inspected
    instead of citing the diagnostic count.
21. Return to the Sigil review gate after applying and validating an approved
    glossary change.
22. Before coding, run `sigil context` and include its scoped `glossaryContext`
    in the coding-agent handoff.
23. Supplement that handoff with an accepted request-matched term when needed,
    without injecting unrelated workspace vocabulary.
24. Report Markdown extraction as deferred rather than claiming its vocabulary
    was reviewed.
