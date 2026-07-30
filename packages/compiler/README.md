# @qoherent/sigil-compiler

Agentic, profile-scoped evaluation for Sigil workspaces.

This package owns compilation reports, event streaming, evaluation profiles, and
code-agent adapters. It never modifies the selected workspace. Evaluation skills
are loaded from their packaged `SKILL.md` and `compile.json` files.

Agentic stages pass the workspace root and selected target to the agent, which
inspects Sigil and implementation files directly inside an ephemeral, offline,
read-only sandbox. Repository contents are not serialized into the initial
prompt. The report retains structured command and usage traces, not hidden
reasoning or complete file contents.

CompilationReport version 2 attaches a required `semanticSubjects` array to
every diagnostic. Compiler-verified subjects identify the governing Sigil
component, component or expand owner, section, optional concept, and optional
normalized semantic-unit fingerprint. Physical source locations remain available
for editors and evidence display.

Codex currently provides the enforceable direct-read capability mapping. Claude
configuration fails closed until its installed CLI can prove equivalent
read-only workspace and ephemeral-state controls. Compilation does not generate
code or execute implementation experiments.

Run a complete profile or one stage plus its dependency closure:

```sh
sigil compile .
sigil compile semantic-readiness .
sigil compile architecture-design . --component SigilCompiler
```

An exact stage identifier in the first operand position selects a stage. Prefix
a colliding path with `./` to treat it as a path.

Execution budgets have safe built-in defaults and may be increased or reduced
for a workspace under `tools.compile.budgets`:

```json
{
  "tools": {
    "compile": {
      "budgets": {
        "elapsedTimeMs": 180000,
        "maxCommands": 64,
        "maxCommandOutputChars": 500000,
        "maxInputTokens": 200000,
        "maxOutputTokens": 200000
      }
    }
  }
}
```

Every value must be a positive integer. The compiler validates hard safety
ceilings before starting an evaluator.
