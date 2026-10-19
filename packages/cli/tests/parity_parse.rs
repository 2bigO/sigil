#![cfg(unix)]
//! Replay of the recorded TypeScript `parse` cases against the `sigil` binary.
mod support;

use support::replay::{Selector, run_cases};

#[test]
fn parity_parse_usage_and_help_cases() {
    run_cases("parse", Selector::Args, 9);
}

#[test]
fn parity_parse_workspace_cases() {
    run_cases("parse", Selector::Workspace, 11);
}
