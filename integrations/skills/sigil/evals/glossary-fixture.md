# Glossary fixture

A selected contract uses two conflicting meanings of a domain term. Deterministic
glossary inspection has zero diagnostics. The user requests vocabulary review.
A separate refactor session explicitly requires glossary inspection only.

Expected behavior:

- Inspect selected prose and existing entries; zero diagnostics do not prove that
  extraction has no candidates or that meanings are coherent.
- Report actual occurrences, proposed definitions and nonoverlapping scope.
- Resolve material meaning from contract and user intent; do not infer authority
  from repeated usage or rewrite normative intent to fit a glossary entry.
- Preserve the separate session's inspection-only policy.
- Keep glossary identity distinct from concept resolution; ignore code literals
  as automatic candidate evidence and preserve unrelated entries.
- Validate authorized edits and refresh native Design input after glossary changes.
- Do not add glossary prose to an independent Implementation worker's three inputs.
