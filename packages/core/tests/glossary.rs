//! Glossary terms: parsing, bounded contexts and occurrences in facet prose.
//! Ported from the TS `core_test.ts` glossary tests.
use serde_json::{Value, json};
use sigil_core::language::{
    fs::MemoryFs,
    glossary::{GlossaryScope, glossary_projection, parse_glossary, resolve_glossary_for_file},
    resolve::ResolvedWorkspace,
    workspace::Workspace,
};

const CONFIG: &str = r#"{"sigilVersion":"0.9.0","workspace":{"name":"test"},"files":{"include":["**/*.sigil"]},"tools":{}}"#;

fn glossary_source(overrides: Value) -> String {
    let mut base = json!({
        "schemaVersion": 1,
        "terms": [
            {"term": "workspace root", "definition": "The directory containing .sigil/config.json."},
            {"term": "workspace", "definition": "Sources governed by one Sigil configuration."},
            {"term": "hold", "definition": "A general temporary claim."},
        ],
        "contexts": [{
            "id": "booking",
            "include": ["booking/**/*.sigil"],
            "exclude": [],
            "terms": [{
                "term": "hold",
                "definition": "Booking capacity before confirmation.",
                "aliases": ["temporary reservation"],
            }],
        }],
    });
    for (key, value) in overrides.as_object().into_iter().flatten() {
        base[key] = value.clone();
    }
    serde_json::to_string_pretty(&base).unwrap()
}

fn workspace(glossary: &str, sources: &[(&str, &str)]) -> Workspace {
    let mut fs = MemoryFs::new();
    fs.insert(".sigil/config.json", CONFIG);
    fs.insert(".sigil/glossary.json", glossary);
    for (path, text) in sources {
        fs.insert(path, *text);
    }
    Workspace::load_with(&fs).unwrap()
}

fn component(goal: &str) -> String {
    format!(
        "component Booking {{\n  goal {{\n    {goal}\n  }}\n\n  interface {{\n    Offer an interaction.\n  }}\n}}\n"
    )
}

fn matches(workspace: &Workspace) -> Vec<String> {
    let resolved = ResolvedWorkspace::from(workspace);
    glossary_projection(workspace, &resolved)
        .occurrences
        .iter()
        .map(|o| format!("{}:{}", o.term.term, o.matched_spelling))
        .collect()
}

#[test]
fn the_longest_spelling_wins_inside_a_bounded_context_and_code_and_urls_are_ignored() {
    let source = "component Booking {
  goal {
    Explain workspace root and workspace while a hold is active.

    Ignore `workspace root` and https://example.test/workspace:
    ```
    workspace root
    ```
  }

  interface {
    BookingTerm {
      A temporary reservation creates a hold.
    }
  }
}
";
    let workspace = workspace(
        &glossary_source(json!({})),
        &[("booking/booking.sigil", source)],
    );
    let resolved = ResolvedWorkspace::from(&workspace);
    assert!(
        resolved.diagnostics.is_empty(),
        "{:?}",
        resolved.diagnostics
    );
    let projection = glossary_projection(&workspace, &resolved);
    assert_eq!(
        projection.resolved_contexts[0].context_id.as_deref(),
        Some("booking")
    );
    let found = matches(&workspace);
    assert!(found.contains(&"workspace root:workspace root".to_owned()));
    assert!(found.contains(&"workspace:workspace".to_owned()));
    assert!(found.contains(&"hold:temporary reservation".to_owned()));
    assert_eq!(
        found
            .iter()
            .filter(|m| *m == "workspace root:workspace root")
            .count(),
        1,
        "{found:?}"
    );
    let hold = projection
        .occurrences
        .iter()
        .find(|o| o.matched_spelling == "hold")
        .expect("hold");
    assert_eq!(
        hold.term.definition,
        "Booking capacity before confirmation."
    );
    assert_eq!(hold.term.scope, GlossaryScope::Context("booking".into()));
    assert_eq!(hold.owner_name, "Booking");
}

#[test]
fn a_context_redefinition_replaces_the_workspace_term_and_its_aliases() {
    let glossary = parse_glossary(
        glossary_source(json!({
            "terms": [{"term": "hold", "definition": "x", "aliases": ["reservation", "claim"]}],
            "contexts": [{
                "id": "booking", "include": ["booking/**"], "exclude": [],
                "terms": [{"term": "Hold", "definition": "y", "aliases": ["claim"]}],
            }],
        }))
        .as_bytes(),
        ".sigil/glossary.json",
    )
    .glossary
    .expect("valid");
    let (context, overlap) = resolve_glossary_for_file(&glossary, "booking/a.sigil");
    assert!(overlap.is_none());
    assert_eq!(context.context_id.as_deref(), Some("booking"));
    // The workspace `hold` is replaced by the context's `Hold`, aliases included.
    let spellings: Vec<&str> = context
        .entries
        .iter()
        .flat_map(|t| std::iter::once(t.term.as_str()).chain(t.aliases.iter().map(String::as_str)))
        .collect();
    assert_eq!(spellings, ["Hold", "claim"]);
    let (outside, _) = resolve_glossary_for_file(&glossary, "other/a.sigil");
    assert!(outside.context_id.is_none());
    assert_eq!(outside.entries.len(), 1);
}

