//! Tag resolution, imports, ownership and longest match.
//! Ported from `tag_resolution_test.ts`, test for test.
use sigil_core::language::{
    fs::MemoryFs,
    resolve::{
        AccessStatus, FacetPos, IntroductionKind, NameStatus, ResolvedComponent, ResolvedWorkspace,
        TagStatus,
    },
    tags::is_tag_word_character,
    workspace::Workspace,
};

const CONFIG: &str =
    r#"{"sigilVersion":"0.9.0","workspace":{"name":"test"},"files":{"include":["**/*.sigil"]}}"#;
const SECTIONS: [&str; 5] = ["state", "logic", "constraints", "cases", "decisions"];

/// A component whose Interface holds `prose`; `rest` joins the Interface unless it opens one
/// of the other sections, in which case it sits between the goal and the Interface.
fn component(name: &str, prose: &str, rest: &str) -> String {
    let opens_section = SECTIONS.iter().any(|section| {
        rest.trim()
            .strip_prefix(section)
            .is_some_and(|tail| tail.trim_start().starts_with('{'))
    });
    if opens_section {
        format!(
            "component {name} {{\ngoal {{\nOwn a responsibility.\n}}\n{rest}\ninterface {{\n{prose}\n}}\n}}\n"
        )
    } else {
        format!(
            "component {name} {{\ngoal {{\nOwn a responsibility.\n}}\ninterface {{\n{prose}\n{rest}\n}}\n}}\n"
        )
    }
}

fn provider(name: &str, tags: &[&str]) -> String {
    let prose: Vec<String> = tags
        .iter()
        .map(|tag| format!("A *{tag}* has meaning."))
        .collect();
    component(name, &prose.join("\n\n"), "")
}

fn default_provider() -> String {
    provider("Provider", &["query", "submit"])
}

fn importing(path: &str, owner: &str, names: &str) -> String {
    format!("@{path} from {owner} import {{ {names} }}\n")
}

fn resolve(files: &[(&str, &str)]) -> ResolvedWorkspace {
    let mut fs = MemoryFs::new();
    fs.insert(".sigil/config.json", CONFIG);
    for (path, text) in files {
        fs.insert(path, *text);
    }
    ResolvedWorkspace::from(&Workspace::load_with(&fs).unwrap())
}

fn codes(resolved: &ResolvedWorkspace) -> Vec<&str> {
    resolved
        .diagnostics
        .iter()
        .map(|d| d.code.as_str())
        .collect()
}

fn find<'a>(resolved: &'a ResolvedWorkspace, name: &str) -> &'a ResolvedComponent {
    resolved
        .components
        .iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("no component {name}"))
}

fn reference_names<'a>(resolved: &'a ResolvedWorkspace, component: &str) -> Vec<&'a str> {
    find(resolved, component)
        .references
        .iter()
        .map(|r| r.name.as_str())
        .collect()
}

fn selection_statuses(resolved: &ResolvedWorkspace) -> Vec<NameStatus> {
    resolved
        .imports
        .iter()
        .flat_map(|item| item.names.iter().map(|n| n.status))
        .collect()
}

fn owner_names(resolved: &ResolvedWorkspace, component: &str) -> Vec<Option<String>> {
    find(resolved, component)
        .references
        .iter()
        .map(|r| r.tag.map(|t| resolved.components[t.component].name.clone()))
        .collect()
}

#[test]
fn reference_word_characters_stay_pinned_to_unicode_15_1() {
    for c in [
        'A',
        '\u{e9}',
        '\u{301}',
        '\u{663}',
        '\u{203f}',
        '\u{200c}',
        '\u{200d}',
        '\u{2ebf0}',
    ] {
        assert!(is_tag_word_character(Some(c)), "{c:?} is a word character");
    }
    // U+1C89 became a letter in Unicode 16.0; host Unicode upgrades must not change 0.9.
    for c in ['-', '.', '\u{1f600}', '\u{1c89}', '\u{2ee5e}'] {
        assert!(
            !is_tag_word_character(Some(c)),
            "{c:?} is not a word character"
        );
    }
}

