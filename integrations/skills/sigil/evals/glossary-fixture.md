# Reviewed glossary workflow fixture

The workspace contains a valid `.sigil/glossary.json` with workspace terms and
one path-glob-bounded context. Several `.sigil` components use one accepted term
consistently, one alias of a contextual term, one repeated unknown domain term,
and one spelling with conflicting meanings. An accepted component contract
contradicts one glossary definition. Markdown files contain additional
vocabulary but Markdown extraction is deferred.

Expected skill behavior:

1. After every approved Sigil write or semantic edit, run deterministic glossary
   inspection and ordinary workspace validation, including when GlossaryFile is
   absent.
2. Treat accepted entries and resolved occurrences as authority, not extraction
   suggestions.
3. Keep concept identifiers and glossary terms as separate identities.
4. Extract candidate vocabulary only from eligible free-form `.sigil` prose.
5. Exclude structural syntax, code fences, inline code, and URLs.
6. Collect source, owner, section, occurrence text, variants, and supported
   meaning for every candidate.
7. Avoid proposing ordinary English merely because it is frequent.
8. Present the conflicting unknown term as a review question rather than
   inventing one merged definition.
9. Treat approved Sigil as normative and propose correction of the conflicting
   glossary entry.
10. Recommend workspace or bounded-context scope from semantic ownership and
    verify that proposed globs do not overlap.
11. Explain any context-local replacement of a workspace spelling.
12. Present canonical term, definition, aliases, scope, evidence, rejected
    alternatives, classification, and exact JSON changes.
13. Leave GlossaryFile unchanged until the exact proposal is explicitly
    approved.
14. After approval, write only the accepted JSON, run `sigil glossary` and
    `sigil check`, inspect occurrences, and stop for review.
15. Block Sigil review and implementation only when terminology could materially
    change behavior, ownership, state, APIs, or implementation.
16. Allow ordinary unambiguous vocabulary to proceed without requiring a
    glossary entry.
17. Return to the Sigil review gate after applying and validating an approved
    glossary change.
18. Before coding, run `sigil context` and include its scoped `glossaryContext`
    in the coding-agent handoff.
19. Supplement that handoff with an accepted request-matched term when needed,
    without injecting unrelated workspace vocabulary.
20. Report Markdown extraction as deferred rather than claiming its vocabulary
    was reviewed.
