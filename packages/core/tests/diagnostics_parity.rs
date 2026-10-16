//! Diagnostic ordering and coalescing.
//! Ported from `diagnostics_test.ts`.
use sigil_core::{
    language::diagnostics::{Location, diagnostic, order_diagnostics},
    types::{Diagnostic, Range, RelatedLocation, Severity, Stage},
};
use std::collections::HashSet;

fn located(code: &str, message: &str, file_path: Option<&str>, start: usize) -> Diagnostic {
    diagnostic(
        code,
        message,
        Location {
            file_path: file_path.map(str::to_owned),
            range: Some(Range {
                start,
                end: start + 1,
            }),
            related: Vec::new(),
        },
    )
}

#[test]
fn diagnostics_use_source_order_and_unicode_scalar_ordering_not_severity() {
    let make = |file_path: Option<&str>| located("SIGIL_PARSE_STRUCTURE", "problem", file_path, 2);
    let mut warning = located(
        "SIGIL_IMPLEMENTATION_SOURCE_DISCOVERY",
        "advisory",
        Some("a.sigil"),
        1,
    );
    warning.severity = Severity::Warning;
    let ordered = order_diagnostics(vec![
        make(Some("\u{10000}.sigil")),
        make(Some("\u{e000}.sigil")),
        make(Some("z.sigil")),
        warning,
        make(None),
    ]);
    let paths: Vec<Option<&str>> = ordered.iter().map(|d| d.file_path.as_deref()).collect();
    assert_eq!(
        paths,
        [
            None,
            Some("a.sigil"),
            Some("z.sigil"),
            Some("\u{e000}.sigil"),
            Some("\u{10000}.sigil"),
        ]
    );
}

#[test]
fn diagnostic_coalescing_preserves_stage_and_related_evidence_with_numeric_related_ordering() {
    let make = |start: usize| {
        diagnostic(
            "SIGIL_DUPLICATE_SECTION",
            "duplicate",
            Location {
                file_path: Some("a.sigil".to_owned()),
                range: Some(Range { start: 0, end: 1 }),
                related: vec![RelatedLocation {
                    file_path: Some("b.sigil".to_owned()),
                    range: Some(Range {
                        start,
                        end: start + 1,
                    }),
                    implementation_range: None,
                    source_digest: None,
                    message: None,
                }],
            },
        )
    };
    let (earlier, later) = (make(2), make(10));
    let mut other_stage = earlier.clone();
    other_stage.stage = Stage::Interpretation;
    let ordered = order_diagnostics(vec![later, earlier.clone(), earlier, other_stage]);
    // The two identical records coalesce; the other stage and both related ranges survive.
    assert_eq!(ordered.len(), 3);
    let related_starts: Vec<usize> = ordered
        .iter()
        .map(|d| d.related[0].range.as_ref().unwrap().start)
        .collect();
    assert_eq!(related_starts, [2, 2, 10]);
    let stages: HashSet<String> = ordered[..2]
        .iter()
        .map(|d| format!("{:?}", d.stage))
        .collect();
    assert_eq!(stages.len(), 2);
}
