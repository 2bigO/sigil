# Frontend surface fixture

A repository contains a web client with a router configuration declaring five
routes, a components directory of forty files, one store module, a theme file of
colour and spacing tokens, and interaction stories for two components. Two
screens are rendered by a shared generic list component and have no file of
their own. A modal open flag, a signed-in session flag, and a cached search
result all live in the same store. The design system already declares a
`Button` contract that three screens restate in their own Sigil. The user asks
a coding agent to summarize the frontend and keep it current, and points at a
Figma link the agent cannot open.

Expected skill behavior:

1. Establish the surface inventory before summarizing any single surface, and
   do not review the components directory one file at a time.
2. Derive the authoritative screen list from router configuration, entry and
   mount points, the component import graph, store modules, design token files,
   and interaction stories rather than from file counts.
3. Report the inventory as routes, screens, data ownership, child surfaces, and
   governing Sigil, using deterministic retrieval for the governing column.
4. Identify the two routes rendered by the shared generic list component as
   screens in their own right, because a screen without its own file is still a
   surface with a contract.
5. Inspect the container and presentational split to determine which side
   performs input, output, or navigation before assigning an owner.
6. Treat a shared hook or composable with its own relied-upon contract as a
   component rather than as an implementation detail of its first caller.
7. Assign exactly one owner to each class of client state: the modal open flag
   is ephemeral interaction owned by its component, the signed-in session flag
   is cross-surface state owned by a store component, and the cached search
   result is server cache owned by the data-access component.
8. Report more than one writer for a piece of state as a decision that belongs
   in `decisions`, not as an accident to reproduce.
9. State loading, empty, error, retry, stale, and cancelled behavior for every
   request a surface issues, and treat missing async cases as a
   semantic-readiness gap.
10. Treat keyboard operation, focus order, roles and labels, live-region
    announcements, reduced motion, and target size as binding constraints
    rather than presentation preferences.
11. Place a surface ownership annotation in the script region when it has an
    adjacent definition, and in the template region otherwise.
12. Annotate a stylesheet only when it carries a shared visual contract, and
    resolve template markup and stylesheet annotations as file-level targets.
13. Reuse the existing design-system `Button` contract instead of restating it
    on each consuming screen, and report the three restatements as duplicated
    identity.
14. Omit separate Sigil for passive markup, layout wrappers, per-element
    styling, and individual visual elements.
15. Do not infer intent from class names, file names, or directory shape.
16. Report a route with no governing Sigil as a coverage gap in the screen
    inventory rather than as an absent file.
17. Report the colour and spacing literals duplicated across surfaces as a
    shared visual contract that is not modelled.
18. Report the unopenable Figma link as inaccessible evidence instead of
    summarizing the design from its filename or surrounding prose.
19. Classify each drift signal as observed behavior, documented intent, or
    suspected accident before reporting it, and use provisional assessment
    language.
20. Supply the inventory as the presentation concern list for the
    implementation coverage map rather than building a parallel coverage
    process.
21. Present the exact proposed Sigil to `ReviewGate(action: sigil-change)` and
    leave files unchanged until it returns ready.
