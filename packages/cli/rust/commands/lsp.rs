//! The `lsp` command. The language server has not been ported to this binary.
use crate::output::{Output, fail};

pub fn run() -> Output {
    fail(
        3,
        "sigil lsp is not available in this binary yet: the language server has not been ported.",
    )
}
