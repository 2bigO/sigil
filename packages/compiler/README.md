# @qoherent/sigil-compiler

Agentic, profile-scoped evaluation for Sigil workspaces.

This package owns compilation reports, event streaming, evaluation profiles, and
code-agent adapters. It never modifies the selected workspace. The initial
release supports deterministic checks and read-only Codex, Claude, and mock
evaluation. It does not generate code or execute implementation experiments.
