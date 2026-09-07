//! The deterministic command boundary. No process launchers or model options.
use crate::{
    catalog, comparison, design,
    frontend::DesignInput,
    implementation,
    inputs::{self, DesignSnapshot},
    kernel::{DesignState, Limits},
    request::{self, ItemState, LifecycleState, RequestDefinition},
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
    if args.first() == Some(&"request") {
        return run_request(args);
    }
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

fn run_request(args: &[&str]) -> Output {
    let action = match args {
        ["request", action @ ("create" | "status"), tail @ ..] => (*action, tail),
        _ => return Err((2, "Usage: sigilc request create|status [options]".into())),
    };
    let mut options = BTreeMap::new();
    let mut rest = action.1;
    while let Some((flag, next)) = rest.split_first() {
        if ![
            "--root",
            "--frontend",
            "--definition",
            "--limits",
            "--format",
        ]
        .contains(flag)
            || options.contains_key(flag)
        {
            return Err((2, format!("unknown or duplicate option: {flag}")));
        }
        let Some((value, remaining)) = next.split_first() else {
            return Err((2, format!("missing value: {flag}")));
        };
        options.insert(*flag, *value);
        rest = remaining;
    }
    if options.get("--format").is_some_and(|v| *v != "json") {
        return Err((2, "this command supports --format json".into()));
    }
    if action.0 == "create" && !options.contains_key("--definition") {
        return Err((2, "required option: --definition".into()));
    }
    if action.0 == "status" && options.contains_key("--definition") {
        return Err((2, "--definition is only valid for request create".into()));
    }
    let root = PathBuf::from(options.get("--root").copied().unwrap_or("."));
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
    let store = LockedStore::open(&root, store_limits).map_err(runtime)?;
    match action.0 {
        "create" => {
            let frontend = options
                .get("--frontend")
                .copied()
                .ok_or_else(|| (2, "required option: --frontend".into()))?;
            let definition: RequestDefinition =
                serde_json::from_slice(&read(options["--definition"], 1_000_000).map_err(runtime)?)
                    .map_err(|e| runtime(format!("invalid scoped request definition: {e}")))?;
            request::validate(&definition).map_err(runtime)?;
            if let Some(existing) = store.workflow_state().map_err(runtime)? {
                let existing = request::load(Some(existing)).map_err(runtime)?;
                if existing.request_fingerprint
                    == request::fingerprint(&definition).map_err(runtime)?
                    && existing.frontend == frontend
                {
                    return json(0, &serde_json::json!({"version":1,"request":existing}));
                }
                return Err((
                    2,
                    "a different scoped request already exists; preserve its evidence before replacing .sigil/workflow/request.json".into(),
                ));
            }
            let frontend_bytes = read(frontend, 32_000_000).map_err(runtime)?;
            let input = DesignInput::parse(&frontend_bytes).map_err(runtime)?;
            let snapshot = DesignSnapshot::capture(&root, input, store_limits.max_source_bytes)
                .map_err(runtime)?;
            let frontend_fingerprint = snapshot.fingerprint().map_err(runtime)?;
            let scopes = definition
                .items
                .iter()
                .map(|item| {
                    let mut input = DesignInput::parse(&frontend_bytes).map_err(runtime)?;
                    let resolved = item
                        .scope
                        .clone()
                        .resolve(&root, &mut input)
                        .map_err(runtime)?;
                    serde_json::to_value(resolved.report).map_err(|e| runtime(e.to_string()))
                })
                .collect::<Result<Vec<_>, _>>()?;
            let state = request::new_state(
                definition,
                frontend.to_owned(),
                frontend_fingerprint,
                scopes,
            )
            .map_err(runtime)?;
            store
                .publish_workflow_state(&request::encode(&state).map_err(runtime)?)
                .map_err(runtime)?;
            json(0, &serde_json::json!({"version":1,"request":state}))
        }
        "status" => {
            let mut state =
                request::load(store.workflow_state().map_err(runtime)?).map_err(runtime)?;
            let frontend = options
                .get("--frontend")
                .copied()
                .unwrap_or(state.frontend.as_str());
            let frontend_bytes = read(frontend, 32_000_000).map_err(runtime)?;
            let parsed = DesignInput::parse(&frontend_bytes).map_err(runtime)?;
            let current_frontend_fingerprint =
                DesignSnapshot::capture(&root, parsed, store_limits.max_source_bytes)
                    .and_then(|snapshot| snapshot.fingerprint())
                    .unwrap_or_else(|_| sources::hash(&frontend_bytes));
            let mut updated = Vec::with_capacity(state.definition.items.len());
            let mut states = BTreeMap::new();
            for (index, item) in state.definition.items.iter().enumerate() {
                let prior_scope = state.items[index].scope.clone();
                let mut input = match DesignInput::parse(&frontend_bytes) {
                    Ok(input) => input,
                    Err(error) => {
                        let item_state = unavailable_item(
                            item,
                            prior_scope,
                            None,
                            format!("frontend parse failed: {error}"),
                        );
                        states.insert(item.id.clone(), item_state.state.clone());
                        updated.push(item_state);
                        continue;
                    }
                };
                let resolved = match item.scope.clone().resolve(&root, &mut input) {
                    Ok(scope) => scope,
                    Err(error) => {
                        let item_state = unavailable_item(
                            item,
                            prior_scope,
                            None,
                            format!("scope unavailable: {error}"),
                        );
                        states.insert(item.id.clone(), item_state.state.clone());
                        updated.push(item_state);
                        continue;
                    }
                };
                let scope_value =
                    serde_json::to_value(&resolved.report).map_err(|e| runtime(e.to_string()))?;
                let snapshot =
                    match DesignSnapshot::capture(&root, input, store_limits.max_source_bytes) {
                        Ok(snapshot) => snapshot,
                        Err(error) => {
                            let item_state = unavailable_item(
                                item,
                                Some(scope_value),
                                None,
                                format!("frontend inputs unavailable: {error}"),
                            );
                            states.insert(item.id.clone(), item_state.state.clone());
                            updated.push(item_state);
                            continue;
                        }
                    };
                let blocked = item.after.iter().find(|predecessor| {
                    !states
                        .get(*predecessor)
                        .is_some_and(LifecycleState::terminal)
                });
                let input_fingerprint = snapshot.fingerprint().map_err(runtime)?;
                if let Some(predecessor) = blocked {
                    let predecessor_state = states
                        .get(predecessor)
                        .expect("validated predecessor state");
                    let item_state = ItemState {
                        id: item.id.clone(),
                        after: item.after.clone(),
                        evidence: item.evidence.clone(),
                        state: LifecycleState::Queued,
                        scope: Some(scope_value),
                        gate: None,
                        input_fingerprint: Some(input_fingerprint),
                        reason: Some(format!(
                            "predecessor {predecessor} is {}",
                            lifecycle_label(predecessor_state)
                        )),
                    };
                    states.insert(item.id.clone(), item_state.state.clone());
                    updated.push(item_state);
                    continue;
                }
                let item_state = evaluate_request_item(
                    item,
                    resolved,
                    snapshot,
                    &store,
                    limits,
                    scope_value,
                    input_fingerprint,
                )?;
                states.insert(item.id.clone(), item_state.state.clone());
                updated.push(item_state);
            }
            state.frontend = frontend.to_owned();
            state.frontend_input_fingerprint = current_frontend_fingerprint;
            state.items = updated;
            let code = if state
                .items
                .iter()
                .any(|item| item.state == LifecycleState::Unavailable)
            {
                3
            } else if state
                .items
                .iter()
                .any(|item| item.state == LifecycleState::Drift)
            {
                1
            } else {
                0
            };
            store
                .publish_workflow_state(&request::encode(&state).map_err(runtime)?)
                .map_err(runtime)?;
            json(code, &serde_json::json!({"version":1,"request":state}))
        }
        _ => unreachable!(),
    }
}

fn unavailable_item(
    item: &request::RequestItem,
    scope: Option<serde_json::Value>,
    input_fingerprint: Option<String>,
    reason: String,
) -> ItemState {
    ItemState {
        id: item.id.clone(),
        after: item.after.clone(),
        evidence: item.evidence.clone(),
        state: LifecycleState::Unavailable,
        scope,
        gate: None,
        input_fingerprint,
        reason: Some(reason),
    }
}

fn lifecycle_label(state: &LifecycleState) -> &'static str {
    match state {
        LifecycleState::Queued => "queued",
        LifecycleState::Ready => "ready",
        LifecycleState::Closed => "closed",
        LifecycleState::Converged => "converged",
        LifecycleState::Drift => "drift",
        LifecycleState::Unavailable => "unavailable",
    }
}

