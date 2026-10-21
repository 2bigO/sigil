#![cfg(unix)]
//! Replay of the recorded TypeScript `init` cases against the `sigil` binary.
mod support;

use support::replay::{Selector, run_cases};

#[test]
fn parity_init_usage_and_help_cases() {
    run_cases("init", Selector::Args, 13);
}

#[test]
fn parity_init_workspace_cases() {
    run_cases("init", Selector::Workspace, 23);
}
