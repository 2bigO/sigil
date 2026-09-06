---
name: sigil
description: Work with Sigil's deterministic semantic-world compiler, managed views, handoffs, returned receipts, and ordinary authored .sigil documents.
---

<!--
@sigil implements integrations/skills/sigil/_module.sigil::SigilSkill::SkillWorkflow interface
@sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationOwnershipWorkflow interface,logic,constraints,cases
-->

# Sigil

Sigil records software intent as authored `.sigil` documents, accepted
assertions, and independently checkable implementation obligations. The fixed
egglog kernel decides closure and evidence sufficiency. Provider output,
receipts, prose, and editor convenience state are untrusted inputs.

## Required workflow

1. Discover the nearest workspace and run:

   ```bash
   sigil check . --format json
   sigil semantic status . --format json
   sigil semantic project . --check --format json
   ```

   Read the accepted world revision, authored-source drift, view inspection,
   and retained artifact identities. `.sigil/views/` contains generated
   companions. It is excluded from authored intent and implementation-source
   discovery even though an editor can open a view explicitly.

2. To change meaning, submit a proposal:

   ```bash
   sigil semantic intent . --text "..." --provider <configured-name> --beam change
   # or: --proposals /path/to/envelope.json
   sigil semantic status . --beam change --format json
   sigil semantic answer . --beam change --fact <exact-fact-id> --value yes|no
   sigil semantic accept . --beam change --format json
   ```

   Inspect every candidate and every deterministic semantic diff. Answer only
   the exact unresolved proposition named by its fact ID. Acceptance requires a
   uniquely selected green world and a fresh authored-source identity. A
   provider supplies hypotheses or question wording; it never supplies a
   verdict, observation, proof, or implementation change.

3. Keep generated views synchronized:

   ```bash
   sigil semantic project . --check --format json
   sigil semantic project . --write --expected-revision <world-revision>
   sigil semantic project . --recover --transaction <transaction-id>
   ```

   Change intent in authored files or through `semantic intent`. Never edit a
   generated view to change meaning. Commit `.sigil/world` and `.sigil/views/`;
   keep `.sigil/cache`, beams, handoffs, runs, and receipt submissions ignored.

4. Prepare the exact external assignment:

   ```bash
   sigil semantic slice . --component <canonical-id-or-name> --format text
   ```

   Retain the handoff ID and policy. Give the slice to the external coding
   workflow. Sigil does not start that workflow, apply patches, select repairs,
   or own its implementation loop.

5. Import returned claims and independently verify the returned snapshot:

   ```bash
   sigil semantic receipts . --handoff <handoff-id> --claims claims.ttl --locations locations.json
   sigil semantic verify . --handoff <handoff-id> --receipts <receipt-id> --format json
   ```

   Claims identify what the external workflow says it changed and where. The
   verifier takes a fresh filesystem snapshot, runs configured host checks,
   native TypeScript 7 analysis, and the same egglog kernel. Report each claim
   outcome separately from overall obligation coverage. Unsupported or opaque
   behavior is yellow; a failed mandatory check is red; operational failure has
   no completed verdict.

## Configuration

Initialize without selecting a proposal provider:

```bash
sigil init .
sigil config set-provider codex . --kind codex --model <model>
sigil config set-provider-default codex .
sigil config migrate . --format json
sigil config migrate . --write --expected-hash <config-hash>
```

`tools.compile` contains deterministic compilation profiles and limits.
`tools.semantic` contains named proposal providers. Names match
`[a-z][a-z0-9_-]{0,63}`. Bundled providers accept only `model`; command
providers require a literal executable and string arguments. No provider is
selected by `init`, and ordinary `compile` never invokes one. Legacy evaluator
fields remain readable for one compatibility release, produce a deprecation
diagnostic, and do not run.

## Authored syntax and inspection

Use these commands for authored documents and read-only inspection:

```bash
sigil parse path/to/file.sigil --format json --pretty
sigil check path-or-workspace --format json --pretty
sigil fmt path-or-workspace --check
sigil retrieve path-or-workspace --component Name --purpose semantic --format markdown
sigil context path-or-workspace --component Name --format markdown
sigil graph path-or-workspace --format json --pretty
sigil glossary path-or-workspace --format json --pretty
```

Authored source keeps its existing imports, ranges, concepts, ownership
annotations, and literal blocks. Syntax/LSP features can inspect a managed view
as a generated document, but its bytes and receipt are documentary metadata.

## Authority and exits

The compiler owns parsing, canonical identity, world freshness, fixed egglog
rules, and evidence sufficiency. A receipt cannot close an obligation by itself.
Human approval for deployment or other product actions remains outside Sigil.

For unresolved intent, ask one primary semantic question at a time and preserve
the exact proposition identity. Inspect governing Sigil before authoring or
changing an authored contract. Human approval for deployment and product
actions remains outside Sigil; a compiler result is not authorization. State
whether glossary extraction is required, deferred, or inspection-only when that
choice affects the authored workflow.
Ask one primary decision at a time when a material proposition is unresolved.

Inspect governing Sigil before every implementation mutation. Do not implement merely because the user requested an outcome or a
check passed. This is a context and scope check for the external workflow, not
a compiler review gate or a substitute for independent verification.
Always state whether glossary extraction is
   required, deferred, or inspection-only.

Exit code `0` is a completed green operation, `1` is a completed red/yellow
result or drift inspection, `2` is invalid usage, `3` is an operational/runtime
failure, and `130` is cancellation. Cached reports never override a changed
world, source, policy, receipt, view, or runtime.

## References

Read only the reference needed for the current operation:

- `references/workspace-bootstrap.md` for root discovery and initialization.
- `references/sigil-format.md` and `references/authoring-conventions.md` for
  authored syntax.
- `references/greenfield-design.md` and `references/brownfield-adoption.md` for
  the two authored-boundary starting points.
- `references/design-intake.md` and `references/design-conversation.md` for
  unresolved human decisions.
- `references/design-compilation-review.md` for compiler-owned design evidence.
- `references/implementation-design.md` for host policy, code bindings, and
  independent observations.
- `references/frontend-surface-review.md` when a boundary describes a user
  interface.
- `references/compilation-execution.md` for ordinary JSONL compile lifecycle.
- `references/glossary-workflow.md` for reviewed vocabulary.
- `references/external-guidance-evidence.md` and
  `references/standards-review.md` for bounded external evidence.

Do not edit globally installed skill copies. Update the repository-owned skill,
its compatibility metadata, and its eval fixtures together.
