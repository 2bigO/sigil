//! Paths, globs, parsing of Facets, and glossary data.
//! Ported from selected tests in `core_test.ts`.
use serde_json::{Value, json};
use sigil_core::{
    language::{
        config::{matches_source_file, parse_config},
        fs::MemoryFs,
        glossary::parse_glossary,
        parse::{Component, Document, Facet, Section, parse_document},
        path::normalize_path,
        resolve::ResolvedWorkspace,
        text::capture_source,
        workspace::Workspace,
    },
    types::{Diagnostic, Severity},
};

const ROOT_MODULE: &str = "component Sigil {\n  goal {\n    Preserve rationale.\n  }\n\n  interface {\n    provides contracts\n  }\n}\n";

/// The workspace config of the TS tests, with top-level members replaced by `overrides`.
fn config_source(overrides: Value) -> String {
    let mut config = json!({
        "sigilVersion": "0.9.0",
        "workspace": { "name": "test" },
        "files": { "include": ["**/*.sigil"] },
        "tools": {},
    });
    merge(&mut config, overrides);
    config.to_string()
}

fn glossary_source(overrides: Value) -> String {
    let mut glossary = json!({
        "schemaVersion": 1,
        "terms": [
            { "term": "workspace root", "definition": "The directory containing .sigil/config.json." },
            { "term": "workspace", "definition": "Sources governed by one Sigil configuration." },
            { "term": "hold", "definition": "A general temporary claim." },
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
    merge(&mut glossary, overrides);
    serde_json::to_string_pretty(&glossary).unwrap()
}

fn merge(base: &mut Value, overrides: Value) {
    if let (Some(base), Value::Object(overrides)) = (base.as_object_mut(), overrides) {
        base.extend(overrides);
    }
}

fn parse(path: &str, text: &str) -> Document {
    parse_document(path, &capture_source(path, text.as_bytes()))
}

fn codes(diagnostics: &[Diagnostic]) -> Vec<&str> {
    diagnostics.iter().map(|d| d.code.as_str()).collect()
}

fn section<'a>(component: &'a Component, name: &str) -> &'a Section {
    component
        .sections
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("no {name} section"))
}

/// The Facet's prose as written in the source.
fn prose<'a>(document: &'a Document, facet: &Facet) -> &'a str {
    let text = &document.source.as_ref().unwrap().text;
    text[facet.prose_range.start..facet.prose_range.end].trim()
}

fn assert_has_code(diagnostics: &[Diagnostic], code: &str) {
    assert!(
        diagnostics.iter().any(|d| d.code == code),
        "expected {code}, got {:?}",
        codes(diagnostics)
    );
}

fn glossary_codes(source: String) -> Vec<String> {
    parse_glossary(source.as_bytes(), ".sigil/glossary.json")
        .diagnostics
        .into_iter()
        .map(|d| d.code)
        .collect()
}

#[test]
fn normalizes_and_walks_posix_and_windows_paths() {
    assert_eq!(normalize_path("/work/./sigil/../project"), "/work/project");
    assert_eq!(
        normalize_path("C:\\work\\sigil\\..\\project"),
        "C:/work/project"
    );
    // `dirname` and `ancestorsFrom` are TS-only: the Rust reader has no counterpart, since
    // discovery walks real `Path::ancestors` instead of normalized text.
}

#[test]
fn glob_includes_root_files_and_exclusion_wins() {
    let overrides = json!({ "files": { "include": ["**/*.sigil"], "exclude": ["generated/**"] } });
    let parsed = parse_config(&config_source(overrides.clone()), ".sigil/config.json");
    let config = parsed.config.expect("the config is valid");
    assert!(matches_source_file("root.sigil", &config));
    assert!(matches_source_file("src/feature.sigil", &config));
    assert!(!matches_source_file("generated/feature.sigil", &config));

    let mut files = MemoryFs::new();
    files.insert(".sigil/config.json", config_source(overrides));
    files.insert("root.sigil", ROOT_MODULE);
    files.insert("generated/ignored.sigil", ROOT_MODULE);
    let workspace = Workspace::load_with(&files).unwrap();
    assert_eq!(workspace.sources.len(), 1);
}

