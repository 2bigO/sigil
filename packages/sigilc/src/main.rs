use sigilc::turtle::{CLASSES, ONTOLOGY, ontology_document, vocabulary};
use std::{
    io::{self, Write},
    process::ExitCode,
};

fn root_help() -> String {
    r#"sigilc — deterministic Semantic Worlds compiler

Commands:
  scope --frontend FILE --scope FILE
  ontology [--format text|json]
  request create --frontend FILE --definition FILE [--root DIR]
  request archive [--root DIR]
  request record --dossier FILE [--root DIR]
  request rearrange --order ID,ID,... [--root DIR]
  request status [--frontend FILE] [--root DIR]
  prepare design --frontend FILE --source PATH --out NEW_DIR [--scope FILE]
  ingest design --frontend FILE --source PATH --job FILE --turtle FILE|- [--evidence FILE] [--scope FILE]
  stale design --frontend FILE [--scope FILE]
  compile design --frontend FILE [--scope FILE] [--limits FILE] [--allow-empty]
  entities --frontend FILE [--scope FILE] [--limits FILE] [--allow-empty]
  prepare implementation --frontend FILE --source PATH --out NEW_DIR [--scope FILE]
  ingest implementation --frontend FILE --source PATH --job FILE --turtle FILE|- [--evidence FILE] [--scope FILE]
  stale implementation --frontend FILE (--selection FILE | --scope FILE)
  compile implementation --frontend FILE (--selection FILE | --scope FILE)
  compare --frontend FILE (--selection FILE | --scope FILE) [--limits FILE]
  clean [--root DIR]

Scope and ordered-request workflow:
  1. Export structural input: sigil export design . > frontend.json
  2. Resolve ordered roots: sigilc scope --frontend frontend.json --scope scope.json
  3. Inspect freshness: sigilc stale design --frontend frontend.json --scope scope.json
  4. Prepare/ingest only stale, missing or dependency-invalid rows, then compile,
     export entities and compare.
  5. Persist order: sigilc request create --frontend frontend.json --definition request.json
  6. Rearrange active work: sigilc request rearrange --order ID,ID,...
  7. Archive a terminal request before replacement: sigilc request archive
  8. Record external proof: sigilc request record --dossier completion.json
  9. Advance release: sigilc request status [--frontend frontend.json]

Gate exits: 0 = Coherent/Loose (Design), Closed/Converged (Implementation).
1 = Disjoint (Design), Drift (Implementation). Loose/Converged are warnings.
2 = usage; 3 = operational failure or unavailable comparison.
"#
        .into()
}

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
    if matches!(args.as_slice(), ["--help"] | ["-h"]) {
        return Ok((0, root_help()));
    }
    let output = match args.as_slice() {
        ["--version"] => format!("sigilc {}\n", env!("CARGO_PKG_VERSION")),
        ["--help"] | ["-h"] => "sigilc — deterministic Semantic Worlds compiler\n\nCommands:\n  scope --frontend FILE --scope FILE\n  ontology [--format text|json]\n  request create --frontend FILE --definition FILE [--root DIR]\n  request archive [--root DIR]\n  request record --dossier FILE [--root DIR]\n  request status [--frontend FILE] [--root DIR]\n  prepare design --frontend FILE --source PATH --out NEW_DIR [--scope FILE]\n  ingest design --frontend FILE --source PATH --job FILE --turtle FILE|- [--evidence FILE] [--scope FILE]\n  stale design --frontend FILE [--scope FILE]\n  compile design --frontend FILE [--scope FILE] [--limits FILE] [--allow-empty]\n  entities --frontend FILE [--scope FILE] [--limits FILE] [--allow-empty]\n  prepare implementation --frontend FILE --source PATH --out NEW_DIR [--scope FILE]\n  ingest implementation --frontend FILE --source PATH --job FILE --turtle FILE|- [--evidence FILE] [--scope FILE]\n  stale implementation --frontend FILE (--selection FILE | --scope FILE)\n  compile implementation --frontend FILE (--selection FILE | --scope FILE)\n  compare --frontend FILE (--selection FILE | --scope FILE) [--limits FILE]\n  clean [--root DIR]\n\nScope and ordered-request workflow:\n  1. Export structural input: sigil export design . > frontend.json\n  2. Resolve ordered roots: sigilc scope --frontend frontend.json --scope scope.json\n  3. Inspect freshness: sigilc stale design --frontend frontend.json --scope scope.json\n  4. Preserve every fresh projection; prepare/ingest only stale, missing or\n     dependency-invalid rows, then compile/entities and compare.\n  5. Persist order: sigilc request create --frontend frontend.json --definition request.json\n  6. Archive a terminal request before replacing it: sigilc request archive\n  7. Record a terminal request's external proof: sigilc request record --dossier completion.json\n  8. Advance release: sigilc request status [--frontend frontend.json]\n\nA request definition has version, id and ordered items. Each item has id, scope\nand optional after predecessor IDs; status releases only terminal Closed/Converged\npredecessors. Freshness is binding-specific, so status from another ordered item\ndoes not make its projection reusable for this item unless the exact binding is\nretained in the disposable world cache. The cache keeps one canonical\nsource-path publication and fingerprinted superseded projections; it has no\nrequest, task, worker or scope ledger. A terminal request may retain one bounded\ncompletion dossier of opaque native-report, artifact, delivery, deletion, check,\nwarning and user-override references with its exact terminal gate snapshot. It\nclears when status reopens the request. No command invokes a model. `ingest\n--evidence FILE` accepts a version-2 external artifact manifest and persists its\nsource-bound links in the projection index.\n\nWorld commands accept --root DIR (default: .). Reports are JSON. --scope selects\nordered Design roots plus import/owner dependencies and replaces --selection for\nImplementation.\n\nGate exits: 0 = Coherent/Loose (Design), Closed/Converged (Implementation).\n1 = Disjoint (Design), Drift (Implementation). Loose/Converged are warnings.\n2 = usage; 3 = operational failure or unavailable comparison.\nInspection exits: stale 1 = nonfresh sources; entities 1 = catalog unavailable.\n".into(),
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
