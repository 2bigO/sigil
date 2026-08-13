<!-- @sigil implements integrations/skills/sigil/compilation-execution.sigil::SigilCompilationExecution interface,logic,constraints -->

# Shared Compilation Execution

Use this procedure for every ordinary design or implementation compilation. It
owns invocation, durable capture, terminal-outcome handling, and retry policy;
the calling workflow owns target selection and focus-specific interpretation.

## Run And Capture

Reserve and record a fresh task-scoped directory with `mktemp -d`. Capture both
streams in a named log there while preserving the command exit status. The log
is the source of record and must remain readable if a child evaluator outlives
the command-tool response.

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
are not compilation evidence.

If the execution host interrupts the live stream, retrieve and poll the durable
log and, if needed, evaluator process state until the terminal event is present
and its writer has closed. Do not retry solely because the live event was lost.

## Terminal Outcomes

- `completed`: preserve the report and pass it to the calling workflow.
- `failed`: preserve terminal diagnostics, durable capture, and exit status;
  report the failure and retry the same target only after the evaluator or host
  cause is resolved.
- `cancelled`: preserve cancellation evidence, durable capture, and exit status;
  report the known cause and retry the same target only after it is resolved or
  the user explicitly requests another run.
- missing terminal event, unreadable capture, or no established source end:
  report a host or transport failure. Restore durable capture before retrying
  the same target.

Never classify incomplete output as red, yellow, or green evidence.
