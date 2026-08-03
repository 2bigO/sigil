<!-- @sigil implements integrations/skills/sigil/design-compilation-review.sigil::SigilDesignCompilationReview::DesignCompilationReview interface,state,logic,constraints,cases -->

# Compiler-Driven Design Review

Use this procedure after design intent and applicable external guidance are
sufficiently resolved. It consumes compiler-owned semantic-readiness and
architecture-design evaluation as provisional evidence. It never approves a
Sigil mutation or implementation.

## Select The Scope

Select the nearest configured workspace that imports the affected Sigil file.
Use `sigil graph` or `sigil context` from that module index when imports,
expands, or consumers affect the report. Prefer an exact component target; use
a file or location target when the declaration identity is not yet stable.

## Evaluate Unwritten Candidates

Start one owner-private, OS-temporary proposal session. No daemon is involved:

```bash
sigil compile session start <workspace-root> --focus design --component <name>
```

The result identifies the session, base epoch, base fingerprint, and expiry.
Submit each complete candidate override set as one JSON object on standard
input:

```json
{"sources":{"path/to/component.sigil":"complete resulting source text"}}
```

```bash
sigil compile session evaluate <session-id> --format jsonl
```

Every proposal is complete relative to the immutable base epoch, not a delta
from the prior proposal. Keep omitted base sources unchanged. Use `refresh`
only when selected workspace evidence intentionally changed, and `close` when
review ends:

```bash
sigil compile session refresh <session-id>
sigil compile session close <session-id>
```

## Interpret Evidence

- Red is not reviewable for mutation. Investigate and revise the candidate.
- Yellow is reviewable only after the human explicitly reviews every finding
  and accepts each one as nonblocking for the exact scope.
- Green means the exact proposal generation passed the exact design focus and
  profile. It is evidence, not approval.

Return confirmed material problems to DesignConversation. Do not duplicate the
compiler's semantic-readiness or architecture-design judgment in a second
host-generated status. The host still owns external-guidance applicability,
finding disposition, design decisions, concept grouping, glossary extraction,
and ReviewGate.

Evidence submitted to `ReviewGate(action: sigil-change)` identifies the exact
session, generation, base epoch, base and proposal fingerprints, target,
profile, focus, completed stages, report status, and every yellow disposition.

## Validate Written Sigil

After an approved proposal is written, rerun deterministic validation and
compile the written source:

```bash
sigil check <workspace-root> --format json --pretty
sigil compile <workspace-root> --focus design --component <name>
```

Written evidence must be green or explicitly reviewed yellow before concept
grouping, glossary extraction, or implementation review. Any semantic edit or
grouping change invalidates the prior report and requires a new generation or
written compilation.

An unavailable, incomplete, or red compiler result blocks semantic mutation
review. An unresolved yellow finding also blocks it. Session expiry, ownership
failure, target ambiguity, or snapshot change is reported explicitly and never
bypassed by evaluating a different untracked source copy.
