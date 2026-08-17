<!-- @sigil implements integrations/skills/sigil/compilation-execution.sigil::SigilCompilationExecution interface,logic,constraints -->

# Shared Compilation Execution

Use this procedure for every ordinary design or implementation compilation. It
owns invocation, durable capture, terminal-outcome handling, and retry policy;
the calling workflow owns target selection and focus-specific interpretation.

## Run And Capture

Reserve and record a fresh task-scoped directory with `mktemp -d`. Capture both
streams in a named per-attempt log there while preserving the command exit
status. Return the attempt log path, exit status, and terminal-event evidence to
the calling workflow. The log is the source of record and must remain readable
if a child evaluator outlives the command-tool response; the calling workflow
owns retention through review completion.

Run the selected target with the agent profile:

```bash
sigil compile <workspace-root> --agent --focus <design|implementation> <target-selector> --format jsonl
```

`--agent` selects the effective `tools.agent.profile`. Do not combine it with
`--profile`. Compiler sessions remain available only for an explicitly requested
exceptional diagnostic investigation.

Wait without cancelling or replacing the run for a terminal event and source
end. `completed` carries the authoritative version-2 CompilationReport;
`failed` and `cancelled` are terminal outcomes without a report. Stage-started
events, partial progress, silence, a slow response, and a passing build or test
are not compilation evidence. A long-running evaluator is still one active run;
do not start a second run while its process or writer remains alive.

If the execution host interrupts the live stream, retrieve and poll the durable
log and, if needed, evaluator process state until the terminal event is present
and its writer has closed. Do not retry solely because the live event was lost.

## Terminal Outcomes

- `completed`: preserve the report and pass it to the calling workflow.
- `failed`: preserve terminal diagnostics, durable capture, and exit status;
  wait for the evaluator process and writer to close, then retry the identical
  target once. If the retry fails, report both attempts and block the workflow.
  A terminal `failed` outcome or a nonzero process exit without a completed
  report is retryable; a completed green, yellow, or red report is returned to
  the calling workflow and is not automatically retried.
- `cancelled`: preserve cancellation evidence, durable capture, and exit status;
  report the known cause and retry the same target only after it is resolved or
  the user explicitly requests another run.
- missing terminal event, unreadable capture, or no established source end:
  wait for process state and restore durable capture. Once the first run has
  definitely ended, retry the identical target once. If the retry cannot reach
  a terminal outcome and source end, report a host or transport failure and
  block the workflow.

## Retry Rule

Retry only after the first process and its output writer have ended. Preserve
both durable captures and exit statuses. The retry uses the same workspace root,
source snapshot identity, focus, target selector, resolved effective profile, and
material command arguments; it is not a replacement scope or a new
interpretation. If those inputs cannot be frozen, report the host failure rather
than claiming an identical retry. Do not retry a cancellation automatically.

Never classify incomplete output as red, yellow, or green evidence.
