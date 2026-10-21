//! The formatter. Ported from the TS `formatter_080_test.ts`.
use sigil_core::language::{
    format::{format_document, format_text},
    fs::MemoryFs,
    parse::parse_document,
    resolve::ResolvedWorkspace,
    text::capture_source,
    workspace::Workspace,
};

const CONFIG: &str =
    r#"{"sigilVersion":"0.9.0","workspace":{"name":"t"},"files":{"include":["**/*.sigil"]}}"#;

fn component(body: &str) -> String {
    format!("component C {{\ngoal {{\nOwn a responsibility.\n}}\ninterface {{\n{body}\n}}\n}}")
}

fn workspace(files: &[(&str, &str)]) -> Workspace {
    let mut fs = MemoryFs::new();
    fs.insert(".sigil/config.json", CONFIG);
    for (path, text) in files {
        fs.insert(path, *text);
    }
    Workspace::load_with(&fs).unwrap()
}

fn reference_names(text: &str, component: &str) -> Vec<String> {
    let resolved = ResolvedWorkspace::from(&workspace(&[("c.sigil", text)]));
    let found = resolved
        .components
        .iter()
        .find(|c| c.name == component)
        .expect("component");
    found.references.iter().map(|r| r.name.clone()).collect()
}

fn diagnostics_of(text: &str) -> usize {
    parse_document("c.sigil", &capture_source("c.sigil", text.as_bytes()))
        .diagnostics
        .len()
}

#[test]
fn width_only_formatting_is_safe_idempotent_and_keeps_the_final_ending() {
    for ending in ["\n", "\r\n", "\r"] {
        let body = format!("      {}😀.", "word ".repeat(30));
        let source = format!("\u{feff}{}{ending}", component(&body).replace('\n', ending));
        let result = format_text("c.sigil", &source);
        let formatted = result.formatted_source.expect("formatted");
        assert!(result.changed);
        assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
        assert!(formatted.starts_with("\u{feff}component C"));
        assert!(formatted.ends_with(ending));
        let again = format_text("c.sigil", &formatted);
        assert_eq!(again.formatted_source.as_deref(), Some(formatted.as_str()));
        assert!(!again.changed);
    }
}

#[test]
fn exact_multiword_tags_survive_and_joining_lines_never_creates_a_reference() {
    let source = component(&format!(
        "A *search  results* has meaning.\n\n{}search  results follow.\n\nsearch\nresults remain separate.",
        "prefix ".repeat(10)
    ));
    let before = reference_names(&source, "C");
    let result = format_text("c.sigil", &source);
    let formatted = result.formatted_source.expect("formatted");
    assert!(formatted.contains("search  results"));
    assert_eq!(reference_names(&formatted, "C"), before);
}

#[test]
fn import_dependent_formatting_needs_the_provider_in_the_workspace() {
    let provider = "component P {\ngoal {\nOwn a responsibility.\n}\ninterface {\nA *search results* has meaning.\n}\n}";
    for prefix in ["", &"prefix ".repeat(10)] {
        let source = format!(
            "@p.sigil from P import {{ search results }}\n{}",
            component(&format!("{prefix}search results follow."))
        );
        // Alone, the imports have no providers.
        let alone = format_text("c.sigil", &source);
        assert!(alone.formatted_source.is_none());
        assert!(
            alone
                .diagnostics
                .iter()
                .any(|d| d.code == "SIGIL_FORMAT_CONTEXT_UNAVAILABLE")
        );
        let with_provider = workspace(&[("c.sigil", &source), ("p.sigil", provider)]);
        let result = format_document(&with_provider, "c.sigil");
        let formatted = result.formatted_source.expect("formatted");
        assert_eq!(result.changed, !prefix.is_empty());
        let after = workspace(&[("c.sigil", &formatted), ("p.sigil", provider)]);
        let resolved = ResolvedWorkspace::from(&after);
        let c = resolved.components.iter().find(|c| c.name == "C").unwrap();
        let names: Vec<&str> = c.references.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["search results"]);
        // A workspace without the provider cannot format the importer.
        let missing = workspace(&[("c.sigil", &source)]);
        assert!(
            format_document(&missing, "c.sigil")
                .formatted_source
                .is_none()
        );
    }
}

#[test]
fn an_unformattable_multiword_reference_suppresses_the_width_repair() {
    let name = format!("{}end", "word ".repeat(18));
    let provider = format!(
        "component P {{\ngoal {{\nOwn a responsibility.\n}}\ninterface {{\n{name} {{\nOffer an interaction.\n}}\n}}\n}}"
    );
    let source = format!("@p.sigil from P import {{ {name} }}\n{}", component(&name));
    let files = workspace(&[("c.sigil", &source), ("p.sigil", &provider)]);
    let resolved = ResolvedWorkspace::from(&files);
    let codes: Vec<&str> = resolved
        .diagnostics
        .iter()
        .map(|d| d.code.as_str())
        .collect();
    assert_eq!(codes, ["SIGIL_UNFORMATTABLE_LINE"]);
    let result = format_document(&files, "c.sigil");
    assert!(result.formatted_source.is_none());
    assert!(!result.changed);
}

#[test]
fn complete_links_and_payload_bytes_stay_intact() {
    let link = format!("[a label](<./{}target.md> \"a title\")", "long/".repeat(40));
    let payload = "```text\r\n  raw  \r\n\r\n }\r\n```";
    let source = component(&format!(
        "{}{link} follows.\n{payload}",
        "prefix ".repeat(10)
    ));
    let result = format_text("c.sigil", &source);
    let formatted = result.formatted_source.expect("formatted");
    assert!(formatted.contains(&link));
    assert!(formatted.contains(payload));
    assert_eq!(diagnostics_of(&formatted), 0);
}

#[test]
fn structural_recovery_broken_names_and_collisions_are_refused() {
    for source in [
        component("A *broken"),
        component("An example.\n```text\nunclosed"),
        component("A *query* exists.\n\nAnother *query* exists."),
    ] {
        let result = format_text("c.sigil", &source);
        assert!(result.formatted_source.is_none(), "{source}");
        assert!(!result.changed);
    }
}

#[test]
fn an_unsafe_structural_line_never_becomes_a_new_group() {
    let source = component(&format!("{}tag {{ remains prose.", "word ".repeat(15)));
    let result = format_text("c.sigil", &source);
    if let Some(formatted) = result.formatted_source {
        let resolved = ResolvedWorkspace::from(&workspace(&[("c.sigil", &formatted)]));
        let interface = &resolved.documents[0].components[0].sections[1];
        assert!(interface.groups.is_empty());
    }
}