#[test]
fn parses_the_canonical_sigil_version_and_preserves_facets() {
    let path = format!(
        "{}/../../examples/promise/promise.sigil",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(path).unwrap();
    let document = parse("examples/promise/promise.sigil", &text);
    assert!(
        document
            .diagnostics
            .iter()
            .all(|d| !matches!(d.severity, Severity::Error)),
        "{:?}",
        codes(&document.diagnostics)
    );
    assert!(
        document
            .diagnostics
            .iter()
            .all(|d| !matches!(d.severity, Severity::Warning)),
        "{:?}",
        codes(&document.diagnostics)
    );
    let component = &document.components[0];
    let goal = section(component, "goal");
    assert_eq!(
        prose(&document, &goal.units[0]),
        "Represent a value that may resolve now, later, or fail."
    );
    assert_eq!(component.name, "Promise");
    assert_eq!(document.file_path, "examples/promise/promise.sigil");
    assert!(goal.units[0].range.start > 0);
}

#[test]
fn preserves_blank_line_separated_ungrouped_interface_facets_without_warnings() {
    let source = "component Account {
  goal {
    Authenticate users.
  }

  interface {
    first ungrouped region

    second ungrouped region
  }
}
";
    let document = parse("account.sigil", source);
    assert_eq!(codes(&document.diagnostics), Vec::<&str>::new());
    let interface = section(&document.components[0], "interface");
    assert!(interface.groups.is_empty());
    assert_eq!(interface.units.len(), 2);
    assert_eq!(
        prose(&document, &interface.units[0]),
        "first ungrouped region"
    );
    assert_eq!(
        prose(&document, &interface.units[1]),
        "second ungrouped region"
    );
    assert!(interface.units.iter().all(|facet| facet.group.is_none()));
}

#[test]
fn parses_optional_grouped_and_ungrouped_decision_rationale() {
    let source = "component Payments {
  goal {
    Process payments.
  }

  interface {
    PersistenceChoice {
      Stores payment records.
    }
  }

  decisions {
    PersistenceChoice {
      Decision: Use PostgreSQL.

      Context: Concurrent writers require transactional consistency.

      Scope: Governs payment persistence and transaction handling.
    }

    Free-form decision note.
  }
}
";
    let document = parse("payments.sigil", source);
    assert_eq!(codes(&document.diagnostics), Vec::<&str>::new());
    let decisions = section(&document.components[0], "decisions");
    assert_eq!(decisions.groups.len(), 1);
    assert_eq!(decisions.groups[0].name, "PersistenceChoice");
    assert_eq!(decisions.groups[0].units.len(), 3);
    let last = decisions.units.last().unwrap();
    assert_eq!(prose(&document, last), "Free-form decision note.");
    assert!(last.group.is_none());
}

#[test]
fn preserves_mixed_facets_and_embedded_facets_in_all_seven_contracts() {
    let contract = |name: &str| {
        format!(
            "  {name} {{
    First contribution.

    Shared {{
      Grouped contribution.
    }}

    Structured contribution:
    ```json
    {{
      \"enabled\": true

    }}
    ```

    Last contribution.
  }}"
        )
    };
    let contracts: Vec<String> = [
        "goal",
        "state",
        "logic",
        "constraints",
        "cases",
        "interface",
        "decisions",
    ]
    .iter()
    .map(|name| contract(name))
    .collect();
    let source = format!("component Mixed {{\n{}\n}}\n", contracts.join("\n\n"));
    let document = parse("mixed.sigil", &source);
    assert_eq!(codes(&document.diagnostics), Vec::<&str>::new());
    let sections = &document.components[0].sections;
    assert_eq!(sections.len(), 7);
    let text = &document.source.as_ref().unwrap().text;
    for section in sections {
        assert_eq!(section.units.len(), 4, "{}", section.name);
        assert_eq!(section.groups.len(), 1);
        assert_eq!(section.groups[0].name, "Shared");
        let [first, grouped, embedded, last] = &section.units[..] else {
            panic!("four Facets")
        };
        assert_eq!(prose(&document, first), "First contribution.");
        assert!(first.group.is_none());
        assert_eq!(prose(&document, grouped), "Grouped contribution.");
        assert_eq!(grouped.group.as_ref().unwrap().name, "Shared");
        // The group lists the grouped Facet by its index among the section's units.
        assert_eq!(section.groups[0].units[0], 1);
        // Only the Facet with a payload is an Embedded Facet.
        let payload = embedded.payload.as_ref().expect("an Embedded Facet");
        assert_eq!(prose(&document, embedded), "Structured contribution:");
        assert!(embedded.group.is_none());
        assert_eq!(payload.kind.as_deref(), Some("json"));
        assert!(text[payload.body_range.start..payload.body_range.end].contains("\n\n"));
        assert!(embedded.range.start < payload.range.start);
        assert_eq!(embedded.range.end, payload.range.end);
        assert_eq!(prose(&document, last), "Last contribution.");
        assert!(last.group.is_none());
        assert!(first.payload.is_none() && grouped.payload.is_none() && last.payload.is_none());
    }
}

