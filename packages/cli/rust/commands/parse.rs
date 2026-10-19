//! The `parse` command. Not implemented yet.
use crate::{
    Context,
    args::ParseRequest,
    output::{Output, fail},
};

pub fn run(_request: &ParseRequest, _ctx: &Context) -> Output {
    fail(3, "sigil parse is not implemented yet.")
}
