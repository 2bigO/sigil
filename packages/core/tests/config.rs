//! The general workspace config, merged tool settings and workspace discovery.
//! Ported from the TS `config_parity_test.ts` and `workspace_080_test.ts`.
use serde_json::{Value, json};
use sigil_core::language::{
    config::{merge_tools, parse_config},
    discovery::discover_workspace,
    fs::MemoryFs,
    tools::read_tool_settings,
    workspace::Workspace,
};
use std::{fs, path::PathBuf};

const SOURCE: &str = "component C {\n  goal {\n    Own a responsibility.\n  }\n\n  interface {\n    Offer an interaction.\n  }\n}\n";

fn config(exclude: &[&str], members: &[&str]) -> String {
    json!({
        "sigilVersion": "0.9.0",
        "workspace": {"name": "test", "members": members},
        "files": {"include": ["**/*.sigil"], "exclude": exclude},
    })
    .to_string()
}

fn codes(workspace: &Workspace) -> Vec<String> {
    workspace
        .diagnostics
        .iter()
        .map(|d| d.code.clone())
        .collect()
}

fn paths(workspace: &Workspace) -> Vec<&str> {
    workspace.sources.iter().map(|s| s.path.as_str()).collect()
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("sigil-core-config-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(root: &std::path::Path, path: &str, text: &str) {
    let file = root.join(path);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, text).unwrap();
}

#[test]
fn the_parser_accepts_exactly_what_the_ts_parser_accepts() {
    let fixtures: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/config-parity.json")).unwrap();
    assert!(fixtures.len() > 50);
    for fixture in fixtures {
        let name = fixture["name"].as_str().unwrap();
        let accepted = parse_config(fixture["source"].as_str().unwrap(), ".sigil/config.json")
            .config
            .is_some();
        assert_eq!(
            accepted,
            fixture["parserValid"].as_bool().unwrap(),
            "{name}: parser disagreed"
        );
    }
}

#[test]
fn the_general_config_keeps_the_version_name_and_tool_data() {
    let source = json!({
        "sigilVersion": "0.9.0",
        "workspace": {"name": "demo"},
        "files": {"include": ["**/*.sigil"]},
        "tools": {"alpha": {"a": 1}, "beta": {}},
    })
    .to_string();
    let parsed = parse_config(&source, ".sigil/config.json").config.unwrap();
    assert_eq!(parsed.sigil_version, "0.9.0");
    assert_eq!(parsed.workspace_name, "demo");
    assert_eq!(parsed.tools["alpha"], json!({"a": 1}));
    assert!(parsed.tools.contains_key("beta"));
}

#[test]
fn a_tool_value_that_is_not_an_object_is_refused() {
    let source = json!({
        "sigilVersion": "0.9.0",
        "workspace": {"name": "demo"},
        "files": {"include": ["**/*.sigil"]},
        "tools": {"alpha": 3},
    })
    .to_string();
    let parsed = parse_config(&source, ".sigil/config.json");
    assert!(parsed.config.is_none());
    assert_eq!(parsed.diagnostics[0].code, "SIGIL_CONFIG_INVALID");
}

#[test]
fn local_settings_merge_objects_recursively_and_replace_arrays_and_scalars() {
    let shared = json!({
        "sigilc": {"implementation": {"dirs": ["src"], "allowEmpty": false}},
        "other": {"x": 1},
    });
    let local = json!({
        "sigilc": {"implementation": {"dirs": ["lib"], "include": ["**/*.rs"]}},
    });
    let merged = merge_tools(shared.as_object().unwrap(), local.as_object().unwrap());
    assert_eq!(
        Value::Object(merged),
        json!({
            "sigilc": {"implementation": {"dirs": ["lib"], "allowEmpty": false, "include": ["**/*.rs"]}},
            "other": {"x": 1},
        })
    );
}

