<!-- @sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::FrontendSurfaceReview interface,logic,constraints,cases -->

# Frontend Surface Review

Load this reference whenever the selected boundary renders a user interface:
screens, routes, views, reusable components, design-system primitives, client
state stores, or styling that carries contract meaning.

It owns how a presentation boundary is inventoried, summarized, and kept
current. It does not replace `references/implementation-design.md`; it supplies
the frontend-specific evidence that coverage selection needs.

## Contents

1. Inventory the surface
2. Locate the real owners
3. Classify state by owner
4. Summarize one surface
5. Cover and annotate
6. Detect drift

## 1. Inventory The Surface

Establish the map before summarizing any single component. A frontend boundary
is not readable one file at a time, and file counts are not evidence.

| Evidence | What it establishes |
| --- | --- |
| Router configuration or route table | The authoritative screen list |
| Application entry and mount points | Composition root and provider scope |
| Component directory plus import graph | Containment and reuse |
| Store, query, or context modules | Cross-surface state owners |
| Design token, theme, or variable files | The shared visual contract |
| Stories, snapshots, and interaction tests | Intended contract, often stated more exactly than the component itself |

Report the inventory before proposing contracts:

| Route | Screen | Owns data | Child surfaces | Governing Sigil |
| --- | --- | --- | --- | --- |

Prefer deterministic retrieval for the Sigil column. Use `sigil context` for a
selected component and `sigil graph` when containment or reuse matters.

## 2. Locate The Real Owners

Frontend responsibility hides in places a backend-shaped inspection does not
check.

| Where behavior hides | What to inspect |
| --- | --- |
| Container and presentational split | Which one performs input, output, or navigation |
| Hooks, composables, and mixins | Shared interaction logic with its own contract |
| Store or context modules | Cross-surface state and its invariants |
| Router guards and loaders | Authorization, redirection, and data preconditions |
| Form schema or validation config | The validation contract |
| Design tokens and theme layers | Visual contract shared across surfaces |
| Slots, children, and render props | Inversion of control that belongs to the parent contract |

A file is not a component. Ask whether another surface could depend on the
concern without knowing its internals. If yes, prefer a component; if it only
explains how one owner renders, prefer an expand.

## 3. Classify State By Owner

Unowned client state is the most common frontend readiness gap. Name exactly
one owner for each piece of state.

| State class | Owner | Placement |
| --- | --- | --- |
| Ephemeral interaction such as hover, focus, or open | The component itself | Usually omitted |
| Surface mode such as loading, empty, error, or success | The screen or surface | `state` |
| Cross-surface session or application state | A store component | `state` on the store |
| Server cache and its freshness | The data-access component | `state`, with invalidation in `logic` |
| Derived value | No owner; it is a function | `logic` |
| URL, route, and query parameters | The router boundary | `interface` |

Record which surfaces may write each piece of state. More than one writer is a
decision that belongs in `decisions`, not an accident to reproduce.

## 4. Summarize One Surface

Public half, in `component`:

- props, inputs, slots, emitted events, and callbacks;
- visible regions, content hierarchy, actions, and feedback;
- navigation into and out of the surface.

Private half, in `expand`:

- `state` for meaningful surface modes;
- `logic` for interaction, transitions, async sequencing, optimistic updates,
  and focus movement;
- `constraints` for accessibility, responsive, ownership, and binding decisions;
- `cases` for observable scenarios per mode.

Treat asynchrony as contract rather than mechanism. For every request a surface
issues, state its loading, empty, error, retry, stale, and cancelled behavior.
Missing async cases are a semantic-readiness gap even when the component
renders correctly today.

Treat accessibility statements as contract rather than style: keyboard
operation, focus order, roles and labels, live-region announcements, reduced
motion, and target size.

Wireframes, repository images, and design links are free-form interface
content, not special syntax. Report an inaccessible image or design link
instead of inferring what it showed.

## 5. Cover And Annotate

Presentation sources carry ownership annotations on the same terms as any other
implementation artifact.

| Source | Comment form | Binds to |
| --- | --- | --- |
| `.ts`, `.js`, `.tsx`, `.jsx` | `//`, or `/* */` for several annotations | The adjacent definition |
| `<script>` in `.vue`, `.svelte`, `.astro` | `//`, or `/* */` for several annotations | The adjacent definition, otherwise the file |
| Template markup, `.html` | `<!-- -->` | The file |
| `.css`, `.scss`, `.sass`, `.less` | `/* */`, and `//` in Sass or Less | The file |

Place a surface annotation in the script region when it has a definition to
attach to, and in the template otherwise. Annotate a stylesheet only when it
carries a shared visual contract rather than local presentation.

Build the implementation coverage map from `references/implementation-design.md`
using the inventory above as its concern list, so an uncovered screen, store, or
shared primitive appears as missing coverage rather than as an absent file.

## 6. Detect Drift

Frontend drift surfaces in different evidence from backend drift.

| Signal | Likely finding |
| --- | --- |
| A prop or emitted event exists in code but not in `interface` | Undocumented public contract |
| Markup renders a mode absent from `state` | Missing surface mode |
| One store is written from several surfaces | Unowned state |
| Accessibility attributes in code, absent from `constraints` | Unrecorded accessibility contract |
| Token or color literals duplicated across surfaces | Shared visual contract not modeled |
| A design link or screenshot newer than its contract | Unreviewed visual change |
| A route with no governing Sigil | Coverage gap in the screen inventory |

Classify each signal as observed behavior, documented intent, or suspected
accident before reporting it, and use the provisional assessment language
required by `references/standards-review.md`.

## Limits

- Do not model passive markup, layout wrappers, or per-element styling.
- Do not create one component per visual element, hook, or stylesheet.
- Do not infer intent from class names, file names, or directory shape.
- Reuse a design-system primitive's existing contract instead of restating it
  on every screen that consumes it.
