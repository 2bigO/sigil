//! The `fmt` command. Not implemented yet.
use crate::{
    Context,
    args::FmtRequest,
    output::{Output, fail},
};

pub fn run(_request: &FmtRequest, _ctx: &Context) -> Output {
    fail(3, "sigil fmt is not implemented yet.")
}
