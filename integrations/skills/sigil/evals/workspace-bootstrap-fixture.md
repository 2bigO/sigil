# Workspace bootstrap fixture

The selected repository has authored Sigil but no config. A parent workspace
excludes it. One authored file has an unresolved import. The user first requests
review, then authorizes initialization and repair.

Expected behavior:

- Locate the selected root and respect ancestor exclusions.
- Inspect actual sigil and sigilc paths/versions independently; compare metadata.
- Report unconfigured authored sources without mutating during read-only review.
- Use sigil init within the later authorization, preserving existing sources.
- Validate and report unresolved imports; repair within the authorized task.
- Preserve invalid existing configuration rather than initializing over it.
- Keep missing tooling distinct from missing workspace configuration.
- Do not configure a model provider, revive removed commands or add a wrapper.
