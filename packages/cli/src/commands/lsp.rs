//! The `lsp` command: the language server on standard input and output.
use crate::{
    Context,
    output::{Output, RUNTIME_FAILURE, fail, ok},
};
use std::io::{self, BufWriter};

/// Serve until the client exits or closes the input. Nothing but protocol
/// messages goes to standard output, so the returned output is empty.
pub fn run(ctx: &Context) -> Output {
    let code = sigil_lsp::serve(io::stdin(), BufWriter::new(io::stdout()), ctx.cwd.clone());
    match code {
        sigil_lsp::IO_FAILURE => fail(
            RUNTIME_FAILURE,
            "sigil lsp: standard input or output failed.",
        ),
        other => ok(u8::try_from(other).unwrap_or(1), ""),
    }
}
