use sigilc::turtle::{self, Assertion, ONTOLOGY, Object, TurtleLimits};

fn parse(body: &str) -> Result<Vec<Assertion>, String> {
    turtle::parse(
        format!("@prefix s: <{ONTOLOGY}> . @prefix : <urn:test:> .\n{body}").as_bytes(),
        TurtleLimits::default(),
    )
}

#[test]
fn normalizes_order_prefixes_boolean_spellings_and_duplicate_assertions() {
    let a = parse(":A a s:Component; s:required true; s:label \"chat\"@FR .").unwrap();
    let b = parse(":A s:label \"chat\"@fr; s:required \"1\"^^<http://www.w3.org/2001/XMLSchema#boolean>; a s:Component . :A a s:Component .").unwrap();
    assert_eq!(a, b);
    assert_eq!(
        a.iter().map(Assertion::id).collect::<Vec<_>>(),
        b.iter().map(Assertion::id).collect::<Vec<_>>()
    );
    assert!(parse("").unwrap().is_empty());
    assert_eq!(
        parse(":A s:cost +0002 .").unwrap(),
        parse(":A s:cost 2 .").unwrap()
    );
}

#[test]
fn rejects_non_rdf11_named_assertions_unknown_vocabulary_and_removed_evidence() {
    for body in [
        ":A s:qualityScore 0.99 .",
        ":A a s:Invented .",
        ":G { :A a s:Component . }",
        "<<:A s:owns :B>> s:required true .",
        "_:a s:uses :B .",
        ":A s:uses _:b .",
        ":A s:known :B .",
        ":A s:complete-scope true .",
        ":A a s:Evidence .",
        ":A s:passes true .",
        ":A s:receiptClaim :B .",
        ":A s:obligation :B .",
        ":A s:uses \"B\" .",
        ":A s:label :B .",
        ":A s:required \"true\" .",
        ":A s:relation \"qualityScore\" .",
        ":A s:relation \"uses\"@en .",
        "```turtle\n:A a s:Component .\n```",
        ":A a s:Component . (include \"unsafe.egg\")",
    ] {
        assert!(parse(body).is_err(), "{body}");
    }
}

#[test]
fn rejects_malformed_and_out_of_range_numeric_literals_without_rounding_integers() {
    for (predicate, value) in [
        ("risk", "\"NaN\"^^s:double"),
        ("cost", "-1"),
        ("risk", "1.01"),
        ("cost", "9007199254740993"),
        ("cost", "9007199254740992"),
        ("cost", "1e309"),
        ("cost", "\"+\"^^<http://www.w3.org/2001/XMLSchema#double>"),
        (
            "cost",
            "\"0x20\"^^<http://www.w3.org/2001/XMLSchema#integer>",
        ),
        ("risk", "\"NaN\"^^<http://www.w3.org/2001/XMLSchema#double>"),
        ("cost", "\"INF\"^^<http://www.w3.org/2001/XMLSchema#double>"),
    ] {
        assert!(
            parse(&format!(":A s:{predicate} {value} .")).is_err(),
            "{predicate}: {value}"
        );
    }
    assert!(parse(":A s:cost 9007199254740991; s:risk 0.25 .").is_ok());
}

#[test]
fn validates_cached_resource_and_literal_shapes_again() {
    let mut assertion = parse(":A s:label \"hello\"@en .").unwrap().remove(0);
    assertion.subject = "not an IRI".into();
    assert!(turtle::validate(assertion.clone()).is_err());
    assertion.subject = "urn:test:A".into();
    if let Object::Literal { language, .. } = &mut assertion.object {
        *language = "!!bad".into();
    }
    assert!(turtle::validate(assertion).is_err());
}

#[test]
fn document_limits_are_explicit_and_count_duplicate_input_rows() {
    let source = format!("<urn:a> <{ONTOLOGY}uses> <urn:b> .");
    let limits = TurtleLimits {
        max_document_bytes: source.len(),
        max_assertions: 1,
    };
    assert!(turtle::parse(source.as_bytes(), limits).is_ok());
    assert!(
        turtle::parse(
            source.as_bytes(),
            TurtleLimits {
                max_document_bytes: 2,
                ..limits
            }
        )
        .is_err()
    );
    assert!(
        turtle::parse(
            format!("{source}{source}").as_bytes(),
            TurtleLimits {
                max_document_bytes: 1000,
                ..limits
            }
        )
        .is_err()
    );
}
