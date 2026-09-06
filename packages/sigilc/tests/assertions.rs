use sigilc::{
    assertions,
    turtle::{self, Assertion, ONTOLOGY, Object, TurtleLimits, XSD},
};

#[test]
fn restricted_objects_round_trip_text_datatypes_and_all_egglog_escapes() {
    let mut facts = turtle::parse(
        format!(
            "@prefix s: <{ONTOLOGY}> . <urn:a> a s:Component; s:uses <urn:b>; s:required true ."
        )
        .as_bytes(),
        TurtleLimits::default(),
    )
    .unwrap();
    facts.push(Assertion {
        subject: "urn:a".into(),
        predicate: format!("{ONTOLOGY}description"),
        object: Object::Literal {
            value: "\" ) (panic \"injected\") \\ tab:\t line:\n carriage:\r nul:\0 unicode:λ"
                .into(),
            datatype: format!("{XSD}string"),
            language: String::new(),
        },
    });
    let encoded = assertions::encode(&facts).unwrap();
    let decoded = assertions::parse(&encoded, TurtleLimits::default()).unwrap();
    assert_eq!(assertions::encode(&decoded).unwrap(), encoded);
    facts.sort();
    assert_eq!(decoded, facts);
    assert!(
        assertions::parse(&assertions::encode(&[]).unwrap(), TurtleLimits::default())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn cached_objects_cannot_execute_rules_includes_or_expression_arguments() {
    for source in [
        "(include \"missing-file.egg\")",
        "(panic \"injected\")",
        "(run 10)",
        "(relation known (String))",
        "(rule ((= x 1)) ((panic \"bad\")))",
        "(assert-iri \"urn:a\" \"urn:p\" (+ \"urn:\" \"b\"))",
        "(assert-iri \"urn:a\" \"urn:p\" 1)",
        "(assert-iri \"urn:a\")",
        "(assert-iri \"urn:a\" \"urn:p\" \"urn:b\")",
        "(assert-iri \"relative\" \"https://sigil.dev/ontology/1#uses\" \"urn:b\")",
        "(assert-literal \"urn:a\" \"https://sigil.dev/ontology/1#risk\" \"NaN\" \"http://www.w3.org/2001/XMLSchema#double\" \"\")",
    ] {
        assert!(
            assertions::parse(source, TurtleLimits::default()).is_err(),
            "{source}"
        );
    }
}
