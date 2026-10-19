//! The `glossary` command. Not implemented yet.
use crate::{
    Context,
    args::GlossaryRequest,
    output::{Output, fail},
};

pub fn run(_request: &GlossaryRequest, _ctx: &Context) -> Output {
    fail(3, "sigil glossary is not implemented yet.")
}
