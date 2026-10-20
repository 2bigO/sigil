# CLI fixtures

`cli-parity.json` holds the output the TypeScript `sigil` command line gave for
each recorded case: arguments, working directory, exit status, standard output
and standard error. The Rust tests (`parity_*.rs`, `runtime_errors.rs`) replay
the cases against the Rust `sigil`. The file is now the specification of that
output, so change it by hand, case by case, and only when the behavior is meant
to change.

The `agentContext` key that the recorded `init` and `glossary` output carries is
being removed by hand in a later change.

The commit titled "refactor: remove the TypeScript implementation" deleted the
TypeScript tools and the scripts that generated these files. Find it with
`git log --grep "remove the TypeScript implementation"`; its parent is the last
tree that can regenerate them.
