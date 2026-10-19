//! The `check` command. Not implemented yet.
use crate::{
    Context,
    args::CheckRequest,
    output::{Output, fail},
};

pub fn run(_request: &CheckRequest, _ctx: &Context) -> Output {
    fail(3, "sigil check is not implemented yet.")
}
