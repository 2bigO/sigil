//! One module for each command. Each exposes `run(request, context)`.
use crate::{Context, args::Request, output::Output};

pub mod check;
pub mod fmt;
pub mod glossary;
pub mod init;
pub mod lsp;
pub mod parse;
pub mod version;

/// Run a parsed command.
pub fn run(request: &Request, ctx: &Context) -> Output {
    match request {
        Request::Init(request) => init::run(request, ctx),
        Request::Version(request) => version::run(request, ctx),
        Request::Parse(request) => parse::run(request, ctx),
        Request::Check(request) => check::run(request, ctx),
        Request::Fmt(request) => fmt::run(request, ctx),
        Request::Glossary(request) => glossary::run(request, ctx),
        Request::Lsp => lsp::run(ctx),
    }
}