#[test]
fn explicit_tag_selection_preserves_independent_successes_and_consumer_ownership() {
    let consumer = importing("provider.sigil", "Provider", "query, missing, submit")
        + &component("Consumer", "Use query.", "");
    let r = resolve(&[
        ("provider.sigil", &default_provider()),
        ("consumer.sigil", &consumer),
    ]);
    assert_eq!(
        codes(&r),
        ["SIGIL_UNRESOLVED_IMPORTED_TAG", "SIGIL_UNUSED_TAG_IMPORT"]
    );
    let names: Vec<_> = r.imports[0]
        .names
        .iter()
        .map(|n| (n.name.as_str(), n.status, n.used))
        .collect();
    assert_eq!(
        names,
        [
            ("query", NameStatus::Resolved, true),
            ("missing", NameStatus::Unresolved, false),
            ("submit", NameStatus::Resolved, false),
        ]
    );
    let consumer = find(&r, "Consumer");
    assert_eq!(
        owner_names(&r, "Consumer"),
        [Some("Provider".to_owned())],
        "the reference resolves to the Provider's Tag"
    );
    assert_eq!(reference_names(&r, "Consumer"), ["query"]);
    // The reference sits in the Consumer's Interface Facet (section 1, unit 0).
    assert_eq!(
        consumer.references[0].facet,
        FacetPos {
            section: 1,
            unit: 0
        }
    );
}

#[test]
fn collective_local_introductions_reuse_exact_identities_and_conflicting_definitions_stay_unresolved()
 {
    let r = resolve(&[(
        "p.sigil",
        &component(
            "Provider",
            "query {\nUse query.\n}\n\nA *query* has meaning.\n\nquery {\nRepeat query.\n}\n\nA *bad* repeats.\n\nAnother *bad* repeats.\n\nbad {\nUse bad.\n}",
            "",
        ),
    )]);
    assert_eq!(codes(&r), ["SIGIL_DUPLICATE_TAG_DEFINITION"]);
    let c = &r.components[0];
    let query = c.tags.iter().find(|t| t.name == "query").unwrap();
    let kinds: Vec<_> = query.introductions.iter().map(|i| i.kind).collect();
    assert_eq!(
        kinds,
        [
            IntroductionKind::Group,
            IntroductionKind::Inline,
            IntroductionKind::Group
        ]
    );
    assert_eq!(query.status, TagStatus::Resolved);
    // The conflicting definitions have no identity: the Tag is not resolved.
    let bad = c.tags.iter().find(|t| t.name == "bad").unwrap();
    assert_eq!(bad.status, TagStatus::Ambiguous);
    let bad_references: Vec<_> = c
        .references
        .iter()
        .filter(|r| r.name == "bad")
        .map(|r| (r.status, r.tag))
        .collect();
    assert_eq!(bad_references, [(AccessStatus::Ambiguous, None)]);
    assert_eq!(r.diagnostics[0].related.len(), 1);
}

#[test]
fn provider_failure_stays_on_its_selection_with_related_ambiguous_declarations() {
    let consumer = importing("a.sigil", "Provider", "query") + &component("C", "Use query.", "");
    let r = resolve(&[
        ("a.sigil", &default_provider()),
        ("b.sigil", &default_provider()),
        ("z.sigil", &consumer),
    ]);
    let failure = r
        .diagnostics
        .iter()
        .find(|d| d.code == "SIGIL_UNRESOLVED_IMPORTED_COMPONENT")
        .unwrap();
    assert_eq!(failure.file_path.as_deref(), Some("z.sigil"));
    let related: Vec<_> = failure
        .related
        .iter()
        .map(|d| d.file_path.as_deref())
        .collect();
    assert_eq!(related, [Some("a.sigil"), Some("b.sigil")]);
}

#[test]
fn exact_physical_matching_uses_complete_boundaries_and_global_longest_overlap() {
    let examples: [(&[&str], &str, &[&str]); 10] = [
        (
            &["order"],
            "order pre-order order.status (order). orders",
            &["order", "order"],
        ),
        (&["C++"], "Use C++ here. C++17", &["C++"]),
        (&["query"], "Query query", &["query"]),
        (
            &["search results"],
            "search  results search\tresults search\nresults",
            &[],
        ),
        (
            &["search", "results", "search results"],
            "search results replace results",
            &["search results", "results"],
        ),
        (
            &["new order", "order status"],
            "new order status",
            &["order status"],
        ),
        (&["a b", "b c"], "a b c", &["a b"]),
        (
            &["\u{e9}", "e\u{301}"],
            "\u{e9} e\u{301}",
            &["\u{e9}", "e\u{301}"],
        ),
        (
            &["query"],
            "query\u{301} query\u{203f} query\u{200c} query\u{200d} query..word word--query",
            &[],
        ),
        (
            &["query"],
            "\u{1f600}query\u{1f600} query. [query](./doc.md) `query`",
            &["query", "query", "query"],
        ),
    ];
    for (names, prose, want) in examples {
        let consumer = importing("p.sigil", "P", &names.join(", ")) + &component("C", prose, "");
        let r = resolve(&[("p.sigil", &provider("P", names)), ("c.sigil", &consumer)]);
        assert_eq!(reference_names(&r, "C"), want, "{names:?} in {prose:?}");
    }
}

