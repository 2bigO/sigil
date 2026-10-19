#![cfg(unix)]
//! Replay of the recorded TypeScript `fmt` cases against the `sigil` binary.
mod support;

use support::replay::{Selector, run_cases};

#[test]
fn parity_fmt_usage_and_help_cases() {
    run_cases("fmt", Selector::Args, 10);
}

#[test]
fn parity_fmt_workspace_cases() {
    run_cases("fmt", Selector::Workspace, 112);
}
