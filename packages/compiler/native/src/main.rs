use egglog::{EGraph, Term, ast::Literal};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::{self, Read},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    version: u32,
    facts: Vec<Fact>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fact {
    relation: String,
    args: Vec<Value>,
}

fn scalar(term: &Term) -> Result<Value, String> {
    match term {
        Term::Lit(Literal::String(s)) => Ok(json!(s)),
        Term::Lit(Literal::Int(n)) => Ok(json!(n)),
        Term::Lit(Literal::Float(n)) => Ok(json!(n.0)),
        Term::Lit(Literal::Bool(b)) => Ok(json!(b)),
        _ => Err(format!("Unexpected output term: {term:?}")),
    }
}

fn egg_string(s: &str) -> String {
    // Egglog accepts these four escapes. JSON also emits unsupported \r/\u
    // escapes; raw control characters are valid inside an egglog string.
    format!(
        "\"{}\"",
        s.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\t', "\\t")
    )
}

fn run(input: Input) -> Result<Value, String> {
    if input.version != 1 {
        return Err("Unsupported protocol version".into());
    }
    let mut program = String::from(include_str!("kernel.egg"));
    for fact in input.facts {
        let signature = match fact.relation.as_str() {
            "kind" | "boolean" | "text" => "ssss",
            "number" => "ssns",
            "edge" => "ssss",
            _ => return Err(format!("Unknown input table: {}", fact.relation)),
        };
        if fact.args.len() != signature.len()
            || fact.args.iter().zip(signature.chars()).any(|(v, t)| {
                if t == 'n' {
                    v.as_f64().is_none_or(|n| !n.is_finite() || n < 0.0)
                } else {
                    !v.is_string()
                }
            })
        {
            return Err(format!("Invalid input row for {}", fact.relation));
        }
        program.push_str(&format!(
            "\n({} {})",
            fact.relation,
            fact.args
                .iter()
                .map(|v| if let Some(n) = v.as_f64() {
                    format!("{n:?}")
                } else {
                    egg_string(v.as_str().unwrap())
                })
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }
    program.push_str(include_str!("schedule.egg"));
    let mut graph = EGraph::default();
    graph
        .parse_and_run_program(Some("sigil-kernel".into()), &program)
        .map_err(|e| e.to_string())?;
    let mut tables = BTreeMap::new();
    for name in [
        "known",
        "reachable",
        "obligation",
        "satisfied",
        "violation",
        "unresolved",
        "because",
        "path-cost",
        "risk-score",
    ] {
        let (terms, _, dag) = graph
            .function_to_dag(name, usize::MAX, false)
            .map_err(|e| e.to_string())?;
        let mut rows = Vec::new();
        for term in terms {
            let Term::App(_, children) = dag.get(term) else {
                return Err("Invalid row".into());
            };
            rows.push(
                children
                    .iter()
                    .map(|id| scalar(dag.get(*id)))
                    .collect::<Result<Vec<_>, _>>()?,
            );
        }
        rows.sort_by_cached_key(|row| serde_json::to_string(row).unwrap());
        tables.insert(name, rows);
    }
    Ok(json!({"version": 1, "kernelVersion": "1", "tables": tables}))
}

fn main() {
    let result = (|| {
        let mut source = String::new();
        io::stdin()
            .take(16 * 1024 * 1024 + 1)
            .read_to_string(&mut source)
            .map_err(|e| e.to_string())?;
        if source.len() > 16 * 1024 * 1024 {
            return Err("Input limit exceeded".into());
        }
        run(serde_json::from_str(&source).map_err(|e| e.to_string())?)
    })();
    match result {
        Ok(value) => println!("{value}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