#[test]
fn duplicate_selections_and_collisions_have_no_import_order_winner_or_extra_unused_errors() {
    let p = provider("P", &["query", "submit"]);
    let q = provider("Q", &["query"]);
    let duplicate_consumer = importing("p.sigil", "P", "query, submit")
        + &importing("./p.sigil", "P", "query")
        + &component("C", "Use query and submit.", "");
    let duplicate = resolve(&[
        ("p.sigil", &p),
        ("q.sigil", &q),
        ("c.sigil", &duplicate_consumer),
    ]);
    assert_eq!(codes(&duplicate), ["SIGIL_DUPLICATE_TAG_IMPORT"]);
    assert_eq!(
        selection_statuses(&duplicate),
        [
            NameStatus::Duplicate,
            NameStatus::Resolved,
            NameStatus::Duplicate
        ]
    );

    let collision_consumer = importing("p.sigil", "P", "query")
        + &importing("q.sigil", "Q", "query")
        + &component("C", "Use query.", "");
    let collision = resolve(&[
        ("p.sigil", &p),
        ("q.sigil", &q),
        ("c.sigil", &collision_consumer),
    ]);
    assert_eq!(codes(&collision), ["SIGIL_TAG_NAME_COLLISION"]);
    assert_eq!(find(&collision, "C").references[0].tag, None);

    let local_consumer =
        importing("p.sigil", "P", "query") + &component("C", "query {\nUse query.\n}", "");
    let local = resolve(&[
        ("p.sigil", &p),
        ("q.sigil", &q),
        ("c.sigil", &local_consumer),
    ]);
    assert_eq!(codes(&local), ["SIGIL_TAG_NAME_COLLISION"]);
    assert_eq!(
        find(&local, "C").references[0].status,
        AccessStatus::Ambiguous
    );
}

#[test]
fn mutual_imports_resolve_collectively_never_re_export_and_ignore_discovery_order() {
    let a =
        importing("b.sigil", "B", "beta") + &component("A", "A *alpha* exists.\n\nUse beta.", "");
    let b =
        importing("a.sigil", "A", "alpha") + &component("B", "A *beta* exists.\n\nUse alpha.", "");
    let c = importing("b.sigil", "B", "alpha") + &component("C", "Use alpha.", "");
    let first = resolve(&[("a.sigil", &a), ("b.sigil", &b), ("c.sigil", &c)]);
    let second = resolve(&[("c.sigil", &c), ("b.sigil", &b), ("a.sigil", &a)]);
    assert_eq!(codes(&first), ["SIGIL_UNRESOLVED_IMPORTED_TAG"]);
    assert_eq!(
        format!("{:?}", first.imports),
        format!("{:?}", second.imports)
    );
    assert_eq!(
        format!("{:?}", first.components),
        format!("{:?}", second.components)
    );
    assert_eq!(
        format!("{:?}", first.diagnostics),
        format!("{:?}", second.diagnostics)
    );
}

#[test]
fn file_imports_are_shared_while_sibling_local_tags_remain_private_to_their_component() {
    let consumer = importing("p.sigil", "Provider", "query")
        + &component("One", "A *local* exists.", "")
        + &component("Two", "Use query and local.", "");
    let r = resolve(&[("p.sigil", &default_provider()), ("c.sigil", &consumer)]);
    assert_eq!(codes(&r), Vec::<&str>::new());
    assert_eq!(reference_names(&r, "Two"), ["query"]);
}

