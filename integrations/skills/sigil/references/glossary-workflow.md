# Reviewed Glossary Workflow

Use this procedure after every approved `.sigil` write or semantic edit, when
`.sigil/glossary.json` exists, when the user asks to create or maintain project
vocabulary, or when terminology ambiguity materially affects Sigil design or
review.

The glossary is reviewed authority. Deterministic tools inspect accepted entries
and occurrences; a model may extract candidates and identify semantic conflicts
but cannot make inferred language authoritative.

## 1. Inspect Deterministic State

After writing approved Sigil, always run:

```bash
sigil glossary . --format json --pretty
sigil check . --format json --pretty
```

Inspect:

- whether GlossaryFile is absent, valid, or invalid;
- workspace terms and bounded-context terms;
- file-path glob resolution;
- accepted aliases;
- resolved source occurrences;
- context overlap and spelling-collision diagnostics.

When GlossaryFile is invalid, accepted definitions are inactive. Propose an
exact repair before relying on its entries.

An absent GlossaryFile is valid deterministic state. Continue with candidate
extraction from the changed semantic lines rather than skipping this workflow.

## 2. Preserve Authority

An approved normative Sigil contract governs when its wording conflicts with a
glossary definition. Report the affected contract lines and glossary entry and
propose correcting GlossaryFile.

Do not:

- infer approval from repeated usage;
- automatically create or rewrite entries;
- treat an extracted candidate as accepted vocabulary;
- turn an unknown word into a deterministic missing-term diagnostic;
- equate glossary terms with Sigil concept identifiers;
- use glossary definitions to override component or concept resolution.

## 3. Extract Candidates

Initial extraction examines free-form prose in loaded `.sigil` documents only.
Exclude structural syntax, concept identifiers, imports, code fences, inline
code, and URLs.

Prefer candidates that are:

- domain-specific or project-specific;
- repeated across components or expands;
- used with materially different possible meanings;
- abbreviated, aliased, or easily confused;
- important to a public contract, state, policy, lifecycle, or acceptance case.

Do not propose ordinary English or language syntax merely because it occurs
frequently.

After an approved Sigil mutation, begin with its changed semantic lines and
inspect enough surrounding component, expand, and glossary occurrences to
determine whether each candidate meaning is coherent.

For every candidate collect:

- exact spelling and relevant variants;
- source file, component or expand, section, line, and occurrence text;
- the meaning supported by each occurrence;
- whether occurrences agree, conflict, or remain ambiguous;
- existing accepted entries that may already cover the idea.

When occurrences support incompatible definitions, present a focused review
question. Do not synthesize one definition that hides the conflict.

Block Sigil review and implementation only when an undefined, conflicting, or
incorrectly scoped term could materially alter behavior, ownership, state, APIs,
or implementation. If no material candidate exists, record that result and
continue to the Sigil review gate.

## 4. Select Scope

Recommend workspace scope when one reviewed meaning applies throughout the
workspace.

Recommend a bounded context when the meaning is intentionally limited to a
coherent path-owned domain and may differ elsewhere.

For a bounded context:

- propose a stable context identifier;
- propose workspace-relative include and exclude globs;
- check every loaded source for overlap with existing contexts;
- explain why the path boundary matches semantic ownership;
- avoid broad globs that create accidental precedence.

A context entry may intentionally replace a workspace spelling only inside that
context. State that consequence explicitly in the proposal.

## 5. Present The Exact Proposal

For each proposed addition, replacement, alias change, scope move, or removal,
show:

- canonical term;
- concise reviewed definition;
- optional aliases;
- workspace or bounded-context scope;
- supporting source occurrences;
- conflicts or uncertainty;
- rejected spellings, definitions, or scopes;
- the exact JSON change.

Classify the proposal as:

- `new candidate`;
- `definition clarification`;
- `alias change`;
- `scope change`;
- `normative conflict repair`;
- `removal`.

Ask the user to approve, reject, or revise the exact JSON. Leave repository
files unchanged while awaiting approval.

## 6. Apply And Review

After explicit approval:

1. write only the accepted JSON change;
2. preserve strict schema version 1 structure;
3. run `sigil glossary . --format json --pretty`;
4. run `sigil check . --format json --pretty`;
5. inspect changed context resolution and occurrences;
6. return to the Sigil review gate and stop for human review.

Do not continue into unrelated Sigil or implementation changes merely because
the glossary validates.

## 7. Prepare Coding Context

Before implementation, run `sigil context` for the selected component or file.
Make its `glossaryContext` available to the coding agent together with the
approved Sigil contract.

The scoped projection contains accepted definitions recognized in the selected
component or file and its related expansion sources. Preserve canonical terms,
definitions, aliases, resolved bounded contexts, and occurrences. Do not replace
Sigil behavior with glossary prose.

Compare material vocabulary in the implementation request with accepted
spellings reported by `sigil glossary`. If a request term is accepted but does
not occur in the selected Sigil sources, add only that matching entry to the
handoff. Do not inject the complete unrelated workspace glossary.

## 8. Deferred Scope

Markdown and other document adapters are deferred from the initial workflow. Do
not claim their terms were scanned or kept coherent until deterministic document
support is introduced and reviewed.
