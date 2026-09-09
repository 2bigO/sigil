//! Restricted data-only .egg transport, adapted from the former native reader.
use crate::turtle::{Assertion, Object, TurtleLimits, validate};
use egglog::{
    EGraph,
    ast::{Action, Command, Expr, Literal},
};
use std::collections::BTreeSet;

// @sigil implements packages/sigilc/turtle.sigil::SigilTurtleInput::RestrictedAssertions interface
pub fn encode(assertions: &[Assertion]) -> Result<String, String> {
    let normalized: BTreeSet<_> = assertions
        .iter()
        .cloned()
        .map(validate)
        .collect::<Result<_, _>>()?;
    let mut output = String::from("; Sigil assertions v1. Data only; laws are compiler-owned.\n");
    for assertion in normalized {
        let (table, args) = match &assertion.object {
            Object::Iri { value } => (
                "assert-iri",
                vec![&assertion.subject, &assertion.predicate, value],
            ),
            Object::Literal {
                value,
                datatype,
                language,
            } => (
                "assert-literal",
                vec![
                    &assertion.subject,
                    &assertion.predicate,
                    value,
                    datatype,
                    language,
                ],
            ),
        };
        output.push_str(&format!(
            "({table} {})\n",
            args.into_iter()
                .map(|s| quote(s))
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }
    Ok(output)
}

// @sigil implements packages/sigilc/turtle.sigil::SigilTurtleInput::RestrictedAssertions interface
pub fn parse(source: &str, limits: TurtleLimits) -> Result<Vec<Assertion>, String> {
    if source.len() > limits.max_document_bytes {
        return Err("assertion document exceeds byte limit".into());
    }
    let commands = EGraph::default()
        .parse_program(None, source)
        .map_err(|e| e.to_string())?;
    if commands.len() > limits.max_assertions {
        return Err("assertion document exceeds row limit".into());
    }
    let mut assertions = BTreeSet::new();
    for command in commands {
        let Command::Action(Action::Expr(_, Expr::Call(_, name, args))) = command else {
            return Err("world files contain assertion data only, never commands or rules".into());
        };
        let arity = match name.as_str() {
            "assert-iri" => 3,
            "assert-literal" => 5,
            _ => return Err("unknown assertion table".into()),
        };
        if args.len() != arity {
            return Err("invalid assertion arity".into());
        }
        let values = args
            .into_iter()
            .map(|arg| match arg {
                Expr::Lit(_, Literal::String(value)) => Ok(value),
                _ => Err("assertion arguments must be literal strings".to_string()),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let object = if arity == 3 {
            Object::Iri {
                value: values[2].clone(),
            }
        } else {
            Object::Literal {
                value: values[2].clone(),
                datatype: values[3].clone(),
                language: values[4].clone(),
            }
        };
        assertions.insert(validate(Assertion {
            subject: values[0].clone(),
            predicate: values[1].clone(),
            object,
        })?);
    }
    Ok(assertions.into_iter().collect())
}

/// Egglog accepts four escapes; JSON's additional \r/\u escapes are invalid here.
pub fn quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\t', "\\t")
    )
}
