use crate::{
    assertions::quote,
    sources::hash,
    turtle::{self, Assertion, ONTOLOGY, Object, RDF_TYPE},
};
use egglog::{EGraph, Term, ast::Literal};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, time::Instant};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub max_input_assertions: usize,
    pub max_rows: usize,
    pub max_iterations: usize,
    pub max_elapsed_ms: u64,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            max_input_assertions: 100_000,
            max_rows: 1_000_000,
            max_iterations: 10_000,
            max_elapsed_ms: 60_000,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaturatedWorld {
    pub kernel_fingerprint: String,
    pub iterations: usize,
    pub tables: BTreeMap<String, Vec<Vec<Value>>>,
}

// @sigil implements packages/sigilc/kernel.sigil::SigilWorldClosure::IsolatedClosure interface
pub fn saturate(assertions: &[Assertion], limits: Limits) -> Result<SaturatedWorld, String> {
    if assertions.len() > limits.max_input_assertions {
        return Err("input assertion limit exceeded".into());
    }
    let started = Instant::now();
    let mut program = String::from(include_str!("kernel.egg"));
    for assertion in assertions {
        let assertion = turtle::validate(assertion.clone())?;
        let id = assertion.id();
        let s = quote(&assertion.subject);
        let p = assertion.predicate.strip_prefix(ONTOLOGY).unwrap_or("");
        let row = if assertion.predicate == RDF_TYPE {
            let Object::Iri { value } = &assertion.object else {
                unreachable!("validated type")
            };
            format!(
                "(kind {s} {} {})",
                quote(value.strip_prefix(ONTOLOGY).unwrap()),
                quote(&id)
            )
        } else {
            match &assertion.object {
                Object::Iri { value } => {
                    format!("(edge {s} {} {} {})", quote(p), quote(value), quote(&id))
                }
                Object::Literal { value, .. } => match turtle::vocabulary()[p] {
                    "number" => {
                        let n: f64 = value.parse().map_err(|_| "invalid normalized number")?;
                        format!("(number {s} {} {n:?} {})", quote(p), quote(&id))
                    }
                    kind => {
                        let table = if kind == "boolean" { "boolean" } else { "text" };
                        format!("({table} {s} {} {} {})", quote(p), quote(value), quote(&id))
                    }
                },
            }
        };
        program.push('\n');
        program.push_str(&row);
    }
    let mut graph = EGraph::default();
    graph
        .parse_and_run_program(Some("sigil-world".into()), &program)
        .map_err(|e| e.to_string())?;
    let mut iterations = 0;
    for ruleset in ["closure", "diagnostics"] {
        loop {
            check_limits(&graph, limits, started)?;
            if iterations >= limits.max_iterations {
                return Err("closure iteration limit exceeded".into());
            }
            iterations += 1;
            let report = graph.step_rules(ruleset).map_err(|e| e.to_string())?;
            check_limits(&graph, limits, started)?;
            if !report.updated {
                break;
            }
        }
    }
    if graph.get_size("arithmetic-limit") != 0 {
        return Err("path arithmetic exceeds supported numeric range".into());
    }
    let mut tables = BTreeMap::new();
    for (name, arity) in [
        ("known", 3),
        ("reachable", 2),
        ("because", 5),
        ("violation", 4),
        ("proposition", 5),
        ("path-cost", 3),
        ("risk-score", 2),
    ] {
        let (terms, _, dag) = graph
            .function_to_dag(name, limits.max_rows.saturating_add(1), false)
            .map_err(|e| e.to_string())?;
        let mut rows = Vec::new();
        for term in terms {
            let Term::App(_, children) = dag.get(term) else {
                return Err("invalid native row".into());
            };
            if children.len() != arity {
                return Err(format!("invalid native {name} arity"));
            }
            rows.push(
                children
                    .iter()
                    .map(|id| match dag.get(*id) {
                        Term::Lit(Literal::String(s)) => Ok(json!(s)),
                        Term::Lit(Literal::Float(n)) if n.0.is_finite() => Ok(json!(n.0)),
                        _ => Err("invalid native scalar".to_string()),
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            );
        }
        rows.sort_by_cached_key(|row| serde_json::to_string(row).expect("scalar rows"));
        tables.insert(name.into(), rows);
    }
    check_limits(&graph, limits, started)?;
    Ok(SaturatedWorld {
        kernel_fingerprint: fingerprint(),
        iterations,
        tables,
    })
}

fn check_limits(graph: &EGraph, limits: Limits, started: Instant) -> Result<(), String> {
    if graph.num_tuples() > limits.max_rows {
        return Err("closure row limit exceeded".into());
    }
    if started.elapsed().as_millis() >= u128::from(limits.max_elapsed_ms) {
        return Err("closure elapsed limit exceeded".into());
    }
    Ok(())
}

// @sigil implements packages/sigilc/kernel.sigil::SigilWorldClosure::RuntimeIdentity interface
pub fn fingerprint() -> String {
    hash(
        concat!(
            include_str!("kernel.egg"),
            include_str!("kernel.rs"),
            include_str!("turtle.rs"),
            include_str!("assertions.rs"),
            include_str!("../Cargo.toml"),
            include_str!("../Cargo.lock")
        )
        .as_bytes(),
    )
}
