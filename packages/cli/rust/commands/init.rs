//! The `init` command. Not implemented yet.
use crate::{
    Context,
    args::InitRequest,
    output::{Output, fail},
};

pub fn run(_request: &InitRequest, _ctx: &Context) -> Output {
    fail(3, "sigil init is not implemented yet.")
}
