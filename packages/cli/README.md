# sigil-cli

Current package version: **0.7.1**.

Command-line interface for agents, CI, scripts, and platform debugging.

The CLI is not the primary human authoring experience. Humans may use it early
for checks and generated artifacts, but editor integrations should become the
main human UI.

Package docs:

- [spec.md](spec.md): version 0.7 CLI requirements, command behavior, output
  contracts, and acceptance scenarios.
- [architecture.md](architecture.md): command architecture, module boundaries,
  dependency rules, and implementation guidelines.

Install a standalone GitHub release on macOS or Linux:

```bash
curl -fsSL https://github.com/qoherent/sigil/releases/latest/download/install.sh | sh
```

Install on Windows PowerShell:

```powershell
irm https://github.com/qoherent/sigil/releases/latest/download/install.ps1 | iex
```

Alternatively, install the published JSR package when Deno is available:

```bash
deno install --global --allow-read --allow-write --allow-env=HOME,USERPROFILE --name sigil jsr:@qoherent/sigil@0.7
```

Local development install:

```bash
deno task install
```

This installs a `sigil` command that can be discovered on `PATH`.

Implemented responsibilities:

- install version-owned agent skills globally or into a target repository;
- expose parser output;
- run workspace checks;
- report missing interface concept identifiers as actionable warnings;
- produce agent-oriented context packs;
- render Markdown for review and documentation workflows;
- keep CLI behavior thin over `sigil-core`.

Commands:

- `sigil --help` reports top-level help, while `--help` after any recognized
  command or subcommand reports help scoped to that command path;
- `sigil skill list` reports bundled directories containing `SKILL.md`;
- `sigil skill install` installs skills globally for Codex, Claude Code,
  OpenCode, and Pi;
- `sigil skill install --project` installs into the current repository;
- `sigil skill install --agent <name>` limits installation to one agent;
- `sigil init [path]` creates a config and, when absent, a glossary seeded only
  with the eight agent-context-excluded, colon-qualified decision-record field
  labels; it never overwrites either file;
- `sigil version [path]` reports tool and configured contract versions;
- `sigil parse <path>` returns parsed JSON;
- `sigil check [path]` returns diagnostics; add `--format text --show-locations`
  to append each diagnostic's file path, line, and column to the text output
  (default text output and JSON are unchanged without the flag);
- `sigil glossary [path]` reports reviewed entries, resolved contexts, and
  source occurrences;
- `sigil graph [path]` returns component and import graph data;
- `sigil context ...` returns agent context JSON with direct dependencies'
  public contracts and decision rationale plus reviewed terminology recognized
  in the selected and related Sigil files, excluding terms whose `agentContext`
  value is `false`;
- `sigil retrieve [path] (--component name | --file file) --purpose
  semantic|architecture|implementation`
  returns a deterministic selected graph, exact evidence, inclusion reasons,
  exclusion frontier, aggregated context, and a content fingerprint; add
  `--format markdown` for a readable context pack;
- `sigil compile [stage] [path] [--component name | --file file
  [--position line:column]]`
  runs deterministic structural and semantic evaluation. A stage
  operand such as `semantic-closure` runs that stage and its dependency
  closure. Prefix a colliding path with `./`. Use `--format jsonl` for the
  versioned event stream;
- `sigil render ...` returns Markdown.

Compilation uses a fixed egglog kernel. Source clauses without a semantic
interpretation remain yellow. Red means a hard violation; green means the modeled
required obligations are closed. Model providers do not participate in compilation.
Use `--focus design` for semantic closure and `--focus implementation` for coverage
obligations. The legacy stage names remain aliases for these deterministic stages.

In a source checkout, build the native engine with `deno task build:semantic` before
compiling. Standard and critical-system profiles need no evaluator configuration.
`tools.compile.budgets.elapsedTimeMs` bounds native execution; the engine also has
its own timeout and fixed IPC limits. Existing evaluator configuration remains
readable for compatibility but cannot provide a compilation verdict.

The semantic workflow accepts natural-language intent and generated Turtle patches:

```bash
sigil semantic intent . --text "The parser must not access disk." --generator /path/to/generator --beam parser
sigil semantic status . --beam parser
sigil semantic answer . --beam parser --fact 'fact:the-returned-id' --value no
sigil semantic accept . --beam parser
sigil compile . --focus design
sigil semantic project . --format sigil
sigil semantic project . --format turtle
sigil semantic slice . --component Parser --format text
```

`--generator-arg` supplies repeatable executable arguments. The generator reads a
prompt from stdin and returns a JSON envelope on stdout. The envelope is transport;
all semantic additions and retractions are ordinary Turtle:

```json
{
  "version": 1,
  "candidates": [
    { "id": "one-interpretation", "additions": "Turtle assertions", "retractions": "" }
  ]
}
```

A generator should return one candidate for clear intent, and several materially
different candidates for consequential ambiguity. Sigil validates the ontology,
computes closure, prunes violations, and ranks the candidates. If an exact
proposition remains unresolved, a second generator call asks for
`{"version":1,"factId":"supplied-id","question":"natural question"}`.
The exact machine proposition remains visible beside the rendered question.
`--proposals path.json` imports a prepared candidate envelope and uses deterministic
question wording, allowing an existing agent harness to supply the hypotheses.

