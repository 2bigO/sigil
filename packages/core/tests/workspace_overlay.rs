//! Caller-supplied text over a workspace, and ingress of source bytes.
//! Ported from `workspace_ingress_test.ts` and extended for overlays.
use sigil_core::language::{
    fs::{DiskFs, MemoryFs, Overlay, SourceFs},
    resolve::ResolvedWorkspace,
    workspace::Workspace,
};
use std::fs;

const CONFIG: &str = r#"{"sigilVersion":"0.9.0","workspace":{"name":"test"},"files":{"include":["**/*.sigil"]},"tools":{}}"#;
const GOOD: &str = "component C {\n  goal {\n    Own a responsibility.\n  }\n\n  interface {\n    Offer an interaction.\n  }\n}\n";
const NO_INTERFACE: &str = "component C {\n  goal {\n    Own a responsibility.\n  }\n}\n";

/// Every diagnostic of the workspace, after parsing and resolution.
fn codes(workspace: &Workspace) -> Vec<String> {
    let mut codes: Vec<String> = ResolvedWorkspace::from(workspace)
        .diagnostics
        .iter()
        .map(|d| d.code.clone())
        .collect();
    codes.sort();
    codes
}

fn disk(name: &str, files: &[(&str, &str)]) -> (std::path::PathBuf, DiskFs) {
    let root =
        std::env::temp_dir().join(format!("sigil-core-overlay-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join(".sigil")).unwrap();
    fs::write(root.join(".sigil/config.json"), CONFIG).unwrap();
    for (path, text) in files {
        fs::write(root.join(path), text).unwrap();
    }
    let source = DiskFs::new(&root);
    (root, source)
}

#[test]
fn supplied_text_replaces_the_disk_file_for_one_reading_and_leaves_the_disk_alone() {
    let (root, base) = disk("replace", &[("c.sigil", GOOD)]);
    assert!(codes(&Workspace::load_with(&base).unwrap()).is_empty());

    let mut overlay = Overlay::new(&base);
    overlay.set("c.sigil", NO_INTERFACE);
    let supplied = Workspace::load_with(&overlay).unwrap();
    assert_eq!(codes(&supplied), ["SIGIL_MISSING_INTERFACE"]);
    assert_eq!(fs::read_to_string(root.join("c.sigil")).unwrap(), GOOD);

    overlay.remove("c.sigil");
    assert!(codes(&Workspace::load_with(&overlay).unwrap()).is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn supplied_text_for_a_new_path_adds_a_source_document_once_in_order() {
    let (root, base) = disk("new-path", &[("a.sigil", GOOD)]);
    let mut overlay = Overlay::new(&base);
    overlay.set("b.sigil", GOOD.replace("component C", "component B"));
    overlay.set("a.sigil", GOOD);
    let workspace = Workspace::load_with(&overlay).unwrap();
    let paths: Vec<&str> = workspace.sources.iter().map(|s| s.path.as_str()).collect();
    assert_eq!(paths, ["a.sigil", "b.sigil"]);
    let listed = overlay.list_files().unwrap();
    assert_eq!(listed.iter().filter(|p| *p == "a.sigil").count(), 1);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn an_invalid_source_keeps_independent_diagnostics_and_has_no_text() {
    let mut files = MemoryFs::new();
    files.insert(".sigil/config.json", CONFIG);
    files.insert("bad.sigil", [0x61, 0xff]);
    files.insert("other.sigil", NO_INTERFACE);
    let workspace = Workspace::load_with(&files).unwrap();
    assert!(workspace.config.is_some());
    assert_eq!(
        codes(&workspace),
        ["SIGIL_INVALID_ENCODING", "SIGIL_MISSING_INTERFACE"]
    );
    let bad = workspace.sources.iter().find(|s| s.path == "bad.sigil");
    assert!(bad.unwrap().capture.source.is_none());
    assert!(!workspace.text_complete);
}

#[test]
fn malformed_config_bytes_stop_interpretation_as_a_config_error() {
    let mut files = MemoryFs::new();
    files.insert(".sigil/config.json", [0xff]);
    files.insert("bad.sigil", "broken");
    let workspace = Workspace::load_with(&files).unwrap();
    assert!(workspace.config.is_none());
    assert!(workspace.sources.is_empty());
    assert_eq!(codes(&workspace), ["SIGIL_CONFIG_PARSE"]);
}

#[test]
fn bytes_and_supplied_text_with_the_same_content_read_the_same() {
    let text = "\u{feff}component C {\r\ngoal {\r\nOwn a responsibility.\r\n}\r\ninterface {\r\nOffer an interaction.\r\n}\r\n}";
    let mut bytes = MemoryFs::new();
    bytes.insert(".sigil/config.json", CONFIG);
    bytes.insert("c.sigil", text.as_bytes());
    let mut base = MemoryFs::new();
    base.insert(".sigil/config.json", CONFIG);
    let mut overlay = Overlay::new(&base);
    overlay.set("c.sigil", text);
    let a = Workspace::load_with(&bytes).unwrap();
    let b = Workspace::load_with(&overlay).unwrap();
    assert_eq!(codes(&a), codes(&b));
    assert_eq!(
        a.sources[0].capture.source.as_ref().unwrap().text,
        b.sources[0].capture.source.as_ref().unwrap().text
    );
}
