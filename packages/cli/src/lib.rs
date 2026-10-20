//! The `sigil` command line: argument parsing, shared output, and one module
//! for each command. Every read of a workspace goes through `sigil-core`.
pub mod args;
pub mod commands;
pub mod display;
pub mod model;
pub mod output;
pub mod selection;
pub mod session;

use args::{Parsed, help};
use output::Output;
use std::path::PathBuf;

/// The version of the `sigil` command line.
pub const CLI_VERSION: &str = env!("CARGO_PKG_VERSION");

/// What a command needs from the process.
#[derive(Debug, Clone)]
pub struct Context {
    /// The current directory, absolute.
    pub cwd: PathBuf,
}

impl Context {
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }
}

/// Run the command line `argv` (without the program name) from `ctx.cwd`.
pub fn run(argv: &[String], ctx: &Context) -> Output {
    match args::parse(argv) {
        Parsed::Help(topic) => output::ok(0, help(topic)),
        Parsed::CliVersion => output::ok(0, format!("{CLI_VERSION}\n")),
        Parsed::Usage(usage) => Err((
            2,
            format!("Error: {}\n\n{}", usage.message, help(usage.topic)),
        )),
        Parsed::Run(request) => commands::run(&request, ctx),
    }
}