fn evaluate_request_item(
    item: &request::RequestItem,
    scope: ResolvedScope,
    snapshot: DesignSnapshot,
    store: &LockedStore,
    limits: Limits,
    scope_value: serde_json::Value,
    input_fingerprint: String,
) -> Result<ItemState, (u8, String)> {
    let design = match design::compile(
        &snapshot,
        store,
        limits,
        scope.report.design.intentional_empty,
    ) {
        Ok(report) => report,
        Err(error) => {
            return Ok(unavailable_item(
                item,
                Some(scope_value),
                Some(input_fingerprint),
                format!("Design gate unavailable: {error}"),
            ));
        }
    };
    let design_state = design.world.state;
    let design_gate = serde_json::json!({
        "state": design_state,
        "allFresh": design.all_fresh,
        "fingerprint": design.design_fingerprint,
    });
    if design_state == DesignState::Disjoint {
        return Ok(ItemState {
            id: item.id.clone(),
            after: item.after.clone(),
            evidence: item.evidence.clone(),
            state: LifecycleState::Unavailable,
            scope: Some(scope_value),
            gate: Some(serde_json::json!({"design":design_gate})),
            input_fingerprint: Some(input_fingerprint),
            reason: Some("Design gate is Disjoint".into()),
        });
    }
    if !design.all_fresh {
        return Ok(ItemState {
            id: item.id.clone(),
            after: item.after.clone(),
            evidence: item.evidence.clone(),
            state: LifecycleState::Ready,
            scope: Some(scope_value),
            gate: Some(serde_json::json!({"design":design_gate})),
            input_fingerprint: Some(input_fingerprint),
            reason: Some("selected Design projections are not fresh".into()),
        });
    }
    let Some(frozen) = &design.catalog else {
        return Ok(unavailable_item(
            item,
            Some(scope_value),
            Some(input_fingerprint),
            "current Design catalog unavailable".into(),
        ));
    };
    let assembly = match implementation::assemble_manifest(
        &scope.implementation,
        &frozen.catalog,
        store,
        limits.max_input_assertions,
    ) {
        Ok(assembly) => assembly,
        Err(error) => {
            return Ok(unavailable_item(
                item,
                Some(scope_value),
                Some(input_fingerprint),
                format!("Implementation gate unavailable: {error}"),
            ));
        }
    };
    let all_implementation_fresh = assembly.all_fresh;
    let implementation = assembly.compile(limits).map_err(runtime)?;
    let comparison = comparison::compare(
        &design.world,
        &implementation.world,
        comparison::FreshInputs {
            all_design_fresh: design.all_fresh,
            all_implementation_fresh,
        },
        limits,
    )
    .map_err(runtime)?;
    let implementation_state = comparison.implementation;
    let gate = serde_json::json!({
        "design": design_gate,
        "implementation": {
            "allFresh": implementation.all_fresh,
            "inputFingerprint": implementation.input_fingerprint,
        },
        "comparison": {
            "state": implementation_state,
            "freshInputs": comparison.fresh_inputs,
            "unresolved": comparison.unresolved.len(),
            "disagreements": comparison.disagreements.len(),
        },
    });
    let (state, reason) = if !all_implementation_fresh {
        (
            LifecycleState::Ready,
            Some("selected Implementation projections are not fresh".into()),
        )
    } else {
        match implementation_state {
            Some(comparison::ImplementationState::Closed) => (LifecycleState::Closed, None),
            Some(comparison::ImplementationState::Converged) => (LifecycleState::Converged, None),
            Some(comparison::ImplementationState::Drift) => (
                LifecycleState::Drift,
                Some("Implementation gate is Drift".into()),
            ),
            None => (
                LifecycleState::Unavailable,
                Some("comparison did not produce an Implementation state".into()),
            ),
        }
    };
    Ok(ItemState {
        id: item.id.clone(),
        after: item.after.clone(),
        evidence: item.evidence.clone(),
        state,
        scope: Some(scope_value),
        gate: Some(gate),
        input_fingerprint: Some(input_fingerprint),
        reason,
    })
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
            &serde_json::json!({"version":1,"design":design,"implementation":null,"comparison":null,"reason":"current Design catalog unavailable","diagnostics":crate::report::unavailable_comparison()}),
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
    let diagnostics =
        crate::report::implementation(snapshot.input(), &design, &implementation, &comparison);
    json(
        code,
        &serde_json::json!({"version":1,"design":design,"implementation":implementation,"comparison":comparison,"diagnostics":diagnostics}),
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
    match ingest_hint(&message) {
        Some(hint) => (3, format!("{message}\nhint: {hint}")),
        None => (3, message),
    }
}

fn ingest_hint(message: &str) -> Option<&'static str> {
    if message.starts_with("unexpected character")
        || message.starts_with("premature end of file")
        || message.starts_with("unexpected end")
        || message.starts_with("error while parsing IRI")
        || message.contains("Invalid IRI")
        || message.contains("Turtle parse")
    {
        return Some(
            "return RDF 1.1 Turtle only: use angle-bracket IRIs for urn:sigil resources, declare prefixes before use, terminate every triple with '.', and remove markdown fences or prose",
        );
    }
    if message == "subject must be a named resource; blank nodes and triple terms are forbidden" {
        return Some(
            "use named angle-bracket IRIs for every subject; do not emit blank nodes, [] or RDF-star triple terms",
        );
    }
    if message == "unknown Sigil class" {
        return Some(
            "use rdf:type with one class IRI from ontology.json (for example sigil:Component, sigil:Concept or sigil:Contract); do not invent class names",
        );
    }
    if message.starts_with("frontend source changed:")
        || message.starts_with("frontend context changed:")
    {
        return Some(
            "recapture the structural Design export and run prepare again; do not reuse this job or Turtle",
        );
    }
    if message.starts_with("prepared semantic inputs no longer match current inputs")
        || message.starts_with("projection generation changed;")
    {
        return Some(
            "run prepare again and submit the returned Turtle with its new caller-held job.json",
        );
    }
    if message.starts_with("foreign or changed reserved declaration: urn:sigil:unit:") {
        return Some(
            "reserved authored units must have exactly one rdf:type sigil:Contract; preserve the prepared ID, attach section/description to that Contract resource, and do not add Goal, Interface, Constraint or Case",
        );
    }
    if message.starts_with("foreign or changed reserved declaration: urn:sigil:component:") {
        return Some(
            "emit reserved Component/Concept declarations only for the requested source; dependency identities are foreign references and must not be redeclared",
        );
    }
    if message == "unknown predicate or literal expected: owner" {
        return Some(
            "use ontology predicates: sigil:from for unit ownership, sigil:owns for component-to-Concept links, and sigil:hasContract for component-to-unit links; sigil:owner is not valid",
        );
    }
    if message == "unknown predicate namespace" {
        return Some(
            "use the exact Sigil ontology namespace https://sigil.dev/ontology/1# for predicates; declare @prefix sigil: <https://sigil.dev/ontology/1#> and choose a predicate listed in ontology.json",
        );
    }
    if message.starts_with("invalid or foreign interpretation-unit assertion:") {
        return Some(
            "keep unit assertions on the prepared source and use only rdf:type plus required, assumed, from, target, relation, expected, description and section",
        );
    }
    if message.starts_with("interpretation unit is not a domain endpoint:") {
        return Some(
            "target a prepared domain Component, Concept or entity, never another interpretation unit",
        );
    }
    if message.starts_with("declaration is not owned by") {
        return Some(
            "copy reserved identity IRIs exactly from design.json for the requested source; declare new domain identities under that source and reference foreign identities without redeclaring them",
        );
    }
    if message.starts_with("unknown domain identity:") {
        return Some(
            "reference only the exact prepared Component, Concept and entity IDs; do not derive nested or renamed IDs from a label",
        );
    }
    if message == "contract relation must name a fixed entity predicate" {
        return Some(
            "set sigil:relation to one fixed entity predicate from ontology.json (for example uses, provides, requires or dependsOn), not a free-form phrase",
        );
    }
    if message == "unknown predicate or literal expected: relation" {
        return Some(
            "encode sigil:relation as a plain string literal containing one fixed entity predicate; use IRIs for the subject and other entity-valued predicates",
        );
    }
    if message == "Component and Concept identities are reserved by the frontend" {
        return Some(
            "preserve prepared Component and Concept declarations instead of redeclaring them as domain entities",
        );
    }
    if message.starts_with("entity requires one type and label:") {
        return Some(
            "give each new domain entity exactly one non-reserved rdf:type and one non-empty sigil:label",
        );
    }
    None
}
fn json(code: u8, value: &impl Serialize) -> Output {
    Ok((
        code,
        serde_json::to_string_pretty(value).map_err(|e| runtime(e.to_string()))? + "\n",
    ))
}