#[test]
fn parses_strict_reviewed_glossary_data_and_rejects_collisions() {
    let valid = parse_glossary(
        glossary_source(json!({})).as_bytes(),
        ".sigil/glossary.json",
    );
    assert!(
        valid.diagnostics.is_empty(),
        "{:?}",
        codes(&valid.diagnostics)
    );
    let glossary = valid.glossary.expect("the glossary is valid");
    // Term and visibility data (`schemaVersion`, `terms[].term`, `agentContext`,
    // `declarationRange`) is TS-only: the Rust reader keeps just the bounded contexts.
    assert_eq!(glossary.contexts.len(), 1);
    assert_eq!(glossary.contexts[0].id, "booking");

    let excluded = parse_glossary(
        glossary_source(json!({ "terms": [{
            "term": "Decision:",
            "definition": "A reviewed rationale-writing convention.",
            "agentContext": false,
        }] }))
        .as_bytes(),
        ".sigil/glossary.json",
    );
    assert!(
        excluded.glossary.is_some(),
        "{:?}",
        codes(&excluded.diagnostics)
    );

    assert_eq!(glossary_codes("{".to_owned()), ["SIGIL_GLOSSARY_PARSE"]);
    let collision = glossary_codes(glossary_source(json!({ "terms": [
        { "term": "Booking", "definition": "One booking." },
        { "term": "Reservation", "definition": "Another booking.", "aliases": ["booking"] },
    ] })));
    assert!(collision.contains(&"SIGIL_GLOSSARY_TERM_COLLISION".to_owned()));
    let duplicate_glob = glossary_codes(glossary_source(json!({ "contexts": [{
        "id": "booking",
        "include": ["booking/**/*.sigil", "booking/**/*.sigil"],
        "exclude": [],
        "terms": [],
    }] })));
    assert!(duplicate_glob.contains(&"SIGIL_GLOSSARY_INVALID".to_owned()));
    let bad_visibility = glossary_codes(glossary_source(json!({ "terms": [{
        "term": "invalid visibility",
        "definition": "An invalid entry.",
        "agentContext": "no",
    }] })));
    assert!(bad_visibility.contains(&"SIGIL_GLOSSARY_INVALID".to_owned()));
}

#[test]
fn reports_glossary_context_overlap_through_ordinary_workspace_checks() {
    let overlapping = glossary_source(json!({ "contexts": [
        { "id": "booking", "include": ["booking/**/*.sigil"], "exclude": [], "terms": [] },
        { "id": "all", "include": ["**/*.sigil"], "exclude": [], "terms": [] },
    ] }));
    let mut files = MemoryFs::new();
    files.insert(".sigil/config.json", config_source(json!({})));
    files.insert(".sigil/glossary.json", overlapping);
    files.insert("booking/item.sigil", ROOT_MODULE);
    let resolved = ResolvedWorkspace::from(&Workspace::load_with(&files).unwrap());
    assert_has_code(&resolved.diagnostics, "SIGIL_GLOSSARY_CONTEXT_OVERLAP");
    // `glossary.occurrences` (term recognition) is TS-only.
}
