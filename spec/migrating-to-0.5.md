# Migrating To Sigil 0.5

Sigil 0.5.0 adds the optional free-form `decisions` expand section for durable
rationale behind material selected choices.

1. Upgrade `@qoherent/sigil-core`, `@qoherent/sigil`,
   `@qoherent/sigil-lsp`, the VS Code extension, and the Sigil skill to
   compatible 0.6 releases.
2. Set `sigilVersion` to `0.5.0` in every independent workspace's
   `.sigil/config.json`.
3. Run `sigil version . --format json --pretty` and confirm that CLI, core, and
   workspace versions are compatible.
4. Run `sigil check . --format json --pretty` and resolve all error diagnostics.
5. Keep binding rules, policies, architecture choices, ownership rules, and
   technology choices in `constraints`.
6. Add `decisions` only when durable rationale would help review, maintenance,
   or future agent sessions.
7. Treat the section body as Facets. Concept blocks and labeled fields are not
   required; ungrouped and mixed Facets are valid without grouping warnings.
8. Record the choice and scope clearly. Use a Concept ID only when it provides
   useful cross-contract grouping, not as a required decision wrapper.
9. Use `Scope` to state the governed boundary and important exclusions without
   enumerating every current dependent.
10. Add `Assumptions`, `Trade-offs`, `Design issues addressed`,
    `Discarded alternatives`, `Consequences`, and `Revisit when` when
    materially applicable. Omit inapplicable labels.
11. Reuse an accessible public concept identifier when a contextual decision
    concerns the same semantic idea. The occurrence remains local to the
    consumer and does not make either decision transitively binding.
12. Select a provider and its matching expands explicitly when its private
    decision rationale matters; imports expose public concepts but not private
    `decisions` content.
13. Keep prompts, raw session transcripts, hidden reasoning, responsibility,
    accountability, approver, and handoff metadata outside the initial
    convention.

Tools supporting earlier language versions reject a workspace configured for
0.5.0 rather than silently reinterpreting it.
