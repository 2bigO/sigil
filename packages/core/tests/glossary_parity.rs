//! Glossary and term byte coordinates against the TypeScript reference.
//! Ported from `glossary_source_test.ts`.
//!
//! Not ported: the glossary's `terms[0].declarationRange` and its slice of the
//! glossary source. The Rust glossary keeps only contexts, so term declarations
//! have no range to check. The term occurrence in a document is checked through
//! `match_tag_references`, which is the Rust word-boundary matcher.
use sigil_core::language::{
    glossary::{context_overlap, parse_glossary},
    parse::parse_document,
    tags::match_tag_references,
    text::capture_source,
};

#[test]
fn glossary_declarations_and_matches_share_original_byte_coordinates() {
    let glossary_text = r#"{"schemaVersion":1,"terms":[{"definition":"😀 search text","term":"query"}],"contexts":[]}"#;
    let parsed = parse_glossary(glossary_text.as_bytes(), "glossary.json");
    assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
    let glossary = parsed.glossary.expect("a valid glossary");
    assert!(context_overlap(&glossary, "a.sigil").is_none());

    let input = "\u{feff}component A {\r\ngoal {\r\nResponsibility.\r\n}\r\ninterface {\r\n😀 e\u{301} query.\r\n}\r\n}";
    let capture = capture_source("a.sigil", input.as_bytes());
    let document = parse_document("a.sigil", &capture);
    let source = document.source.as_ref().expect("text");
    let regions: Vec<_> = document
        .components
        .iter()
        .flat_map(|c| &c.sections)
        .flat_map(|s| &s.units)
        .flat_map(|f| f.eligible.iter().copied())
        .collect();
    let occurrences = match_tag_references(source, &regions, &["query"]);
    assert_eq!(occurrences.len(), 1);
    let range = occurrences[0].range;
    assert_eq!(source.slice(&range.range()), Some("query"));
    assert_eq!(range.start, input.find("query").unwrap());
}
