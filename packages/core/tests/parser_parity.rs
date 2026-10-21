//! The structural parser against the TypeScript reference.
//! Ported from `parser_080_test.ts`; the inputs and expected outcomes are the
//! same, with byte ranges, diagnostic codes, names and counts unchanged.
//!
//! The Rust model carries no ids. Where the TypeScript test compares a Facet's
//! `componentId`/`groupingId`, the Rust test checks the structural position
//! instead: the Facet sits in the owner Component's section, and its
//! `group` names the grouping Tag whose `header_range` it points at.
use sigil_core::language::{
    parse::{Document, Facet, Group, Payload, Span, parse_document},
    text::capture_source,
};

fn parse(source: impl AsRef<[u8]>) -> Document {
    parse_document(
        "fixture.sigil",
        &capture_source("fixture.sigil", source.as_ref()),
    )
}

fn component(body: &str) -> String {
    format!("component Example {{\ngoal {{\nA responsibility.\n}}\ninterface {{\n{body}\n}}\n}}\n")
}

fn codes(document: &Document) -> Vec<&str> {
    document
        .diagnostics
        .iter()
        .map(|d| d.code.as_str())
        .collect()
}

fn slice(document: &Document, span: Span) -> &str {
    document
        .source
        .as_ref()
        .expect("the source has text")
        .slice(&span.range())
        .expect("a slice inside the source")
}

/// The interface section's Facets of the first Component.
fn interface(document: &Document) -> &[Facet] {
    &document.components[0].sections[1].units
}

fn groups(document: &Document) -> &[Group] {
    &document.components[0].sections[1].groups
}

fn all_links(document: &Document) -> usize {
    document
        .components
        .iter()
        .flat_map(|c| &c.sections)
        .flat_map(|s| &s.units)
        .map(|f| f.links.len())
        .sum()
}

/// A payload body with its opening fence's indentation removed from each line.
/// The TypeScript model keeps this as `body`; Rust derives it from the range.
fn payload_body(document: &Document, payload: &Payload) -> String {
    slice(document, payload.body_range)
        .split_inclusive(['\n', '\r'])
        .map(|line| {
            line.strip_prefix(payload.indentation.as_str())
                .unwrap_or(line)
        })
        .collect()
}

/// The Facet's prose as the TypeScript model keeps it: each physical line
/// trimmed of spaces and tabs, joined by one space.
fn prose(document: &Document, facet: &Facet) -> String {
    slice(document, facet.prose_range)
        .split_inclusive(['\n', '\r'])
        .map(|line| {
            line.trim_end_matches(['\n', '\r'])
                .trim_matches([' ', '\t'])
        })
        .collect::<Vec<_>>()
        .join(" ")
}

const ENDINGS: [&str; 3] = ["\n", "\r\n", "\r"];

#[test]
fn component_name_ranges_select_the_name_even_when_it_repeats_the_keyword() {
    let result = parse(component("Offer an interaction.").replace("Example", "component"));
    assert_eq!(result.components[0].name_range, Span::new(10, 19));
}

#[test]
fn component_like_grouping_tags_retain_their_contract_and_component_owner() {
    let result = parse(component("component Search {\nOffer this concern.\n}"));
    assert_eq!(codes(&result), Vec::<&str>::new());
    let names: Vec<&str> = result.components.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Example"]);
    let contract = &result.components[0].sections[1];
    let group_names: Vec<&str> = contract.groups.iter().map(|g| g.name.as_str()).collect();
    assert_eq!(group_names, ["component Search"]);
    let unit = &contract.units[0];
    let group = unit.group.as_ref().expect("the Facet sits in the group");
    assert_eq!(group.name, "component Search");
    assert_eq!(group.header_start, contract.groups[0].header_range.start);
    assert_eq!(unit.section, "interface");
    assert_eq!(
        slice(&result, contract.groups[0].name_range),
        "component Search"
    );

    let nested = parse(component("Outer {\ncomponent Search {\nOffer.\n}\n}"));
    let names: Vec<&str> = nested.components.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Example"]);
    assert_eq!(codes(&nested), ["SIGIL_NESTED_TAG_GROUP"]);
}