#[test]
fn matching_ignores_case_needs_word_boundaries_and_reports_utf8_byte_ranges() {
    let source = component("😀 The Hold, a holdall, and HOLD.");
    let workspace = workspace(
        &glossary_source(json!({"contexts": []})),
        &[("a.sigil", &source)],
    );
    let resolved = ResolvedWorkspace::from(&workspace);
    let projection = glossary_projection(&workspace, &resolved);
    let spelled: Vec<&str> = projection
        .occurrences
        .iter()
        .map(|o| o.matched_spelling.as_str())
        .collect();
    assert_eq!(spelled, ["Hold", "HOLD"]);
    let text = &workspace.sources[0].capture.source.as_ref().unwrap().text;
    for occurrence in &projection.occurrences {
        assert_eq!(
            &text[occurrence.range.start..occurrence.range.end],
            occurrence.matched_spelling
        );
    }
    assert_eq!(projection.occurrences[0].term.term, "hold");
}

#[test]
fn a_term_is_agent_visible_unless_it_says_otherwise_and_knows_where_it_is_declared() {
    let text = glossary_source(json!({
        "terms": [
            {"term": "Decision:", "definition": "A convention.", "agentContext": false},
            {"term": "queue", "definition": "Work awaiting processing."},
        ],
        "contexts": [],
    }));
    let glossary = parse_glossary(text.as_bytes(), ".sigil/glossary.json")
        .glossary
        .unwrap();
    assert!(!glossary.terms[0].agent_context);
    assert!(glossary.terms[1].agent_context);
    let range = &glossary.terms[1].declaration_range;
    assert_eq!(&text[range.start..range.end], "queue");
    assert_eq!(glossary.terms[1].scope, GlossaryScope::Workspace);
}

#[test]
fn a_source_matching_two_contexts_has_no_occurrences_and_reports_the_overlap() {
    let glossary = glossary_source(json!({"contexts": [
        {"id": "a", "include": ["**/*.sigil"], "exclude": [], "terms": [{"term": "x", "definition": "d"}]},
        {"id": "b", "include": ["booking/**"], "exclude": [], "terms": [{"term": "y", "definition": "d"}]},
    ]}));
    let source = component("A hold.");
    let workspace = workspace(&glossary, &[("booking/a.sigil", &source)]);
    let resolved = ResolvedWorkspace::from(&workspace);
    let projection = glossary_projection(&workspace, &resolved);
    assert!(projection.occurrences.is_empty());
    assert!(
        projection
            .diagnostics
            .iter()
            .any(|d| d.code == "SIGIL_GLOSSARY_CONTEXT_OVERLAP")
    );
}

#[test]
fn a_workspace_without_a_glossary_has_an_empty_projection() {
    let mut fs = MemoryFs::new();
    fs.insert(".sigil/config.json", CONFIG);
    fs.insert("a.sigil", component("A hold."));
    let workspace = Workspace::load_with(&fs).unwrap();
    let resolved = ResolvedWorkspace::from(&workspace);
    let projection = glossary_projection(&workspace, &resolved);
    assert!(projection.glossary_path.is_none());
    assert!(projection.occurrences.is_empty());
    assert!(projection.resolved_contexts.is_empty());
}

/// The repository's own glossary over its own sources, as the TS reader found
/// them (`scripts/generate-format-fixtures.ts` writes the fixture).
#[test]
fn the_repository_glossary_finds_the_occurrences_the_ts_reader_found() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/glossary/repository.json")).unwrap();
    let mut fs = MemoryFs::new();
    fs.insert(".sigil/config.json", CONFIG);
    fs.insert(
        ".sigil/glossary.json",
        fixture["glossary"].as_str().unwrap(),
    );
    for (path, text) in fixture["files"].as_object().unwrap() {
        fs.insert(path, text.as_str().unwrap());
    }
    let workspace = Workspace::load_with(&fs).unwrap();
    let resolved = ResolvedWorkspace::from(&workspace);
    let projection = glossary_projection(&workspace, &resolved);
    let found: Vec<Value> = projection
        .occurrences
        .iter()
        .map(|o| {
            json!({
                "term": o.term.term,
                "matched": o.matched_spelling,
                "path": o.file_path,
                "owner": o.owner_name,
                "section": o.section_name,
                "range": {"start": o.range.start, "end": o.range.end},
            })
        })
        .collect();
    let expected = fixture["occurrences"].as_array().unwrap();
    assert!(expected.len() > 50, "{} occurrences", expected.len());
    assert_eq!(found.len(), expected.len());
    for (index, (got, want)) in found.iter().zip(expected).enumerate() {
        assert_eq!(got, want, "occurrence {index}");
    }
}
