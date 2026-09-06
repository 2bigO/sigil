use sigilc::{
    comparison::{self, FreshInputs, ImplementationState as I},
    kernel::{self, DesignState as D, Limits},
    turtle::{self, ONTOLOGY, TurtleLimits},
};

fn facts(body: &str) -> Vec<turtle::Assertion> {
    turtle::parse(
        format!("@prefix s: <{ONTOLOGY}> . @prefix : <urn:test:> .\n{body}").as_bytes(),
        TurtleLimits::default(),
    )
    .unwrap()
}
const FRESH: FreshInputs = FreshInputs {
    all_design_fresh: true,
    all_implementation_fresh: true,
};
fn compare(d: &str, i: &str, fresh: FreshInputs) -> comparison::Comparison {
    let d = kernel::design(&facts(d), &[], Limits::default()).unwrap();
    let i = kernel::saturate(&facts(i), Limits::default()).unwrap();
    comparison::compare(&d, &i, fresh, Limits::default()).unwrap()
}

#[test]
fn design_cannot_satisfy_itself_and_missing_information_cannot_manufacture_closed() {
    let empty = compare(":A s:provides :X .", "", FRESH);
    assert_eq!(empty.design, D::Coherent);
    assert_eq!(empty.implementation, Some(I::Converged));
    assert!(empty.satisfied.is_empty());
    assert_eq!(empty.unresolved.len(), 1);
    assert_eq!(
        compare(":A s:provides :X .", ":A s:provides :X .", FRESH).implementation,
        Some(I::Closed)
    );
    for fresh in [
        FreshInputs {
            all_implementation_fresh: false,
            ..FRESH
        },
        FreshInputs {
            all_design_fresh: false,
            ..FRESH
        },
    ] {
        assert_eq!(
            compare(":A s:provides :X .", ":A s:provides :X .", fresh).implementation,
            Some(I::Converged)
        );
    }
    let loose = compare(":A s:requires :X .", ":A s:provides :X .", FRESH);
    assert_eq!(loose.design, D::Loose);
    assert_eq!(loose.implementation, Some(I::Converged));
}

#[test]
fn prohibitions_remain_unknown_unless_positively_contradicted() {
    assert_eq!(
        compare(":A s:excludes :X .", "", FRESH).implementation,
        Some(I::Converged)
    );
    let drift = compare(
        ":A s:excludes :X .",
        ":A s:uses :X .",
        FreshInputs {
            all_implementation_fresh: false,
            ..FRESH
        },
    );
    assert_eq!(drift.implementation, Some(I::Drift));
    assert!(!drift.disagreements.is_empty());
    let impossible = compare(":A s:excludes :X; s:uses :X .", ":A s:uses :X .", FRESH);
    assert_eq!(impossible.design, D::Disjoint);
    assert_eq!(impossible.implementation, None);
}

#[test]
fn availability_uses_only_implementation_relations() {
    let design = ":A s:requires :X; s:dependsOn :B . :B s:provides :X .";
    assert_eq!(
        compare(design, ":B s:provides :X .", FRESH).implementation,
        Some(I::Converged)
    );
    assert_eq!(
        compare(design, ":A s:dependsOn :B . :B s:provides :X .", FRESH).implementation,
        Some(I::Closed)
    );
}

#[test]
fn numerical_budgets_and_ownership_use_obligations_without_design_fact_leakage() {
    for (actual, expected) in [
        ("", I::Converged),
        (":A s:latencyMs 20 .", I::Closed),
        (":A s:latencyMs 21 .", I::Drift),
        (":A s:latencyMs 19, 21 .", I::Drift),
    ] {
        assert_eq!(
            compare(":A s:latencyBudgetMs 20 .", actual, FRESH).implementation,
            Some(expected)
        );
    }
    let required = ":S a s:State; s:required true . :A s:owns :S .";
    assert_eq!(
        compare(required, "", FRESH).implementation,
        Some(I::Converged)
    );
    assert_eq!(
        compare(required, ":A s:owns :S .", FRESH).implementation,
        Some(I::Closed)
    );
    let exclusive = ":S s:exclusive true .";
    assert_eq!(
        compare(exclusive, ":A s:owns :S .", FRESH).implementation,
        Some(I::Converged)
    );
    assert_eq!(
        compare(exclusive, ":A s:owns :S . :B s:owns :S .", FRESH).implementation,
        Some(I::Drift)
    );
}

#[test]
fn design_closure_and_previous_runtime_reports_cannot_be_passed_as_implementation() {
    let d = kernel::design(&facts(":A s:provides :X ."), &[], Limits::default()).unwrap();
    assert!(comparison::compare(&d, &d.closure, FRESH, Limits::default()).is_err());
    let mut i = kernel::saturate(&[], Limits::default()).unwrap();
    i.kernel_fingerprint = "old-runtime".into();
    assert!(comparison::compare(&d, &i, FRESH, Limits::default()).is_err());
    let i = kernel::saturate(&[], Limits::default()).unwrap();
    assert!(
        comparison::compare(
            &d,
            &i,
            FRESH,
            Limits {
                max_iterations: 0,
                ..Default::default()
            }
        )
        .is_err()
    );
}
