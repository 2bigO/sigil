#![cfg(unix)]
//! Replay of the recorded TypeScript `check` cases against the `sigil` binary.
mod support;

use support::replay::{Selector, run_cases};

#[test]
fn parity_check_usage_and_help_cases() {
    run_cases("check", Selector::Args, 12);
}

#[ignore = "implemented in U4"]
#[test]
fn parity_check_workspace_cases() {
    run_cases("check", Selector::Workspace, 46);
}