#[test]
fn a_config_only_read_returns_each_layer_and_the_merge() {
    let mut files = MemoryFs::new();
    files.insert(
        ".sigil/config.json",
        json!({
            "sigilVersion": "0.9.0",
            "workspace": {"name": "t"},
            "files": {"include": ["**/*.sigil"]},
            "tools": {"sigilc": {"implementation": {"dirs": ["src"]}}, "other": {"x": 1}},
        })
        .to_string(),
    );
    files.insert(
        ".sigil/local.json",
        json!({"tools": {"sigilc": {"implementation": {"dirs": ["lib"]}}}}).to_string(),
    );
    let settings = read_tool_settings(&files).unwrap();
    assert_eq!(
        settings.shared["sigilc"]["implementation"]["dirs"],
        json!(["src"])
    );
    assert_eq!(
        settings.local.as_ref().unwrap()["sigilc"]["implementation"]["dirs"],
        json!(["lib"])
    );
    assert_eq!(
        settings.merged["sigilc"]["implementation"]["dirs"],
        json!(["lib"])
    );
    assert_eq!(settings.merged["other"], json!({"x": 1}));
    // The same merge is on the loaded workspace.
    files.insert("c.sigil", SOURCE);
    let workspace = Workspace::load_with(&files).unwrap();
    assert_eq!(
        Value::Object(workspace.tools),
        Value::Object(settings.merged)
    );
}

