# Concept grouping and native Facet fixture

An authorized contract edit covers three authoring situations. The agent should
recognize useful semantic grouping without treating ungrouped content as broken.

## Small component

A small Lookup component describes one operation through ungrouped Interface,
Logic, Constraint, and Case Facets. Its meaning is clear and the requested edit
does not introduce another concept.

Expected behavior:

- Preserve the direct Facets and their contract roles.
- Do not add a Lookup Concept wrapper merely to repeat the component identity.
- Do not describe ungrouped Interface content as a warning, defect, or migration
  requirement.
- Preserve public identifiers defined within Interface Facets; exports do not
  require a Concept block.

## Several concepts in one component

A SearchPanel component describes request lifecycle, result selection, and
publication authority. Related Facets occur across Interface, State, Logic,
Constraints, Decisions, and Cases. Some useful grouping is already authored;
other relationships need clearer organization. An accessible imported Concept
matches one of those meanings. A direct consumer uses a similar but inaccessible
local name.

Expected behavior:

- Actively identify the distinct concepts and recommend useful cross-contract
  grouping. Optional syntax is not a reason to leave meaningful structure hidden.
- Inspect local occurrences, matching expands, and accessible imports before
  proposing identifiers. Preserve existing coherent groups.
- Reuse the matching accessible public identity; treat inaccessible consumer
  terminology as naming evidence, not reusable identity.
- Introduce local Concept IDs for distinct meanings when they improve the
  connections. Do not create a new component merely to name a Concept.
- Preserve provider identity and consumer contribution context without importing
  private Facets or rewriting provider behavior upstream.
- Check authored identifiers for flat, nonempty blocks, valid syntax, accessible
  uniqueness, and ambiguity. These rules govern chosen identifiers, not a
  requirement to invent one for every Facet.

## Mixed ordinary and Embedded Facets

A contract contains an ungrouped promise, a Concept block reused in another
contract, an ungrouped Embedded Facet with introducing prose and a Mermaid
body, and another ordinary Facet. Blank lines and braces occur inside the fence.

Expected behavior:

- Preserve grouped and ungrouped Facets together in source order without
  requiring regrouping.
- Treat the introducing prose and fenced content as one Embedded Facet. Internal
  blank lines do not create additional Facets.
- Use Facet and Embedded Facet as the native language terms. Fenced
  EmbeddedContent is the payload, not the whole authored contribution.
- Preserve the enclosing contract's role; a code or diagram label does not turn
  Design material into executable production evidence.
- Distinguish an ordinary newline from the empty line ending an ordinary Facet.

## Scope and authority

Only authorized edits may be written. Grouping recommendations are not user
approval or behavioral equality proofs. Refresh affected native Design inputs
when the available workflow calls for them; unavailable reconstruction must be
reported honestly, not used to force redundant Concept wrappers. Cases remain
scenarios whether or not a test exercises them.
