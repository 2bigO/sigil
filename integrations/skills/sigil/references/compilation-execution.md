<!-- @sigil implements integrations/skills/sigil/compilation-execution.sigil::SigilCompilationExecution interface,logic,constraints -->

# Shared Compilation Execution

Use this procedure for every ordinary design or implementation compilation. It
owns invocation, fresh Markdown output isolation, process-exit handling, and
retry policy; the calling workflow owns target selection and focus-specific
interpretation.

## Run And Read

Reserve and record a task-scoped temporary directory with `mktemp -d`. For each
attempt, choose a unique Markdown report path inside it and verify that the path
does not exist before invocation. Keep the path outside the workspace so report
generation does not mutate the implementation scope. Preserve stderr and the
command exit status through review completion.

Run the selected target with the agent profile:

```bash
sigil compile <workspace-root> --agent --focus <design|implementation> <target-selector> --format markdown --output <fresh-report-path>
```

`--agent` selects the effective `tools.agent.profile`. Do not combine it with
`--profile`. Compiler sessions remain available only for an explicitly requested
exceptional diagnostic investigation.

Wait without cancelling or replacing the run until the compiler process exits.
Do not listen to, parse, capture, or recover a JSONL event stream. Stdout,
partial progress, silence, a slow response, and passing tests are not completed
compilation evidence.

Accept the attempt as completed only when both conditions hold:

- the process exits with code `0` or `1`; and
- that attempt's fresh report path is a readable, nonempty file.

Read the report from that file and pass it to the calling workflow with the exit
status. The Markdown is a compiler-owned review projection of the completed
report, not the machine-readable authoritative schema. Use its `Status` and
findings for the immediate review decision. Exit `1` is not itself an
operational failure because completed yellow and red reports use it.

## Process Outcomes

- Exit `0` or `1` with a valid fresh report: return the completed green, yellow,
  or red report without automatic retry.
- Exit `2`: correct the invocation defect before compiling again. An identical
  retry cannot repair invalid arguments.
- Exit `3` or another abnormal termination: preserve stderr and exit status,
  then retry the identical frozen target once after the process exits.
- Exit `130`: preserve cancellation evidence and exit status. Retry only after
  the cause is resolved or the user explicitly requests another run.
- Missing, unreadable, or empty output after exit `0` or `1`: classify the
  attempt as incomplete and retry the identical frozen target once.

Never accept an output artifact paired with exit `2`, `3`, `130`, or another
abnormal exit, even if a file exists. Never reuse a report path across attempts;
this prevents stale or partially settled output from becoming evidence.

## Retry Rule

Retry only after the first process exits. Preserve both attempts' report paths,
stderr, and exit statuses. The retry uses the same workspace root, source
snapshot identity, focus, target selector, resolved effective profile, and
material command arguments; only its required fresh output path differs. It is
not a replacement scope or a new interpretation. If those inputs cannot be
frozen, report the host failure rather than claiming an identical retry. Do not
retry a usage error or cancellation automatically.

If the second attempt still lacks completed-report evidence, report both
attempts and block the calling workflow. Never classify incomplete output as
red, yellow, or green evidence.
