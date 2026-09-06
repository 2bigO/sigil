//! The deterministic command boundary. No process launchers or model options.
use crate::{
    catalog, comparison, design,
    frontend::DesignInput,
    implementation,
    inputs::{self, DesignSnapshot},
    kernel::{DesignState, Limits},
    scope::{ResolvedScope, Scope},
    sources::{self, Selection},
    store::{Freshness, Job, LockedStore, StoreLimits},
    turtle::{self, TurtleLimits},
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

pub type Output = Result<(u8, String), (u8, String)>;

// @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::DesignCommands interface
pub fn run(args: &[&str]) -> Output {
    if args.first() == Some(&"clean") {
        let root = match args {
            ["clean"] => ".",
            ["clean", "--root", root] => root,
            _ => return Err((2, "Usage: sigilc clean [--root DIR]".into())),
        };
        return json(
            0,
            &serde_json::json!({"version":1,"removed":crate::store::clean(Path::new(root)).map_err(runtime)?}),
        );
    }
    let (command, side, tail) = match args {
        [
            command @ ("prepare" | "ingest" | "stale" | "compile"),
            side @ ("design" | "implementation"),
            tail @ ..,
        ] => (*command, *side, tail),
        ["entities", tail @ ..] => ("entities", "design", tail),
        ["compare", tail @ ..] => ("compare", "implementation", tail),
        ["scope", tail @ ..] => ("scope", "design", tail),
        _ => return Err((2, "Invalid command or options. Run sigilc --help.".into())),
    };
    let allowed: &[&str] = match command {
        "scope" => &["--root", "--frontend", "--format"],
        "prepare" => &["--root", "--frontend", "--source", "--out"],
        "ingest" => &["--root", "--frontend", "--source", "--job", "--turtle"],
        _ => &[
            "--root",
            "--frontend",
            "--limits",
            "--allow-empty",
            "--format",
        ],
    };
    let mut allowed = allowed.to_vec();
    allowed.push("--scope");
    if side == "implementation" && matches!(command, "compile" | "stale" | "compare") {
        allowed.push("--selection");
    }
    let mut options = BTreeMap::new();
    let mut rest = tail;
    while let Some((flag, next)) = rest.split_first() {
        if !allowed.contains(flag) || options.contains_key(flag) {
            return Err((2, format!("unknown or duplicate option: {flag}")));
        }
        let value;
        if *flag == "--allow-empty" {
            value = "true";
            rest = next;
        } else {
            let Some((v, next)) = next.split_first() else {
                return Err((2, format!("missing value: {flag}")));
            };
            value = v;
            rest = next;
        }
        options.insert(*flag, value);
    }
    if options.get("--format").is_some_and(|v| *v != "json") {
        return Err((2, "this command supports --format json".into()));
    }
    let required = |key| {
        options
            .get(key)
            .copied()
            .ok_or_else(|| (2, format!("required option: {key}")))
    };
    let frontend = required("--frontend")?;
    if command == "scope" {
        required("--scope")?;
    }
    if options.contains_key("--scope")
        && (options.contains_key("--selection") || options.contains_key("--allow-empty"))
    {
        return Err((2, "--scope conflicts with --selection and --allow-empty; set selection and emptiness within scope".into()));
    }
    if side == "implementation"
        && matches!(command, "compile" | "stale" | "compare")
        && !options.contains_key("--scope")
    {
        required("--selection")?;
    }
    let source = if matches!(command, "prepare" | "ingest") {
        Some(required("--source")?)
    } else {
        None
    };
    let out = if command == "prepare" {
        Some(required("--out")?)
    } else {
        None
    };
    let job_path = if command == "ingest" {
        Some(required("--job")?)
    } else {
        None
    };
    let turtle_path = if command == "ingest" {
        Some(required("--turtle")?)
    } else {
        None
    };
    let root = PathBuf::from(options.get("--root").copied().unwrap_or("."));
    if [
        Some(frontend),
        job_path,
        turtle_path,
        options.get("--limits").copied(),
        options.get("--selection").copied(),
        options.get("--scope").copied(),
    ]
    .into_iter()
    .flatten()
    .filter(|p| *p == "-")
    .count()
        > 1
    {
        return Err((2, "only one input may read standard input".into()));
    }
    let limits = options
        .get("--limits")
        .map(|path| {
            read(path, 1_000_000).and_then(|bytes| {
                serde_json::from_slice::<Limits>(&bytes).map_err(|e| e.to_string())
            })
        })
        .transpose()
        .map_err(runtime)?
        .unwrap_or_default();
    let store_limits = StoreLimits::default();
    let mut store = LockedStore::open(&root, store_limits).map_err(runtime)?;
    let mut input =
        DesignInput::parse(&read(frontend, 32_000_000).map_err(runtime)?).map_err(runtime)?;
    let scope = options
        .get("--scope")
        .map(|path| {
            let scope: Scope = serde_json::from_slice(&read(path, 1_000_000).map_err(runtime)?)
                .map_err(|e| runtime(e.to_string()))?;
            scope.resolve(&root, &mut input).map_err(runtime)
        })
        .transpose()?;
    if let Some(scope) = &scope {
        if scope.report.design.intentional_empty {
            options.insert("--allow-empty", "true");
        }
        if let Some(source) = source {
            let selected = if side == "design" {
                scope.report.design.sources.contains(source)
            } else {
                scope
                    .report
                    .implementation_sources
                    .binary_search_by(|p| p.as_str().cmp(source))
                    .is_ok()
            };
            if !selected {
                return Err((
                    2,
                    format!("{side} source is outside the requested scope: {source}"),
                ));
            }
        }
    }
    let snapshot =
        DesignSnapshot::capture(&root, input, store_limits.max_source_bytes).map_err(runtime)?;
    if command == "scope" {
        let scope = scope.unwrap();
        return json(
            0,
            &serde_json::json!({
                "version":1,"scope":scope.report,
                "design_input_fingerprint":snapshot.fingerprint().map_err(runtime)?,
                "implementation_source_fingerprint":scope.implementation.fingerprint,
                "diagnostics":snapshot.input().diagnostics,
            }),
        );
    }
    let output = if side == "implementation" {
        run_implementation(
            command,
            &options,
            &root,
            &snapshot,
            &mut store,
            limits,
            scope.as_ref(),
        )
    } else {
        match command {
            "prepare" => {
                design::valid_frontend(&snapshot).map_err(runtime)?;
                let source = source.unwrap();
                let job = store
                    .prepare(snapshot.binding(source).map_err(runtime)?)
                    .map_err(runtime)?;
                let out = Path::new(out.unwrap());
                fs::create_dir(out).map_err(|e| {
                    runtime(format!(
                        "create preparation directory {}: {e}",
                        out.display()
                    ))
                })?;
                write_new(
                    &out.join("design.json"),
                    &snapshot.preparation(source).map_err(runtime)?,
                )
                .map_err(runtime)?;
                write_new(&out.join("ontology.json"), &turtle::ontology_document())
                    .map_err(runtime)?;
                write_new(&out.join("job.json"), &job).map_err(runtime)?;
                json(
                    0,
                    &serde_json::json!({"version":1,"job":out.join("job.json"),"inputs":[out.join("design.json"),out.join("ontology.json")],"input_fingerprint":job.binding.fingerprint()}),
                )
            }
            "ingest" => {
                design::valid_frontend(&snapshot).map_err(runtime)?;
                let source = source.unwrap();
                let job: Job =
                    serde_json::from_slice(&read(job_path.unwrap(), 16_000_000).map_err(runtime)?)
                        .map_err(|e| runtime(e.to_string()))?;
                if job.binding.side() != "design" || job.binding.source.path != source {
                    return Err((2, "job does not bind the requested Design source".into()));
                }
                let facts = turtle::parse(
                    &read(
                        turtle_path.unwrap(),
                        TurtleLimits::default().max_document_bytes as u64,
                    )
                    .map_err(runtime)?,
                    TurtleLimits::default(),
                )
                .map_err(runtime)?;
                catalog::validate_design(source, snapshot.input(), &facts).map_err(runtime)?;
                let generation = store
                    .publish(&job, &snapshot.binding(source).map_err(runtime)?, &facts)
                    .map_err(runtime)?;
                json(
                    0,
                    &serde_json::json!({"version":1,"source":source,"generation":generation,"assertions":facts.len()}),
                )
            }
            "stale" => {
                let mut rows = design::inspect(&snapshot, &store).map_err(runtime)?;
                if let Some(scope) = &scope {
                    rows.retain(|s| scope.report.design.sources.contains(&s.source));
                }
                let code = if rows.iter().all(|s| s.status == Freshness::Fresh) {
                    0
                } else {
                    1
                };
                json(
                    code,
                    &serde_json::json!({"version":1,"side":"design","input_fingerprint":snapshot.fingerprint().map_err(runtime)?,"sources":rows}),
                )
            }
            _ => {
                let report = design::compile(
                    &snapshot,
                    &store,
                    limits,
                    options.contains_key("--allow-empty"),
                )
                .map_err(runtime)?;
                if command == "entities" {
                    match report.catalog {
                        Some(catalog) => json(0, &catalog),
                        None => json(
                            1,
                            &serde_json::json!({"version":1,"design":report.world.state,"all_fresh":report.all_fresh,"catalog":null}),
                        ),
                    }
                } else {
                    json(
                        match report.world.state {
                            DesignState::Coherent | DesignState::Loose => 0,
                            DesignState::Disjoint => 1,
                        },
                        &report,
                    )
                }
            }
        }
    };
    let (code, output) = output?;
    if let Some(scope) = scope {
        let mut report: serde_json::Value =
            serde_json::from_str(&output).map_err(|e| runtime(e.to_string()))?;
        report["scope"] = serde_json::to_value(scope.report).map_err(|e| runtime(e.to_string()))?;
        json(code, &report)
    } else {
        Ok((code, output))
    }
}

// @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::ImplementationCommands interface
fn run_implementation(
    command: &str,
    options: &BTreeMap<&str, &str>,
    root: &Path,
    snapshot: &DesignSnapshot,
    store: &mut LockedStore,
    limits: Limits,
    scope: Option<&ResolvedScope>,
) -> Output {
    let design = design::compile(
        snapshot,
        store,
        limits,
        options.contains_key("--allow-empty"),
    )
    .map_err(runtime)?;
    let Some(frozen) = &design.catalog else {
        return json(
            3,
            &serde_json::json!({"version":1,"design":design,"implementation":null,"comparison":null,"reason":"current Design catalog unavailable"}),
        );
    };
    let catalog = &frozen.catalog;
    if matches!(command, "prepare" | "ingest") {
        let source = options["--source"];
        sources::implementation_path(source).map_err(|e| (2, e))?;
        let captured = sources::capture(root, source, StoreLimits::default().max_source_bytes)
            .map_err(runtime)?;
        let binding = inputs::implementation(&captured, catalog);
        if command == "prepare" {
            let job = store.prepare(binding).map_err(runtime)?;
            let out = Path::new(options["--out"]);
            fs::create_dir(out).map_err(|e| runtime(e.to_string()))?;
            write_bytes_new(&out.join("source"), &captured.bytes).map_err(runtime)?;
            write_new(&out.join("ontology.json"), &turtle::ontology_document()).map_err(runtime)?;
            write_new(&out.join("catalog.json"), catalog).map_err(runtime)?;
            write_new(&out.join("job.json"), &job).map_err(runtime)?;
            return json(
                0,
                &serde_json::json!({"version":1,"job":out.join("job.json"),"inputs":[out.join("source"),out.join("ontology.json"),out.join("catalog.json")],"input_fingerprint":job.binding.fingerprint()}),
            );
        }
        let job: Job =
            serde_json::from_slice(&read(options["--job"], 16_000_000).map_err(runtime)?)
                .map_err(|e| runtime(e.to_string()))?;
        if job.binding.side() != "implementation" || job.binding.source.path != source {
            return Err((
                2,
                "job does not bind the requested Implementation source".into(),
            ));
        }
        let facts = turtle::parse(
            &read(
                options["--turtle"],
                TurtleLimits::default().max_document_bytes as u64,
            )
            .map_err(runtime)?,
            TurtleLimits::default(),
        )
        .map_err(runtime)?;
        catalog.validate_implementation(&facts).map_err(runtime)?;
        let generation = store.publish(&job, &binding, &facts).map_err(runtime)?;
        return json(
            0,
            &serde_json::json!({"version":1,"source":source,"generation":generation,"assertions":facts.len()}),
        );
    }
    let assembly = if let Some(scope) = scope {
        let mut assembly = implementation::assemble_manifest(
            &scope.implementation,
            catalog,
            store,
            limits.max_input_assertions,
        )
        .map_err(runtime)?;
        assembly.sources.retain(|s| {
            scope
                .report
                .implementation_sources
                .binary_search(&s.source)
                .is_ok()
        });
        assembly
    } else {
        let mut selection: Selection =
            serde_json::from_slice(&read(options["--selection"], 1_000_000).map_err(runtime)?)
                .map_err(|e| runtime(e.to_string()))?;
        if options.contains_key("--allow-empty") {
            selection.allow_empty = true;
        }
        implementation::assemble(
            root,
            &selection,
            catalog,
            store,
            limits.max_input_assertions,
        )
        .map_err(runtime)?
    };
    if command == "stale" {
        let code = if assembly
            .sources
            .iter()
            .all(|s| s.status == Freshness::Fresh)
        {
            0
        } else {
            1
        };
        return json(
            code,
            &serde_json::json!({"version":1,"side":"implementation","input_fingerprint":assembly.input_fingerprint,"intentional_empty":assembly.intentional_empty,"sources":assembly.sources}),
        );
    }
    let implementation = assembly.compile(limits).map_err(runtime)?;
    let comparison = comparison::compare(
        &design.world,
        &implementation.world,
        comparison::FreshInputs {
            all_design_fresh: design.all_fresh,
            all_implementation_fresh: implementation.all_fresh,
        },
        limits,
    )
    .map_err(runtime)?;
    let code = match comparison.implementation {
        Some(
            comparison::ImplementationState::Closed | comparison::ImplementationState::Converged,
        ) => 0,
        Some(comparison::ImplementationState::Drift) => 1,
        None => 3,
    };
    json(
        code,
        &serde_json::json!({"version":1,"design":design,"implementation":implementation,"comparison":comparison}),
    )
}

pub fn read(path: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
    let reader: Box<dyn Read> = if path == "-" {
        Box::new(io::stdin())
    } else {
        Box::new(fs::File::open(path).map_err(|e| format!("read {path}: {e}"))?)
    };
    let mut bytes = Vec::new();
    reader
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!("input exceeds byte limit: {path}"));
    }
    Ok(bytes)
}

fn write_new(path: &Path, value: &impl Serialize) -> Result<(), String> {
    write_bytes_new(
        path,
        &serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
}

fn write_bytes_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())
}

fn runtime(message: String) -> (u8, String) {
    (3, message)
}
fn json(code: u8, value: &impl Serialize) -> Output {
    Ok((
        code,
        serde_json::to_string_pretty(value).map_err(|e| runtime(e.to_string()))? + "\n",
    ))
}