#[test]
fn a_config_only_read_reports_a_missing_or_invalid_config() {
    let missing = read_tool_settings(&MemoryFs::new()).unwrap_err();
    assert_eq!(missing[0].code, "SIGIL_CONFIG_NOT_FOUND");
    let mut bad_local = MemoryFs::new();
    bad_local.insert(".sigil/config.json", config(&[], &[]));
    bad_local.insert(".sigil/local.json", r#"{"workspace":{}}"#);
    assert_eq!(
        read_tool_settings(&bad_local).unwrap_err()[0].code,
        "SIGIL_CONFIG_INVALID"
    );
    let mut bad_config = MemoryFs::new();
    bad_config.insert(".sigil/config.json", [0xff]);
    assert_eq!(
        read_tool_settings(&bad_config).unwrap_err()[0].code,
        "SIGIL_CONFIG_PARSE"
    );
}

#[test]
fn an_unsupported_language_version_stops_loading() {
    for version in ["0.7.0", "0.8.0"] {
        let mut files = MemoryFs::new();
        files.insert(
            ".sigil/config.json",
            config(&[], &[]).replace("0.9.0", version),
        );
        files.insert("c.sigil", SOURCE);
        let workspace = Workspace::load_with(&files).unwrap();
        assert!(workspace.sources.is_empty());
        assert_eq!(codes(&workspace), ["SIGIL_UNSUPPORTED_VERSION"]);
    }
}

#[test]
fn a_nested_config_inside_the_selection_is_an_error_and_inside_an_excluded_subtree_is_not() {
    for (exclude, allowed) in [
        (vec![], false),
        (vec!["nested/**/*.sigil"], false),
        (vec!["nested/**"], true),
    ] {
        let mut files = MemoryFs::new();
        files.insert(".sigil/config.json", config(&exclude, &[]));
        files.insert("root.sigil", SOURCE);
        files.insert("nested/.sigil/config.json", config(&[], &[]));
        files.insert("nested/c.sigil", SOURCE);
        let workspace = Workspace::load_with(&files).unwrap();
        assert_eq!(paths(&workspace), ["root.sigil"], "{exclude:?}");
        assert_eq!(
            codes(&workspace),
            if allowed {
                vec![]
            } else {
                vec!["SIGIL_NESTED_CONFIG"]
            },
            "{exclude:?}"
        );
    }
}

#[test]
fn a_member_cannot_become_an_independent_workspace() {
    for (exclude, members, expected) in [
        (vec![], vec![], 1),
        (vec!["nested/**"], vec![], 0),
        (vec!["nested/**"], vec!["nested"], 1),
    ] {
        let mut files = MemoryFs::new();
        files.insert(".sigil/config.json", config(&exclude, &members));
        files.insert("root.sigil", SOURCE);
        files.insert("nested/.sigil/config.json", config(&[], &[]));
        files.insert("nested/c.sigil", SOURCE);
        let workspace = Workspace::load_with(&files).unwrap();
        assert_eq!(paths(&workspace), ["root.sigil"]);
        assert_eq!(
            workspace.diagnostics.len(),
            expected,
            "{exclude:?} {members:?}"
        );
    }
}

#[test]
fn discovery_picks_the_nearest_ancestor_config() {
    let root = temp("nearest");
    write(&root, ".sigil/config.json", &config(&["child/**"], &[]));
    write(&root, "child/.sigil/config.json", &config(&[], &[]));
    write(&root, "child/deep/c.sigil", SOURCE);
    let found = discover_workspace(&root.join("child/deep/c.sigil"), None);
    assert!(found.diagnostics.is_empty(), "{:?}", found.diagnostics);
    assert_eq!(found.root.unwrap(), root.join("child"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn discovery_refuses_a_workspace_nested_in_a_parent_that_does_not_exclude_it() {
    let root = temp("nested");
    write(&root, ".sigil/config.json", &config(&[], &[]));
    write(&root, "child/.sigil/config.json", &config(&[], &[]));
    let found = discover_workspace(&root.join("child"), None);
    assert_eq!(found.root.unwrap(), root.join("child"));
    assert_eq!(found.diagnostics[0].code, "SIGIL_NESTED_CONFIG");
    assert_eq!(found.diagnostics[0].related.len(), 1);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn discovery_reports_a_missing_config_and_an_explicit_root_is_taken_as_given() {
    let root = temp("missing");
    let found = discover_workspace(&root, None);
    assert!(found.root.is_none());
    assert_eq!(found.diagnostics[0].code, "SIGIL_CONFIG_NOT_FOUND");
    // An explicit root is not searched upward; loading it needs its own config.
    write(&root, "parent/.sigil/config.json", &config(&[], &[]));
    let explicit = discover_workspace(&root.join("parent/child"), Some(&root.join("parent/child")));
    assert_eq!(
        explicit.root.as_deref(),
        Some(root.join("parent/child").as_path())
    );
    let workspace = Workspace::load(&root.join("parent/child")).unwrap_or_else(|_| unreachable!());
    assert_eq!(codes(&workspace), ["SIGIL_CONFIG_NOT_FOUND"]);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn discovery_from_a_path_with_dot_and_dot_dot_segments_visits_real_parents() {
    let root = temp("dotdot");
    write(&root, ".sigil/config.json", &config(&[], &[]));
    write(&root, "a/keep.sigil", SOURCE);
    write(&root, "b/c.sigil", SOURCE);
    // Walking up from `a/../b/c.sigil` is walking up from `b/c.sigil`: one
    // workspace at the root, no phantom ancestor and no nested-config error.
    let found = discover_workspace(&root.join("a/../b/./c.sigil"), None);
    assert!(found.diagnostics.is_empty(), "{:?}", found.diagnostics);
    assert_eq!(found.root.unwrap(), root);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn discovery_reports_an_ancestor_config_it_cannot_read_or_accept() {
    let root = temp("parent-fails");
    write(&root, ".sigil/config.json", "not json");
    write(&root, "child/.sigil/config.json", &config(&[], &[]));
    let found = discover_workspace(&root.join("child"), None);
    assert_eq!(found.root.unwrap(), root.join("child"));
    assert_eq!(found.diagnostics[0].code, "SIGIL_CONFIG_PARSE");
    // A parent that parses but is invalid reports its own diagnostics.
    write(&root, ".sigil/config.json", r#"{"sigilVersion":"0.9.0"}"#);
    let found = discover_workspace(&root.join("child"), None);
    assert_eq!(found.diagnostics[0].code, "SIGIL_CONFIG_INVALID");
    // A parent in invalid UTF-8 is unreadable as text.
    fs::write(root.join(".sigil/config.json"), [0xff]).unwrap();
    let found = discover_workspace(&root.join("child"), None);
    assert_eq!(found.diagnostics[0].code, "SIGIL_CONFIG_PARSE");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_local_override_supplied_as_text_flows_into_the_merged_settings() {
    use sigil_core::language::fs::Overlay;
    let mut base = MemoryFs::new();
    base.insert(
        ".sigil/config.json",
        json!({
            "sigilVersion": "0.9.0",
            "workspace": {"name": "t"},
            "files": {"include": ["**/*.sigil"]},
            "tools": {"sigilc": {"implementation": {"dirs": ["src"]}}},
        })
        .to_string(),
    );
    let mut overlay = Overlay::new(&base);
    overlay.set(
        ".sigil/local.json",
        json!({"tools": {"sigilc": {"implementation": {"dirs": ["lib"]}}}}).to_string(),
    );
    let settings = read_tool_settings(&overlay).unwrap();
    assert_eq!(
        settings.merged["sigilc"]["implementation"]["dirs"],
        json!(["lib"])
    );
    assert_eq!(
        settings.shared["sigilc"]["implementation"]["dirs"],
        json!(["src"])
    );
}