Intent generation saves a named beam of assertions and answers in `.sigil/beams`.
Status and answer replay the kernel. Acceptance requires a uniquely selected green
world, unchanged source contracts, and an unchanged canonical-state receipt. It
writes immutable lossless `.egg` assertions under `.sigil/world/<revision>` and
atomically updates `.sigil/world/current.json`; it preserves existing source files.
Commit `.sigil/world` and the verifier policy. Receipt submissions, handoffs, runs
and caches are ignored by the generated `.sigil/.gitignore`. Previous
`semantic.json`/`worlds` state remains readable until the next acceptance migrates
the active state. A later source edit
invalidates the saved interpretation until new intent is accepted.

`project` exports normalized Turtle paired with a parser-validated human Sigil view
as JSON by default; `--format sigil` and `--format turtle` select one view.
`slice` returns only the selected component's implementation duties, exclusions,
related contracts and coverage obligations. It retains an ignored
`.sigil/handoffs/<id>` bundle with the retained `world.egg`, focused
`assertions.egg` and `handoff.json`. Slice export requires host bindings in
`.sigil/implementation.json`. The handoff records the complete boundary obligation
set, fact identities, baseline code, protected inputs and verifier identities.
JSON includes `artifacts.handoff` and the handoff manifest; text includes the
bundle path. `--format egg` or `--format turtle` exports scoped assertions.
Retain the handoff ID independently of the coding agent's returned files.
`project` writes only to stdout.
Implementation green still requires mechanically established coverage; a passing
model judgment or an implementation anchor does not establish it.

Unless `--no-cache` is set, completed compile reports are cached outside the
workspace for diagnostic lifecycle comparisons. JSONL compilation emits one
terminal completed, failed, or cancelled event. Compilation and semantic search
return 0 only for green, 1 for unresolved intent or semantic errors, 2 for invalid
usage, 3 for operational failures, and 130 for cancellation.

Run package tests with `deno task test`. Native binary release packaging and
bundled provider protocol adapters are being migrated; the source workflow above
uses the local native build and the provider-neutral executable protocol.

For TypeScript implementation verification, create `.sigil/implementation.json`
with host-owned code bindings. For example:

```json
{
  "version": 1,
  "project": "tsconfig.json",
  "components": [
    {
      "entity": "urn:sigil:component:main.sigil:Application",
      "files": ["src/application.ts"],
      "exhaustive": true
    }
  ],
  "targets": [
    {
      "entity": "urn:example:Bridge",
      "declarations": [{ "file": "src/bridge.ts", "symbol": "bridge" }]
    }
  ]
}
```

Use the actual entity identifiers from `semantic project`. Files are exact paths
relative to the workspace; `exhaustive` is a host assertion that the inventory
contains the component's entire implementation. Target selectors can also use
`modules` (literal module names) or `globals` (unshadowed global API paths), with
optional `access: "reads"` or `"writes"` for a host API catalog.

`sigil semantic verify .` runs native TypeScript 7 and egglog and returns JSON with
status, coverage derivations, documentary Turtle and source receipts.
`--format turtle` exports just the evidence RDF; the exit code still reflects
verification status. Completed stages and reports are retained in ignored
`.sigil/cache/<id>` and `.sigil/runs/<id>` bundles. JSON includes their IDs in
`artifacts`. Ordinary `sigil compile` records the same artifacts and uses the
collector for implementation focus when the policy exists. Every verification
collects evidence and recomputes coverage; persisted results cannot establish
current proof. Keep verifier policy and test oracles fixed during the external
coding agent's implementation.

Run `sigil semantic artifacts .` to initialize artifact directories and the scoped
`.sigil/.gitignore` before accepting a world. Acceptance, slice export and compile
also initialize them when needed. Commit accepted `.sigil/world` revisions and
authoritative policy; keep submitted receipts and operational artifacts ignored.
`--no-cache` controls diagnostic history outside the workspace; it does not
disable target-codebase artifact recording.


The implementation policy may also contain `protectedFiles` and `checks`:

```json
{
  "protectedFiles": ["tests/oracles.txt"],
  "checks": [
    {"id": "parser-cases", "command": "deno", "args": ["test", "tests/parser.ts"], "files": ["tests/parser.ts", "tests/oracles.txt"]}
  ]
}
```

These fields extend the policy shown above. Checks need unique IDs and exact
protected oracle files. Their declaration adds a mandatory obligation; until the
host check runner is integrated, ordinary verification leaves these checks yellow.
A declaration is never a passing result. Handoffs protect Sigil specifications,
configuration and lock files, plus explicit oracles. Data files explicitly bound
as component implementation may change; known configuration remains protected.

Import returned receipts with:

```bash
sigil semantic receipts . --handoff <retained-id> --claims /tmp/claims.ttl --locations /tmp/locations.json
```

Use `--handoff-root <original-workspace>` when the returned checkout is elsewhere.
Claims use `Evidence`, `covers`, `from`, `relation`, `target` and optional `expected`
(default true). `covers` names an exported obligation URN or a fact ID associated
with that exact proposition. A negative claim must specify `expected false`.
The location sidecar has this shape:

```json
{
  "version": 1,
  "handoff": "<retained-id>",
  "receipts": {
    "urn:receipt:one": {
      "locations": [
        {"file": "src/parser.ts", "fingerprint": "<file-sha256>", "symbol": "parse"}
      ],
      "tests": ["parser-cases"]
    }
  }
}
```

Receipt import rejects invented references, mismatched propositions, conflicting
claims, duplicate sidecar keys and unsafe paths. It stores assertion-only `.egg`
and location metadata in ignored `.sigil/receipts/<id>`. Its successful output
marks the claims `untrusted` and contains no verification verdict. Suggested
symbols and tests still require independent resolution and execution; receipt
witness matching in egglog is the next implementation step.
