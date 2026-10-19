//! The `lsp` command: the language server on standard input and output.
use crate::{Context, output::Output};
use std::io::{self, BufWriter};

/// The exit status of `sigil_lsp::serve` when standard input or output fails.
const STDIO_FAILURE: i32 = 3;

/// Serve until the client exits or closes the input. Nothing but protocol
/// messages goes to standard output, so the returned output is empty.
pub fn run(ctx: &Context) -> Output {
    let code = sigil_lsp::serve(io::stdin(), BufWriter::new(io::stdout()), ctx.cwd.clone());
    match code {
        STDIO_FAILURE => Err((
            3,
            "sigil lsp: standard input or output failed.\n".to_owned(),
        )),
        other => Ok((u8::try_from(other).unwrap_or(1), String::new())),
    }
}
