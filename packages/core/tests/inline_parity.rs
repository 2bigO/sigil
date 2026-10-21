//! Inline links, images and Tag definitions against the TypeScript reference.
//! Ported from `inline_content_test.ts`, with the same inputs and outcomes.
use regex::Regex;
use serde_json::Value;
use sigil_core::language::{
    inline::{InlineContent, scan_inline_content},
    parse::Span,
    text::{SourceText, capture_source},
};

fn source(text: &str) -> SourceText {
    capture_source("inline.sigil", text.as_bytes())
        .source
        .expect("valid text")
}

fn scan_in(source: &SourceText) -> InlineContent {
    scan_inline_content("inline.sigil", source, Span::new(0, source.text.len()))
}

fn scan(text: &str) -> InlineContent {
    scan_in(&source(text))
}

fn destinations(content: &InlineContent) -> Vec<&str> {
    content
        .links
        .iter()
        .map(|l| l.destination.as_str())
        .collect()
}

fn definition_names(content: &InlineContent) -> Vec<&str> {
    content
        .definitions
        .iter()
        .map(|d| d.name.as_str())
        .collect()
}

#[test]
fn c04_inline_definitions_use_physical_boundaries_and_backticks_are_ordinary() {
    let cases: [(&str, usize, &[&str]); 10] = [
        ("A *query* contains text.", 1, &[]),
        ("A `*query*` contains text.", 0, &[]),
        ("A *query*.", 1, &[]),
        ("(*query*)", 0, &[]),
        ("prefix*query*suffix", 0, &[]),
        ("A * query * contains text.", 0, &[]),
        ("quantity * unitPrice * discount", 0, &[]),
        ("A *query\n", 0, &["SIGIL_INCOMPLETE_TAG"]),
        (
            "A *request, result* contains text.",
            0,
            &["SIGIL_INVALID_TAG_NAME"],
        ),
        ("*search results* and *search  results*", 2, &[]),
    ];
    for (text, count, expected) in cases {
        let result = scan(text);
        let valid = result.definitions.iter().filter(|d| d.valid).count();
        assert_eq!(valid, count, "{text:?}");
        let codes: Vec<&str> = result.diagnostics.iter().map(|d| d.code.as_str()).collect();
        assert_eq!(codes, expected, "{text:?}");
    }
    assert_eq!(
        definition_names(&scan("*é* and *e\u{301}*")),
        ["é", "e\u{301}"]
    );
}

#[test]
fn complete_links_protect_nested_syntax_escaped_destinations_and_multiline_titles() {
    let text = "😀 [*query*](<./a\\>b&amp;c.md> \"a\n title\") and ![query](image.svg)";
    let source = source(text);
    let result = scan_in(&source);
    assert!(result.definitions.is_empty());
    let links: Vec<_> = result
        .links
        .iter()
        .map(|l| {
            (
                l.label.as_str(),
                l.destination.as_str(),
                l.title.as_deref(),
                l.image,
            )
        })
        .collect();
    assert_eq!(
        links,
        [
            ("*query*", "./a>b&c.md", Some("a\n title"), false),
            ("query", "image.svg", None, true),
        ]
    );
    assert_eq!(result.links[0].range.start, 5);
    assert_eq!(
        &source.text[result.links[0].range.start..result.links[0].range.end],
        "[*query*](<./a\\>b&amp;c.md> \"a\n title\")"
    );
    assert_eq!(scan("`[*query*](a.md)`").links.len(), 1);
    assert_eq!(
        scan("[x](foo(and(bar)))").links[0].destination,
        "foo(and(bar))"
    );
    assert_eq!(scan("[x](\"title\")").links[0].destination, "\"title\"");
    assert_eq!(scan("[x]( \"title\")").links[0].destination, "\"title\"");
    assert_eq!(scan("[x](<> \"title\")").links[0].destination, "");
}

#[test]
fn malformed_links_do_not_hide_tag_definitions_or_consume_later_complete_links() {
    let result = scan("[ *query* ](unfinished and [good](ok.md)");
    assert_eq!(definition_names(&result), ["query"]);
    assert_eq!(destinations(&result), ["ok.md"]);
    assert!(scan("[x](a b)").links.is_empty());
    assert!(scan("[x](<a\nb>)").links.is_empty());
    assert!(scan("[x](a \"unclosed)").links.is_empty());
    assert!(scan("[x][reference]").links.is_empty());
}

#[test]
fn commonmark_nesting_permits_images_in_links_and_forbids_links_in_links() {
    assert_eq!(destinations(&scan("[outer [inner](b)](a)")), ["b"]);
    let result = scan("[outer ![image](b)](a)");
    assert_eq!(destinations(&result), ["a", "b"]);
    let outer = result.links[0].range;
    assert!(
        result
            .eligible
            .iter()
            .all(|r| r.end <= outer.start || r.start >= outer.end)
    );
    assert!(scan("\\[escaped](x)").links.is_empty());
}

#[test]
fn adopted_commonmark_0_31_2_inline_link_examples_retain_complete_references() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/commonmark-inline-links.json")).unwrap();
    let paragraphs = Regex::new(r"\n[ \t]*\n").unwrap();
    let cases = fixture["cases"].as_array().expect("cases");
    assert!(!cases.is_empty());
    for case in cases {
        let example = &case["example"];
        let markdown = case["markdown"].as_str().expect("markdown");
        let references = case["references"].as_u64().expect("references") as usize;
        let mut links = 0;
        for paragraph in paragraphs.split(markdown) {
            let source = source(paragraph);
            let result = scan_in(&source);
            for link in &result.links {
                let raw = &source.text[link.range.start..link.range.end];
                assert!(raw.contains(&link.label), "example {example}: {raw:?}");
            }
            links += result.links.len();
        }
        assert_eq!(links, references, "example {example}: {markdown:?}");
    }
}
