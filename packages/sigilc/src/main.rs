use sigilc::turtle::{CLASSES, ONTOLOGY, ontology_document, vocabulary};
use std::{
    io::{self, Write},
    process::ExitCode,
};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err((code, message)) => {
            let _ = writeln!(io::stderr(), "{message}");
            ExitCode::from(code)
        }
    }
}

fn run() -> Result<(), (u8, String)> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    let output = match args.as_slice() {
        ["--version"] => format!("sigilc {}\n", env!("CARGO_PKG_VERSION")),
        ["--help"] | ["-h"] => "sigilc — deterministic Semantic Worlds compiler\n\nCommands:\n  ontology [--format text|json]    Export the fixed assertion vocabulary\n\nOptions:\n  --help\n  --version\n".into(),
        ["ontology", "--format", "json"] => {
            serde_json::to_string_pretty(&ontology_document()).map_err(|e| (3, e.to_string()))? + "\n"
        },
        ["ontology"] | ["ontology", "--format", "text"] => {
            let properties = vocabulary().into_iter().map(|(name, range)| format!("{name} ({range})")).collect::<Vec<_>>().join(", ");
            format!("RDF 1.1 Turtle: @prefix sigil: <{ONTOLOGY}> .\nClasses: {}.\nProperties: {properties}.\nUse named resources and direct assertions only; no blank nodes, rules, derived relations, or evidence claims.\nNumbers are finite and nonnegative, at most 9007199254740991; risk is at most 1.\n", CLASSES.join(", "))
        },
        _ => return Err((2, "Invalid command or options. Run sigilc --help.".into())),
    };
    io::stdout()
        .write_all(output.as_bytes())
        .map_err(|e| (3, e.to_string()))
}
