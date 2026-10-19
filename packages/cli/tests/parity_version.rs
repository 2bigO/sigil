#![cfg(unix)]
//! Replay of the recorded TypeScript `version` cases against the `sigil` binary.
mod support;

use support::replay::{Selector, run_cases};

#[test]
fn parity_version_usage_and_help_cases() {
    run_cases("version", Selector::Args, 14);
}

#[test]
fn parity_version_workspace_cases() {
    run_cases("version", Selector::Workspace, 15);
}
