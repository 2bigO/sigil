#![cfg(unix)]
//! Replay of the recorded TypeScript `glossary` cases against the `sigil` binary.
mod support;

use support::replay::{Selector, run_cases};

#[test]
fn parity_glossary_usage_and_help_cases() {
    run_cases("glossary", Selector::Args, 8);
}

#[test]
fn parity_glossary_workspace_cases() {
    run_cases("glossary", Selector::Workspace, 28);
}
