use sigilc::turtle::{CLASSES, ONTOLOGY, ontology_document, vocabulary};
use std::{
    io::{self, Write},
    process::ExitCode,
};

fn main() -> ExitCode {
    match run() {
        Ok((code, output)) => match io::stdout().write_all(output.as_bytes()) {
            Ok(()) => ExitCode::from(code),
            Err(error) => {
                let _ = writeln!(io::stderr(), "{error}");
                ExitCode::from(3)
            }
        },
        Err((code, message)) => {
            let _ = writeln!(io::stderr(), "{message}");
            ExitCode::from(code)
        }
    }
}

fn run() -> sigilc::cli::Output {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    let output = match args.as_slice() {
        ["--version"] => format!("sigilc {}\n", env!("CARGO_PKG_VERSION")),
        ["--help"] | ["-h"] => "sigilc — deterministic Semantic Worlds compiler\n\nCommands:\n  scope --frontend FILE --scope FILE\n  ontology [--format text|json]\n  prepare design --frontend FILE --source PATH --out NEW_DIR\n  ingest design --frontend FILE --source PATH --job FILE --turtle FILE|-\n  stale design --frontend FILE\n  compile design --frontend FILE [--limits FILE] [--allow-empty]\n  entities --frontend FILE [--limits FILE] [--allow-empty]\n  prepare implementation --frontend FILE --source PATH --out NEW_DIR\n  ingest implementation --frontend FILE --source PATH --job FILE --turtle FILE|-\n  stale implementation --frontend FILE --selection FILE\n  compile implementation --frontend FILE --selection FILE\n  compare --frontend FILE --selection FILE [--limits FILE]\n  clean [--root DIR]\n\nWorld commands accept --root DIR (default: .). Reports are JSON.\nWorld commands also accept --scope FILE (replaces --selection for Implementation).\nScope preserves ordered Design roots and includes import/owner dependencies.\nNo command invokes a model.\n\nGate exits: 0 = Coherent/Loose (Design), Closed/Converged (Implementation).\n1 = Disjoint (Design), Drift (Implementation). Loose/Converged are warnings.\n2 = usage; 3 = operational failure or unavailable comparison.\nInspection exits: stale 1 = nonfresh sources; entities 1 = catalog unavailable.\n".into(),
        ["ontology", "--format", "json"] => {
            serde_json::to_string_pretty(&ontology_document()).map_err(|e| (3, e.to_string()))? + "\n"
        },
        ["ontology"] | ["ontology", "--format", "text"] => {
            let properties = vocabulary().into_iter().map(|(name, range)| format!("{name} ({range})")).collect::<Vec<_>>().join(", ");
            format!("RDF 1.1 Turtle: @prefix sigil: <{ONTOLOGY}> .\nClasses: {}.\nProperties: {properties}.\nUse named resources and direct assertions only; no blank nodes, rules, derived relations, or evidence claims.\nNumbers are finite and nonnegative, at most 9007199254740991; risk is at most 1.\n", CLASSES.join(", "))
        },
        _ => return sigilc::cli::run(&args),
    };
    Ok((0, output))
}
