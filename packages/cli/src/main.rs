use sigil_cli::Context;
use std::{
    io::{self, Write},
    path::PathBuf,
    process::ExitCode,
};

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match sigil_cli::run(&argv, &Context::new(cwd)) {
        Ok((code, stdout)) => match write_stdout(&stdout) {
            Ok(()) => ExitCode::from(code),
            Err(error) => {
                let _ = writeln!(io::stderr(), "{error}");
                ExitCode::from(3)
            }
        },
        Err((code, message)) => {
            let _ = io::stderr().write_all(message.as_bytes());
            ExitCode::from(code)
        }
    }
}

fn write_stdout(text: &str) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    stdout.write_all(text.as_bytes())?;
    stdout.flush()
}
