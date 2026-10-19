//! The advisory `SIGIL_UNTAGGED_FACET` warning: operational Facets should name a
//! Tag in their own prose. Seeded from the TS CLI test in `cli_test.ts` and the
//! language server test in `lsp_test.ts`; no TS core test covers it.
use sigil_core::language::{
    fs::MemoryFs, resolve::ResolvedWorkspace, untagged::untagged_facet_diagnostics,
    workspace::Workspace,
};
use sigil_core::types::{Diagnostic, Severity, Stage};

const CONFIG: &str =
    r#"{"sigilVersion":"0.9.0","workspace":{"name":"test"},"files":{"include":["**/*.sigil"]}}"#;
const MESSAGE: &str = "Facet has no Tag reference or inline Tag definition in its prose.";

fn resolve(files: &[(&str, &str)]) -> ResolvedWorkspace {
    let mut fs = MemoryFs::new();
    fs.insert(".sigil/config.json", CONFIG);
    for (path, text) in files {
        fs.insert(path, *text);
    }
    ResolvedWorkspace::from(&Workspace::load_with(&fs).unwrap())
}

/// The text a warning points at, without the indent and line ending around it.
fn pointed_at<'a>(source: &'a str, d: &Diagnostic) -> &'a str {
    let range = d.range.as_ref().expect("a warning has a range");
    source[range.start..range.end].trim()
}

/// The 1-based line a warning starts on.
fn line_of(source: &str, d: &Diagnostic) -> usize {
    let start = d.range.as_ref().expect("a warning has a range").start;
    source[..start].matches('\n').count() + 1
}

fn component(name: &str, interface: &str) -> String {
    format!(
        "component {name} {{\n  goal {{\n    Own a responsibility.\n  }}\n\n  interface {{\n{interface}\n  }}\n}}\n"
    )
}

fn warn(files: &[(&str, &str)]) -> Vec<Diagnostic> {
    untagged_facet_diagnostics(&resolve(files))
}

const OPERATIONAL: &str = "component Feature {
  goal {
    Keep the current record available.
  }

  state {
    Track the current record.
  }

  logic {
    Calculate the next record.
  }

  constraints {
    Preserve record consistency.
  }

  cases {
    Handle an unavailable record.
  }

  interface {
    Record {
      read() returns the stored value.
    }

    Operations complete synchronously.
  }

  decisions {
    Prefer the current record.
  }
}
";

#[test]
fn goal_and_decisions_are_exempt_while_every_operational_facet_warns() {
    let found = warn(&[("contract.sigil", OPERATIONAL)]);
    // Six warnings, including the grouped Facet, as in the TS CLI test.
    let lines: Vec<usize> = found.iter().map(|d| line_of(OPERATIONAL, d)).collect();
    assert_eq!(lines, [7, 11, 15, 19, 24, 27]);
    for d in &found {
        assert_eq!(d.code, "SIGIL_UNTAGGED_FACET");
        assert_eq!(d.message, MESSAGE);
        assert!(matches!(d.severity, Severity::Warning));
        assert!(matches!(d.stage, Stage::Resolution));
        assert_eq!(d.file_path.as_deref(), Some("contract.sigil"));
        assert!(d.related.is_empty());
    }
}

#[test]
fn a_warning_points_at_the_facet_prose() {
    let source = component("C", "    Offer an interaction.");
    let found = warn(&[("c.sigil", &source)]);
    assert_eq!(found.len(), 1);
    assert_eq!(pointed_at(&source, &found[0]), "Offer an interaction.");
}

#[test]
fn goal_and_decisions_facets_alone_give_nothing() {
    let source = "component C {\n  goal {\n    Own a responsibility.\n  }\n\n  decisions {\n    Prefer the simple form.\n  }\n}\n";
    assert!(warn(&[("c.sigil", source)]).is_empty());
}

#[test]
fn an_inline_definition_or_a_resolved_reference_counts_as_a_tag() {
    let source = component(
        "C",
        "    A *query* has meaning.\n\n    Use query again.\n\n    Another plain facet.",
    );
    let found = warn(&[("c.sigil", &source)]);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(pointed_at(&source, &found[0]), "Another plain facet.");
}

