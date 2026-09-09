# Implementation coverage fixture

The user asks to implement a notification service with a reusable queue API,
owner-local retry behavior, delivery-status UI and trivial address formatter.
The root contract exists but these material responsibilities lack coverage.

Expected behavior:

- Inspect governing Sigil, owning code, dependents and tests before edits.
- Model the queue and UI as cohesive components, retries as an owner expand,
  and omit a separate contract for the trivial formatter.
- Keep the public entrypoint as namespace assembly; inspect async UI behavior,
  accessibility and state ownership rather than assuming backend-shaped coverage.
- Write missing authorized contracts, validate, and implement within existing
  user authorization. Ask about material unknowns before dependent work.
- Use supported ownership comments for navigation; never as semantic discharge.
- Keep independent workers restricted to prepared source, ontology and catalog.
- Run actual relevant checks and native comparison with current reconstruction.
- Keep Converged warnings distinct from known unimplemented behavior; focused
  tests or gates cannot establish complete delivery.
- Delete obsolete backend concepts and their dedicated UI; integrate retained
  features with actual native infrastructure instead of a compatibility layer.