#[test]
fn path_and_provider_failures_suppress_dependent_errors_without_module_index_fallback() {
    for path in [
        "folder",
        "/p.sigil",
        "\\p.sigil",
        "C:p.sigil",
        "../p.sigil",
        "missing.sigil",
    ] {
        let consumer = importing(path, "Provider", "query") + &component("C", "Use query.", "");
        let r = resolve(&[
            ("p.sigil", &default_provider()),
            (
                "folder/_module.sigil",
                &provider("Summary", &["query", "submit"]),
            ),
            ("c.sigil", &consumer),
        ]);
        assert_eq!(codes(&r), ["SIGIL_UNRESOLVED_IMPORT_PATH"], "{path}");
    }
    let consumer = importing("folder//./x/../_module.sigil", "Provider", "query")
        + &component("C", "Use query.", "");
    let r = resolve(&[
        ("folder/_module.sigil", &default_provider()),
        ("c.sigil", &consumer),
    ]);
    assert_eq!(codes(&r), Vec::<&str>::new());
    let consumer = importing("p.sigil", "Missing", "query") + &component("C", "Use query.", "");
    let missing = resolve(&[("p.sigil", &default_provider()), ("c.sigil", &consumer)]);
    assert_eq!(codes(&missing), ["SIGIL_UNRESOLVED_IMPORTED_COMPONENT"]);
}

#[test]
fn global_duplicate_components_retain_physical_evidence_without_an_owner() {
    let consumer = importing("a.sigil", "Provider", "query") + &component("C", "Use query.", "");
    let r = resolve(&[
        ("a.sigil", &default_provider()),
        ("b.sigil", &default_provider()),
        ("c.sigil", &consumer),
    ]);
    assert_eq!(
        codes(&r),
        [
            "SIGIL_DUPLICATE_COMPONENT",
            "SIGIL_UNRESOLVED_IMPORTED_COMPONENT"
        ]
    );
    let copies: Vec<_> = r
        .components
        .iter()
        .filter(|c| c.name == "Provider")
        .collect();
    assert_eq!(copies.len(), 2);
    assert!(copies.iter().all(|c| !c.identity_resolved));
    // Each copy keeps its own declaration.
    assert_ne!(
        (copies[0].file, copies[0].index),
        (copies[1].file, copies[1].index)
    );
    assert_eq!(r.diagnostics[0].related.len(), 1);
}

#[test]
fn all_contracts_and_embedded_introductions_use_imports_protected_text_and_incomplete_recovery_do_not_invent_use()
 {
    for section in [
        "goal",
        "interface",
        "state",
        "logic",
        "constraints",
        "cases",
        "decisions",
    ] {
        let other = |name: &str| {
            if section == name {
                "Use query."
            } else {
                "Offer an interaction."
            }
        };
        let extra = if ["state", "logic", "constraints", "cases"].contains(&section) {
            format!("{section} {{\nUse query.\n}}")
        } else {
            String::new()
        };
        let decisions = if section == "decisions" {
            "decisions {\nUse query.\n}"
        } else {
            ""
        };
        let body = format!(
            "component C {{\ngoal {{\n{}\n}}\n{extra}\ninterface {{\n{}\n}}\n{decisions}\n}}",
            other("goal"),
            other("interface"),
        );
        let consumer = importing("p.sigil", "Provider", "query") + &body;
        let r = resolve(&[("p.sigil", &default_provider()), ("c.sigil", &consumer)]);
        assert_eq!(codes(&r), Vec::<&str>::new(), "{section}");
    }
    for (prose, used) in [
        ("Use query.\n```text\nquery\n```", true),
        ("Read [query](./doc.md).\n```text\nquery\n```", false),
    ] {
        let consumer = importing("p.sigil", "Provider", "query") + &component("C", prose, "");
        let r = resolve(&[("p.sigil", &default_provider()), ("c.sigil", &consumer)]);
        assert_eq!(r.imports[0].names[0].used, used, "{prose:?}");
        let want: &[&str] = if used {
            &[]
        } else {
            &["SIGIL_UNUSED_TAG_IMPORT"]
        };
        assert_eq!(codes(&r), want, "{prose:?}");
    }
    let consumer = importing("p.sigil", "Provider", "query")
        + &component("C", "An example.\n```text\nquery", "");
    let incomplete = resolve(&[("p.sigil", &default_provider()), ("c.sigil", &consumer)]);
    assert_eq!(codes(&incomplete), ["SIGIL_UNCLOSED_LITERAL_BLOCK"]);
}

