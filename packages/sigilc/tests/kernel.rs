use serde_json::json;
use sigilc::{
    kernel::{self, Limits, SaturatedWorld},
    turtle::{self, ONTOLOGY, TurtleLimits},
};

fn world(body: &str) -> Result<SaturatedWorld, String> {
    let source = format!("@prefix s: <{ONTOLOGY}> . @prefix : <urn:test:> .\n{body}");
    let facts = turtle::parse(source.as_bytes(), TurtleLimits::default())?;
    kernel::saturate(&facts, Limits::default())
}

#[test]
fn enriches_local_objects_with_cross_file_relations_in_isolated_graphs() {
    let a = turtle::parse(
        format!("<urn:a> <{ONTOLOGY}dependsOn> <urn:b> .").as_bytes(),
        TurtleLimits::default(),
    )
    .unwrap();
    let a_object = sigilc::assertions::encode(&a).unwrap();
    let mut linked = a.clone();
    linked.extend(
        turtle::parse(
            format!("<urn:b> <{ONTOLOGY}dependsOn> <urn:c> .").as_bytes(),
            TurtleLimits::default(),
        )
        .unwrap(),
    );
    let first = kernel::saturate(&linked, Limits::default()).unwrap();
    assert!(first.tables["reachable"].contains(&vec![json!("urn:a"), json!("urn:c")]));
    let alone = kernel::saturate(&a, Limits::default()).unwrap();
    assert!(!alone.tables["reachable"].contains(&vec![json!("urn:a"), json!("urn:c")]));
    assert_eq!(sigilc::assertions::encode(&a).unwrap(), a_object);
    let empty = kernel::saturate(&[], Limits::default()).unwrap();
    assert!(empty.tables["known"].is_empty());
    assert_eq!(empty.kernel_fingerprint, first.kernel_fingerprint);
}

#[test]
fn retains_delegation_numerical_merges_and_cycle_termination() {
    let output = world(":A s:delegates :B; s:dependsOn :B; s:risk 0.1 . :B s:provides :X; s:dependsOn :C . :C s:risk 0.7 .
      :AB a s:Dependency; s:from :A; s:to :B; s:cost 2 .
      :BC a s:Dependency; s:from :B; s:to :C; s:cost 3 .
      :AC a s:Dependency; s:from :A; s:to :C; s:cost 10 .
      :CA a s:Dependency; s:from :C; s:to :A; s:cost 1 .").unwrap();
    assert!(output.tables["known"].contains(&vec![
        json!("urn:test:A"),
        json!("provides"),
        json!("urn:test:X")
    ]));
    assert!(output.tables["path-cost"].contains(&vec![
        json!("urn:test:A"),
        json!("urn:test:C"),
        json!(5.0)
    ]));
    assert!(output.tables["risk-score"].contains(&vec![json!("urn:test:A"), json!(0.7)]));
    assert!(output.iterations < 100);
}

#[test]
fn raw_conflicts_and_negative_propositions_survive_closure() {
    for body in [
        ":A s:excludes :X; s:uses :X .",
        ":S s:exclusive true . :A s:owns :S . :B s:owns :S .",
        ":A s:risk 0.1, 0.7 .",
        ":A s:required true, false .",
        ":A s:latencyBudgetMs 20; s:latencyMs 21 .",
        ":D a s:Dependency; s:from :A, :B; s:to :C; s:cost 1 .",
        ":P a s:Contract; s:from :A; s:relation \"provides\"; s:target :X; s:expected false . :A s:delegates :B . :B s:provides :X .",
        ":P a s:Contract; s:from :A; s:relation \"invokes\"; s:target :B; s:expected true; s:required true . :Q a s:Contract; s:from :A; s:relation \"invokes\"; s:target :B; s:expected false; s:required true .",
    ] {
        assert!(
            !world(body).unwrap().tables["violation"].is_empty(),
            "{body}"
        );
    }
}

#[test]
fn exhausted_limits_or_unsupported_arithmetic_return_no_completed_world() {
    for limits in [
        Limits {
            max_iterations: 0,
            ..Default::default()
        },
        Limits {
            max_rows: 0,
            ..Default::default()
        },
        Limits {
            max_elapsed_ms: 0,
            ..Default::default()
        },
    ] {
        assert!(kernel::saturate(&[], limits).is_err());
    }
    assert!(world(":AB a s:Dependency; s:from :A; s:to :B; s:cost 9007199254740991 . :BC a s:Dependency; s:from :B; s:to :C; s:cost 1 .").unwrap_err().contains("arithmetic"));
}
