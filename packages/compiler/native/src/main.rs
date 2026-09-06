use egglog::{
    EGraph, Term,
    ast::{Action, Command, Expr, Literal},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{self, Read},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    version: u32,
    #[serde(default)]
    facts: Vec<Fact>,
    #[serde(default)]
    assertions: Option<String>,
    #[serde(default)]
    implementation: bool,
    #[serde(default)]
    observations: Vec<Observation>,
    #[serde(default)]
    complete_scopes: Vec<CompleteScope>,
    #[serde(default)]
    required_checks: Vec<String>,
    #[serde(default)]
    checks: Vec<CheckResult>,
    #[serde(default)]
    receipt_claims: Vec<ReceiptClaim>,
    #[serde(default)]
    receipt_locations: Vec<[String; 2]>,
    #[serde(default)]
    symbol_owners: Vec<[String; 2]>,
    #[serde(default)]
    scoped_observations: Vec<[String; 4]>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReceiptClaim {
    receipt: String,
    obligation: String,
    subject: String,
    predicate: String,
    object: String,
    expected: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CheckResult {
    id: String,
    passed: bool,
    evidence: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Observation {
    subject: String,
    predicate: String,
    object: String,
    evidence: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteScope {
    subject: String,
    predicate: String,
    #[serde(default)]
    object: Option<String>,
    evidence: String,
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
    if let Some(source) = input.assertions {
        if !input.facts.is_empty()
            || input.implementation
            || !input.observations.is_empty()
            || !input.complete_scopes.is_empty()
            || !input.required_checks.is_empty()
            || !input.checks.is_empty()
            || !input.receipt_claims.is_empty()
            || !input.receipt_locations.is_empty()
            || !input.symbol_owners.is_empty()
            || !input.scoped_observations.is_empty()
        {
            return Err("Assertion parsing cannot include execution inputs".into());
        }
        let mut parser = EGraph::default();
        let commands = parser
            .parse_program(None, &source)
            .map_err(|error| error.to_string())?;
        let mut rows = Vec::new();
        for command in commands {
            let Command::Action(Action::Expr(_, Expr::Call(_, name, args))) = command else {
                return Err(
                    "World files may contain only assertion data, never commands or rules".into(),
                );
            };
            let arity = match name.as_str() {
                "assert-iri" => 3,
                "assert-literal" => 5,
                _ => return Err("Unknown world assertion table".into()),
            };
            if args.len() != arity {
                return Err("Invalid world assertion arity".into());
            }
            let mut row = vec![name];
            for arg in args {
                let Expr::Lit(_, Literal::String(value)) = arg else {
                    return Err("World assertion arguments must be literal strings".into());
                };
                row.push(value);
            }
            rows.push(row);
        }
        return Ok(json!({"version": 1, "assertions": rows}));
    }
    let mut program = String::from(include_str!("kernel.egg"));
    if input.implementation {
        program.push_str("\n(implementation-mode)");
    }
    for claim in input.receipt_claims {
        program.push_str(&format!(
            "\n(receipt-claim {} {} {} {} {} {})",
            egg_string(&claim.receipt),
            egg_string(&claim.obligation),
            egg_string(&claim.subject),
            egg_string(&claim.predicate),
            egg_string(&claim.object),
            egg_string(if claim.expected { "true" } else { "false" })
        ));
    }
    for (table, rows) in [
        ("receipt-location", input.receipt_locations),
        ("symbol-owner", input.symbol_owners),
    ] {
        for row in rows {
            program.push_str(&format!(
                "\n({table} {} {})",
                egg_string(&row[0]),
                egg_string(&row[1])
            ));
        }
    }
    for row in input.scoped_observations {
        program.push_str(&format!(
            "\n(scoped-observation {} {} {} {})",
            egg_string(&row[0]),
            egg_string(&row[1]),
            egg_string(&row[2]),
            egg_string(&row[3])
        ));
    }
    for observation in input.observations {
        program.push_str(&format!(
            "\n(observation {} {} {} {})",
            egg_string(&observation.subject),
            egg_string(&observation.predicate),
            egg_string(&observation.object),
            egg_string(&observation.evidence)
        ));
    }
    for scope in input.complete_scopes {
        program.push_str(&format!(
            "\n(complete-scope {} {} {} {})",
            egg_string(&scope.subject),
            egg_string(&scope.predicate),
            egg_string(scope.object.as_deref().unwrap_or("*")),
            egg_string(&scope.evidence)
        ));
    }
    for id in input.required_checks {
        program.push_str(&format!("\n(required-check {})", egg_string(&id)));
    }
    for check in input.checks {
        program.push_str(&format!(
            "\n(check-result {} {} {})",
            egg_string(&check.id),
            egg_string(if check.passed { "true" } else { "false" }),
            egg_string(&check.evidence)
        ));
    }
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
        "proposition",
        "coverage",
        "implementation-satisfied",
        "receipt-result",
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
    let kernel_fingerprint = format!(
        "{:x}",
        Sha256::digest(concat!(
            include_str!("kernel.egg"),
            include_str!("schedule.egg"),
            include_str!("main.rs"),
            include_str!("../Cargo.toml"),
            include_str!("../Cargo.lock")
        ))
    );
    Ok(
        json!({"version": 1, "kernelVersion": "1", "kernelFingerprint": kernel_fingerprint, "tables": tables}),
    )
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