#[test]
fn only_tags_evidenced_by_the_provider_interface_are_directly_importable() {
    let outside_provider = component(
        "Provider",
        "Offer an interaction.",
        "state {\nA *query* exists.\n}",
    );
    let consumer =
        importing("provider.sigil", "Provider", "query") + &component("Consumer", "Use query.", "");
    let outside = resolve(&[
        ("provider.sigil", &outside_provider),
        ("consumer.sigil", &consumer),
    ]);
    assert_eq!(codes(&outside), ["SIGIL_UNRESOLVED_IMPORTED_TAG"]);
    assert_eq!(outside.imports[0].names[0].status, NameStatus::Unresolved);
    assert!(find(&outside, "Consumer").references.is_empty());

    let evidenced_provider = component("Provider", "Use query.", "state {\nA *query* exists.\n}");
    let evidenced = resolve(&[
        ("provider.sigil", &evidenced_provider),
        ("consumer.sigil", &consumer),
    ]);
    assert_eq!(codes(&evidenced), Vec::<&str>::new());
    assert_eq!(evidenced.imports[0].names[0].status, NameStatus::Resolved);
    assert_eq!(
        owner_names(&evidenced, "Consumer"),
        [Some("Provider".to_owned())]
    );
}

#[test]
fn interface_grouping_and_inline_definitions_expose_provider_owned_tags() {
    let grouped = component("Grouped", "query {\nOffer query.\n}", "");
    let inline = component("Inline", "An inline *submit* interaction.", "");
    let consumer = importing("group.sigil", "Grouped", "query")
        + &importing("inline.sigil", "Inline", "submit")
        + &component("Consumer", "Use query and submit.", "");
    let r = resolve(&[
        ("group.sigil", &grouped),
        ("inline.sigil", &inline),
        ("consumer.sigil", &consumer),
    ]);
    assert_eq!(codes(&r), Vec::<&str>::new());
    assert_eq!(
        selection_statuses(&r),
        [NameStatus::Resolved, NameStatus::Resolved]
    );
}

#[test]
fn interface_evidence_does_not_re_export_an_imported_tag() {
    let provider_source = component("Provider", "Offer query.", "state {\nA *query* exists.\n}");
    let middle =
        importing("provider.sigil", "Provider", "query") + &component("Middle", "Use query.", "");
    let direct =
        importing("provider.sigil", "Provider", "query") + &component("Direct", "Use query.", "");
    let transitive =
        importing("middle.sigil", "Middle", "query") + &component("Transitive", "Use query.", "");
    let r = resolve(&[
        ("provider.sigil", &provider_source),
        ("middle.sigil", &middle),
        ("direct.sigil", &direct),
        ("transitive.sigil", &transitive),
    ]);
    // Import order follows the sorted source paths: direct, middle, transitive.
    assert_eq!(
        selection_statuses(&r),
        [
            NameStatus::Resolved,
            NameStatus::Resolved,
            NameStatus::Unresolved
        ]
    );
    assert_eq!(codes(&r), ["SIGIL_UNRESOLVED_IMPORTED_TAG"]);
}

#[test]
fn interface_prose_uses_longest_match_semantics_before_exporting_local_tags() {
    let provider_source = "@status.sigil from Status import { order status }\n\
        component Provider {\n\
        goal {\nOwn a responsibility.\n}\n\
        state {\nAn *order* exists.\n}\n\
        interface {\nThe order status is reported.\n}\n\
        }\n";
    let status = component("Status", "An *order status* describes an order.", "");
    let consumer =
        importing("provider.sigil", "Provider", "order") + &component("Consumer", "Use order.", "");
    let r = resolve(&[
        ("provider.sigil", provider_source),
        ("status.sigil", &status),
        ("consumer.sigil", &consumer),
    ]);
    assert_eq!(codes(&r), ["SIGIL_UNRESOLVED_IMPORTED_TAG"]);
    let consumer_import = r
        .imports
        .iter()
        .find(|item| r.paths[item.file] == "consumer.sigil")
        .unwrap();
    assert_eq!(consumer_import.names[0].status, NameStatus::Unresolved);
}

#[test]
fn imported_tags_remain_usable_across_the_canonical_contract_sections() {
    let sections = [
        "goal",
        "state",
        "logic",
        "constraints",
        "cases",
        "interface",
        "decisions",
    ];
    let body: Vec<String> = sections
        .iter()
        .map(|section| format!("{section} {{\nUse query.\n}}"))
        .collect();
    let consumer = importing("provider.sigil", "Provider", "query")
        + &format!("component Consumer {{\n{}\n}}\n", body.join("\n"));
    let r = resolve(&[
        ("provider.sigil", &default_provider()),
        ("consumer.sigil", &consumer),
    ]);
    assert_eq!(codes(&r), Vec::<&str>::new());
    let consumer = find(&r, "Consumer");
    let used_in: Vec<&str> = consumer
        .references
        .iter()
        .map(|reference| r.facet(consumer, reference.facet).section.as_str())
        .collect();
    assert_eq!(used_in, sections);
}