#[test]
fn wrapped_complete_links_protect_their_opening_lines_trailing_brace() {
    for ending in ENDINGS {
        for raw in [
            "[manual](./policy.md \"title {\ncontinued\")",
            "[manual {\ncontinued](./policy.md)",
            "![manual {\ncontinued](./policy.md)",
        ] {
            let link_text = raw.replace('\n', ending);
            let text =
                component(&format!("Before.\n\nRead é😀 {raw}.\n\nAfter.")).replace('\n', ending);
            let result = parse(text.as_bytes());
            assert_eq!(codes(&result), Vec::<&str>::new());
            assert_eq!(result.components.len(), 1);
            let contract = &result.components[0].sections[1];
            assert!(contract.groups.is_empty());
            assert_eq!(contract.units.len(), 3);
            let facet = &contract.units[1];
            assert_eq!(facet.section, "interface");
            assert!(facet.group.is_none());
            assert_eq!(facet.links.len(), 1);
            assert_eq!(facet.links[0].destination, "./policy.md");
            assert_eq!(slice(&result, facet.links[0].range), link_text);
            assert_eq!(
                slice(&result, facet.links[0].destination_range),
                "./policy.md"
            );
        }
    }
}

#[test]
fn incomplete_links_and_later_structural_lines_do_not_hide_group_boundaries() {
    for body in [
        "Read [manual](./policy.md \"title {\nNever closed.",
        "Read [manual](./policy.md \"title {\nGroup {\ncontinued\").\n}",
        "Read [manual](./policy.md \"title {\n\ncontinued\").",
        "Read [manual](./policy.md \"title {\n```\ncontinued\").\n```",
        "Read [manual](./policy.md \"title {\n}\ncontinued\").",
    ] {
        for ending in ENDINGS {
            let result = parse(component(body).replace('\n', ending));
            assert_eq!(result.components.len(), 1);
            let contract = &result.components[0].sections[1];
            let links: usize = contract.units.iter().map(|f| f.links.len()).sum();
            assert_eq!(links, 0, "{body:?} with {ending:?}");
            assert!(!contract.groups.is_empty(), "{body:?} with {ending:?}");
        }
    }
    let result = parse(component(
        "Read [unfinished\nGroup {\ncontinued](./policy.md).\n}",
    ));
    assert_eq!(codes(&result), Vec::<&str>::new());
    let contract = &result.components[0].sections[1];
    let group_names: Vec<&str> = contract.groups.iter().map(|g| g.name.as_str()).collect();
    assert_eq!(group_names, ["Group"]);
    let links: usize = contract.units.iter().map(|f| f.links.len()).sum();
    assert_eq!(links, 0);
}

#[test]
fn link_lookahead_preserves_unprotected_trailing_braces_and_later_components() {
    let grouping = parse(component("[manual](./policy.md) {\nOffer.\n}"));
    assert_eq!(codes(&grouping), Vec::<&str>::new());
    let names: Vec<&str> = groups(&grouping).iter().map(|g| g.name.as_str()).collect();
    assert_eq!(names, ["[manual](./policy.md)"]);

    let result = parse(
        component("Read [unfinished")
            + &component("continued](./policy.md).").replace("Example", "Other"),
    );
    assert_eq!(codes(&result), Vec::<&str>::new());
    let names: Vec<&str> = result.components.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Example", "Other"]);
    assert_eq!(all_links(&result), 0);
}

#[test]
fn c01_parses_minimal_source_with_byte_ranges_and_optional_final_newline() {
    for ending in ENDINGS {
        for final_newline in [true, false] {
            let lines = [
                "component Minimal {",
                "  goal {",
                "    State one responsibility.",
                "  }",
                "  interface {",
                "    Offer one interaction.",
                "  }",
                "}",
            ];
            let source = lines.join(ending) + if final_newline { ending } else { "" };
            let parsed = parse(&source);
            assert_eq!(codes(&parsed), Vec::<&str>::new());
            assert_eq!(parsed.components.len(), 1);
            let component = &parsed.components[0];
            let counts: Vec<usize> = component.sections.iter().map(|s| s.units.len()).collect();
            assert_eq!(counts, [1, 1]);
            assert_eq!(component.range, Span::new(0, source.len()));
        }
    }
}

#[test]
fn c02_retains_inline_introductions_repeated_grouping_occurrences_and_facet_roles() {
    let result = parse(
        component("A *query* contains search text.\n\nquery {\nAccept a query.\n}")
            + "component Other {\ngoal {\nOwn another responsibility.\n}\ninterface {\nquery {\nOffer another query.\n}\n}\n}",
    );
    assert_eq!(codes(&result), Vec::<&str>::new());
    assert_eq!(groups(&result).len(), 1);
    let grouping: Vec<Option<&str>> = interface(&result)
        .iter()
        .map(|f| f.group.as_ref().map(|g| g.name.as_str()))
        .collect();
    assert_eq!(grouping, [None, Some("query")]);
    let definitions: Vec<&str> = interface(&result)[0]
        .definitions
        .iter()
        .map(|d| d.name.as_str())
        .collect();
    assert_eq!(definitions, ["query"]);
}