#[test]
fn an_invalid_inline_definition_does_not_count_as_a_tag() {
    // A comma is forbidden in a Tag name, so `*a,b*` defines nothing.
    let source = component(
        "C",
        "    A *a,b* has meaning.\n\n    A *query* has meaning.",
    );
    let resolved = resolve(&[("c.sigil", &source)]);
    let facets = &resolved.declaration(&resolved.components[0]).sections[1].units;
    assert!(
        !facets[0].definitions.is_empty() && facets[0].definitions.iter().all(|d| !d.valid),
        "the first Facet holds only an invalid definition"
    );
    let found = untagged_facet_diagnostics(&resolved);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(pointed_at(&source, &found[0]), "A *a,b* has meaning.");
}

#[test]
fn a_reference_through_an_import_counts_as_a_tag() {
    let provider = component("P", "    A *query* has meaning.");
    let consumer = format!(
        "@p.sigil from P import {{ query }}\n{}",
        component("C", "    Use query.")
    );
    assert!(warn(&[("p.sigil", &provider), ("c.sigil", &consumer)]).is_empty());
}

#[test]
fn an_ambiguous_reference_names_no_tag_so_the_facet_still_warns() {
    let p = component("P", "    A *query* has meaning.");
    let q = component("Q", "    A *query* has meaning.");
    let consumer = format!(
        "@p.sigil from P import {{ query }}\n@q.sigil from Q import {{ query }}\n{}",
        component("C", "    Use query.")
    );
    let found = warn(&[("p.sigil", &p), ("q.sigil", &q), ("c.sigil", &consumer)]);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].file_path.as_deref(), Some("c.sigil"));
    assert_eq!(pointed_at(&consumer, &found[0]), "Use query.");
}

#[test]
fn a_source_with_incomplete_recovery_gives_no_warning() {
    // The Interface is never closed, so recovery hides authored content.
    let broken = "component C {\n  goal {\n    Own a responsibility.\n  }\n\n  interface {\n    Offer an interaction.\n";
    let resolved = resolve(&[("c.sigil", broken)]);
    assert!(
        !resolved.documents[0].complete,
        "the source must be incomplete"
    );
    assert!(untagged_facet_diagnostics(&resolved).is_empty());

    // A complete source beside it is still checked.
    let fine = component("D", "    Offer an interaction.");
    let found = warn(&[("c.sigil", broken), ("d.sigil", &fine)]);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].file_path.as_deref(), Some("d.sigil"));
}

#[test]
fn a_group_heading_is_not_part_of_the_facet_prose() {
    let source = component("C", "    query {\n      Use it as needed.\n    }");
    let found = warn(&[("c.sigil", &source)]);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(pointed_at(&source, &found[0]), "Use it as needed.");

    // The grouping Tag still counts for references written in other prose.
    let referenced = component(
        "C",
        "    query {\n      Use it as needed.\n    }\n\n    Also use query here.",
    );
    let found = warn(&[("c.sigil", &referenced)]);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(pointed_at(&referenced, &found[0]), "Use it as needed.");
}

#[test]
fn warnings_come_in_the_stable_diagnostic_order_across_files() {
    let b = component("B", "    Offer b.");
    let a = component("A", "    Offer a one.\n\n    Offer a two.");
    let found = warn(&[("b.sigil", &b), ("a.sigil", &a)]);
    let places: Vec<(String, usize)> = found
        .iter()
        .map(|d| {
            (
                d.file_path.clone().unwrap(),
                d.range.as_ref().unwrap().start,
            )
        })
        .collect();
    let mut sorted = places.clone();
    sorted.sort();
    assert_eq!(places, sorted);
    assert_eq!(places.len(), 3);
    assert_eq!(places[0].0, "a.sigil");
    assert_eq!(places[2].0, "b.sigil");
}

#[test]
fn resolution_itself_does_not_report_untagged_facets() {
    let source = component("C", "    Offer an interaction.");
    let resolved = resolve(&[("c.sigil", &source)]);
    assert!(
        resolved.diagnostics.is_empty(),
        "{:?}",
        resolved.diagnostics
    );
    assert_eq!(untagged_facet_diagnostics(&resolved).len(), 1);
}
