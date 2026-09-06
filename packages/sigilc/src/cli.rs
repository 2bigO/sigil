//! The deterministic command boundary. No process launchers or model options.
use crate::{
    catalog, design,
    frontend::DesignInput,
    inputs::DesignSnapshot,
    kernel::{DesignState, Limits},
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
    let (command, tail) = match args {
        [
            command @ ("prepare" | "ingest" | "stale" | "compile"),
            "design",
            tail @ ..,
        ] => (*command, tail),
        ["entities", tail @ ..] => ("entities", tail),
        _ => return Err((2, "Invalid command or options. Run sigilc --help.".into())),
    };
    let allowed: &[&str] = match command {
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
    let input =
        DesignInput::parse(&read(frontend, 32_000_000).map_err(runtime)?).map_err(runtime)?;
    let snapshot =
        DesignSnapshot::capture(&root, input, store_limits.max_source_bytes).map_err(runtime)?;
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
            write_new(&out.join("ontology.json"), &turtle::ontology_document()).map_err(runtime)?;
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
            let rows = design::inspect(&snapshot, &store).map_err(runtime)?;
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
                    if report.world.state == DesignState::Coherent {
                        0
                    } else {
                        1
                    },
                    &report,
                )
            }
        }
    }
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
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
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