#[test]
fn c06_payload_closure_terminates_a_facet_and_preserves_its_exact_body() {
    let result = parse(component(
        "An introduction.\n\t```ts\n\tlet x = 1;  \n\t\n\t```\nNext prose.",
    ));
    assert_eq!(codes(&result), Vec::<&str>::new());
    let units = interface(&result);
    assert_eq!(units.len(), 2);
    let payload = units[0].payload.as_ref().expect("an embedded Facet");
    assert_eq!(slice(&result, payload.body_range), "\tlet x = 1;  \n\t\n");
    assert_eq!(payload_body(&result, payload), "let x = 1;  \n\n");
    assert_eq!(prose(&result, &units[1]), "Next prose.");

    let empty = parse(component("Intro.\n```\n```"));
    let payload = interface(&empty)[0]
        .payload
        .as_ref()
        .expect("an empty payload is still a payload");
    assert_eq!(payload_body(&empty, payload), "");
}

#[test]
fn payload_attachment_errors_preserve_detached_source_without_creating_a_facet() {
    for (body, code) in [
        ("Intro.\n\n```\nx\n```", "SIGIL_DETACHED_LITERAL_BLOCK"),
        ("```\nx\n```", "SIGIL_LITERAL_WITHOUT_INTRODUCTION"),
        (
            "Intro.\n```\nx\n```\n```\ny\n```",
            "SIGIL_LITERAL_WITHOUT_INTRODUCTION",
        ),
        (
            "Intro.\n```bad type\ncomponent Fake {\n```",
            "SIGIL_INVALID_LITERAL_TYPE",
        ),
    ] {
        let result = parse(component(body));
        let literal: Vec<&str> = codes(&result)
            .into_iter()
            .filter(|c| c.contains("LITERAL"))
            .collect();
        assert_eq!(literal, [code], "{body:?}");
        assert_eq!(result.components.len(), 1);
    }
}

#[test]
fn unterminated_payload_is_inert_and_suppresses_derived_absence_errors() {
    let result = parse("component Broken {\ngoal {\nIntro.\n```\ncomponent Hidden {\n}\n");
    let names: Vec<&str> = result.components.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Broken"]);
    assert_eq!(codes(&result), ["SIGIL_UNCLOSED_LITERAL_BLOCK"]);
    assert!(!result.components[0].complete);
}

#[test]
fn unknown_sections_retain_balanced_invalid_bodies_and_independent_later_sections() {
    let result = parse(
        "component Example {\nunknown {\ngoal {\nHidden.\n}\n}\ngoal {\nReal.\n}\ninterface {\nOffer.\n}\n}",
    );
    assert_eq!(codes(&result), ["SIGIL_UNKNOWN_SECTION"]);
    let sections: Vec<(&str, bool, usize)> = result.components[0]
        .sections
        .iter()
        .map(|s| (s.name.as_str(), s.valid, s.units.len()))
        .collect();
    assert_eq!(
        sections,
        [
            ("unknown", false, 0),
            ("goal", true, 1),
            ("interface", true, 1)
        ]
    );
}

#[test]
fn duplicate_sections_remain_separate_with_related_conflict_locations() {
    let text = component("Offer.");
    let text = text.strip_suffix("\n}\n").expect("a closing brace");
    let result = parse(format!(
        "{text}\nlogic {{\nFirst.\n}}\nlogic {{\nSecond.\n}}\n}}"
    ));
    let duplicates: Vec<_> = result
        .diagnostics
        .iter()
        .filter(|d| d.code == "SIGIL_DUPLICATE_SECTION")
        .collect();
    assert_eq!(duplicates.len(), 1);
    assert_eq!(duplicates[0].related.len(), 1);
    let logic = result.components[0]
        .sections
        .iter()
        .filter(|s| s.name == "logic")
        .count();
    assert_eq!(logic, 2);
}

#[test]
fn present_sections_must_follow_the_canonical_contract_order() {
    let valid = parse(
        "component Example {\n  goal {\n    Goal.\n  }\n  state {\n    State.\n  }\n  logic {\n    Logic.\n  }\n  constraints {\n    Constraints.\n  }\n  cases {\n    Cases.\n  }\n  interface {\n    Interface.\n  }\n  decisions {\n    Decisions.\n  }\n}\n",
    );
    assert_eq!(codes(&valid), Vec::<&str>::new());

    let invalid = parse(
        "component Example {\n  goal {\n    Goal.\n  }\n  interface {\n    Interface.\n  }\n  state {\n    State.\n  }\n}\n",
    );
    assert_eq!(codes(&invalid), ["SIGIL_SECTION_ORDER"]);
    assert!(!invalid.valid);
}

#[test]
fn empty_and_nested_groups_keep_invalid_evidence_without_becoming_local_tags() {
    let empty = parse(component("Empty {\n}"));
    let mut found = codes(&empty);
    found.sort();
    assert_eq!(found, ["SIGIL_EMPTY_TAG_GROUP", "SIGIL_MISSING_INTERFACE"]);

    let nested = parse(component("Outer {\nInner {\nText.\n}\n}"));
    assert_eq!(codes(&nested), ["SIGIL_NESTED_TAG_GROUP"]);
    assert!(!groups(&nested)[0].groups[0].valid);
}

#[test]
fn multiline_imports_preserve_exact_selection_names_and_recover_at_a_new_component() {
    let valid = parse(
        "@a.sigil from A import {\nsearch  results,\nC++,\n}\n".to_owned() + &component("Offer."),
    );
    assert_eq!(codes(&valid), Vec::<&str>::new());
    assert_eq!(valid.imports[0].provider, "A");
    let names: Vec<&str> = valid.imports[0]
        .selections
        .iter()
        .map(|s| s.name.as_str())
        .collect();
    assert_eq!(names, ["search  results", "C++"]);

    let broken = parse("@a.sigil from A import {\nquery\n".to_owned() + &component("Offer."));
    assert!(!broken.imports[0].complete);
    assert_eq!(broken.components.len(), 1);
    assert_eq!(codes(&broken), ["SIGIL_PARSE_STRUCTURE"]);
}

#[test]
fn import_recovery_preserves_a_later_complete_import_and_exact_provider_locations() {
    let result = parse(
        "@broken.sigil from Broken import {\nquery\n@from.sigil from import import { query }\n"
            .to_owned()
            + &component("Offer."),
    );
    assert_eq!(result.imports.len(), 2);
    assert_eq!(result.imports[1].provider, "import");
    assert_eq!(slice(&result, result.imports[1].provider_range), "import");
    assert_eq!(result.components.len(), 1);
}

#[test]
fn unclosed_unknown_sections_preserve_block_errors_unless_a_payload_hides_their_end() {
    let result = parse("component A {\nunknown {\nText.");
    let unclosed = result
        .diagnostics
        .iter()
        .filter(|d| d.code == "SIGIL_UNCLOSED_BLOCK")
        .count();
    assert_eq!(unclosed, 2);

    let payload = parse("component A {\nunknown {\nIntro.\n```\nhidden");
    let hidden = payload
        .diagnostics
        .iter()
        .filter(|d| d.code == "SIGIL_UNCLOSED_BLOCK")
        .count();
    assert_eq!(hidden, 0);
}

#[test]
fn strict_disk_ingress_retains_independent_source_evidence_and_initial_bom_offsets() {
    assert_eq!(parse([0xff]).diagnostics[0].code, "SIGIL_INVALID_ENCODING");

    let result = parse(format!("\u{feff}{}", component("Offer.")).as_bytes());
    assert_eq!(codes(&result), Vec::<&str>::new());
    assert_eq!(result.components[0].name_range.start, 13);
    let text = &result.source.as_ref().expect("text").text;
    assert_eq!(text.as_bytes()[0], 0xef);
}

#[test]
fn removed_forms_and_compact_structure_are_rejected_without_legacy_interpretation() {
    for source in [
        "@x.sigil { X }",
        "expand Example {\n}",
        "component Example { goal { x } }",
        "component Example\n{\n}",
    ] {
        let result = parse(source);
        assert!(
            codes(&result).contains(&"SIGIL_PARSE_STRUCTURE"),
            "{source:?}: {:?}",
            codes(&result)
        );
    }
    assert_eq!(
        codes(&parse(component("Return { enabled: true }."))),
        Vec::<&str>::new()
    );
    assert_eq!(codes(&parse("")), Vec::<&str>::new());
}

#[test]
fn unicode_whitespace_remains_exact_name_content_and_is_not_structural_indentation() {
    let result = parse(component("search\u{2028}results {\nOffer.\n}"));
    assert_eq!(codes(&result), Vec::<&str>::new());
    assert_eq!(groups(&result)[0].name, "search\u{2028}results");

    let fence = parse(component(
        "Intro.\n```js\u{2028}invalid\ncomponent Hidden {\n```",
    ));
    assert_eq!(codes(&fence), ["SIGIL_INVALID_LITERAL_TYPE"]);
    assert_eq!(fence.components.len(), 1);

    let nbsp = parse(format!("\u{a0}{}", component("Offer.")));
    assert!(codes(&nbsp).contains(&"SIGIL_PARSE_STRUCTURE"));
}
