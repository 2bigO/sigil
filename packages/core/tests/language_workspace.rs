//! Workspace loading edge cases.
use sigil_core::language::{fs::MemoryFs, resolve::ResolvedWorkspace, workspace::Workspace};
use std::{fs, path::PathBuf};

fn temp(name: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("sigil-core-language-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join(".sigil")).unwrap();
    dir
}

const CONFIG: &str =
    r#"{"sigilVersion":"0.9.0","workspace":{"name":"t"},"files":{"include":["**/*.sigil"]}}"#;

#[test]
fn missing_config_reports_not_found_and_loads_nothing() {
    let dir = temp("missing");
    fs::remove_dir_all(dir.join(".sigil")).unwrap();
    let workspace = Workspace::load(&dir).unwrap();
    assert!(workspace.config.is_none() && workspace.sources.is_empty());
    assert_eq!(workspace.diagnostics[0].code, "SIGIL_CONFIG_NOT_FOUND");
}

#[test]
fn nested_config_outside_an_excluded_subtree_is_reported() {
    let dir = temp("nested");
    fs::write(dir.join(".sigil/config.json"), CONFIG).unwrap();
    fs::create_dir_all(dir.join("child/.sigil")).unwrap();
    fs::write(dir.join("child/.sigil/config.json"), CONFIG).unwrap();
    fs::write(dir.join("child/a.sigil"), "x").unwrap();
    let workspace = Workspace::load(&dir).unwrap();
    assert_eq!(workspace.diagnostics.len(), 1);
    assert_eq!(workspace.diagnostics[0].code, "SIGIL_NESTED_CONFIG");
    assert_eq!(
        workspace.diagnostics[0].file_path.as_deref(),
        Some("child/.sigil/config.json")
    );
    assert!(
        workspace.sources.is_empty(),
        "the nested workspace's sources are not loaded"
    );
}

#[test]
fn excluded_nested_workspace_is_silently_skipped() {
    let dir = temp("excluded");
    fs::write(
        dir.join(".sigil/config.json"),
        r#"{"sigilVersion":"0.9.0","workspace":{"name":"t"},"files":{"include":["**/*.sigil"],"exclude":["child/**"]}}"#,
    )
    .unwrap();
    fs::create_dir_all(dir.join("child/.sigil")).unwrap();
    fs::write(dir.join("child/.sigil/config.json"), CONFIG).unwrap();
    let workspace = Workspace::load(&dir).unwrap();
    assert!(
        workspace.diagnostics.is_empty(),
        "{:?}",
        workspace.diagnostics
    );
}

#[test]
fn unsupported_version_and_unknown_keys_are_reported() {
    let dir = temp("version");
    fs::write(
        dir.join(".sigil/config.json"),
        r#"{"sigilVersion":"0.8.0","workspace":{"name":"t"},"files":{"include":["**/*.sigil"]}}"#,
    )
    .unwrap();
    assert_eq!(
        Workspace::load(&dir).unwrap().diagnostics[0].code,
        "SIGIL_UNSUPPORTED_VERSION"
    );
    fs::write(dir.join(".sigil/config.json"), r#"{"sigilVersion":"0.9.0","workspace":{"name":"t"},"files":{"include":["**/*.sigil"]},"extra":1}"#).unwrap();
    let diagnostics = Workspace::load(&dir).unwrap().diagnostics;
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, "SIGIL_CONFIG_INVALID");
}

#[test]
fn glossary_collisions_and_context_overlap_are_reported() {
    let dir = temp("glossary");
    fs::write(dir.join(".sigil/config.json"), CONFIG).unwrap();
    fs::write(dir.join("a.sigil"), "x").unwrap();
    fs::write(
        dir.join(".sigil/glossary.json"),
        r#"{"schemaVersion":1,"terms":[{"term":"Hold","definition":"d"},{"term":"hold","definition":"d"}],"contexts":[]}"#,
    )
    .unwrap();
    assert_eq!(
        Workspace::load(&dir).unwrap().diagnostics[0].code,
        "SIGIL_GLOSSARY_TERM_COLLISION"
    );
    fs::write(
        dir.join(".sigil/glossary.json"),
        r#"{"schemaVersion":1,"terms":[],"contexts":[
            {"id":"one","include":["*.sigil"],"exclude":[],"terms":[]},
            {"id":"two","include":["a.*"],"exclude":[],"terms":[]}]}"#,
    )
    .unwrap();
    let diagnostics = Workspace::load(&dir).unwrap().diagnostics;
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, "SIGIL_GLOSSARY_CONTEXT_OVERLAP");
    assert_eq!(diagnostics[0].file_path.as_deref(), Some("a.sigil"));
}

#[test]
fn invalid_local_config_removes_the_selection() {
    let dir = temp("local");
    fs::write(dir.join(".sigil/config.json"), CONFIG).unwrap();
    fs::write(dir.join(".sigil/local.json"), r#"{"nope":1}"#).unwrap();
    fs::write(dir.join("a.sigil"), "x").unwrap();
    let workspace = Workspace::load(&dir).unwrap();
    assert!(workspace.config.is_none() && workspace.sources.is_empty());
    assert_eq!(workspace.diagnostics[0].code, "SIGIL_CONFIG_INVALID");
}

#[test]
fn nul_characters_keep_the_text_and_are_reported_with_byte_ranges() {
    let dir = temp("nul");
    fs::write(dir.join(".sigil/config.json"), CONFIG).unwrap();
    fs::write(dir.join("a.sigil"), b"a\0b").unwrap();
    let workspace = Workspace::load(&dir).unwrap();
    assert!(workspace.text_complete && workspace.sources[0].capture.source.is_some());
    assert_eq!(workspace.diagnostics[0].code, "SIGIL_INVALID_CHARACTER");
    assert_eq!(
        workspace.diagnostics[0]
            .range
            .as_ref()
            .map(|r| (r.start, r.end)),
        Some((1, 2))
    );
}

#[cfg(unix)]
#[test]
fn symbolic_links_and_git_directories_are_skipped() {
    let dir = temp("links");
    fs::write(dir.join(".sigil/config.json"), CONFIG).unwrap();
    fs::write(dir.join("real.sigil"), "x").unwrap();
    std::os::unix::fs::symlink(dir.join("real.sigil"), dir.join("link.sigil")).unwrap();
    fs::create_dir_all(dir.join(".git")).unwrap();
    fs::write(dir.join(".git/hidden.sigil"), "x").unwrap();
    let paths: Vec<String> = Workspace::load(&dir)
        .unwrap()
        .sources
        .into_iter()
        .map(|s| s.path)
        .collect();
    assert_eq!(paths, ["real.sigil"]);
}

#[test]
fn globs_and_paths_follow_the_typescript_reader() {
    use sigil_core::language::path::{glob_matches, normalize_import_path, normalize_path};
    assert!(glob_matches("**/*.sigil", "a.sigil"));
    assert!(glob_matches("**/*.sigil", "x/y/a.sigil"));
    assert!(!glob_matches("*.sigil", "x/a.sigil"));
    assert!(glob_matches("node_modules/**", "node_modules/p/a.sigil"));
    assert!(glob_matches("a?c.sigil", "abc.sigil"));
    assert!(!glob_matches("a?c.sigil", "a/c.sigil"));
    assert!(glob_matches("./x/*.sigil", "x/a.sigil"));
    assert!(glob_matches("a+b.sigil", "a+b.sigil"));
    assert_eq!(normalize_path("a//b/./c/../d\\e"), "a/b/d/e");
    assert_eq!(normalize_path(""), ".");
    assert_eq!(normalize_path("../a"), "../a");
    assert_eq!(normalize_path("/../a"), "/a");
    assert_eq!(normalize_path("C:\\x\\..\\y"), "C:/y");
    assert_eq!(
        normalize_import_path("./dir/a.sigil").as_deref(),
        Some("dir/a.sigil")
    );
    assert_eq!(normalize_import_path("../a.sigil"), None);
    assert_eq!(normalize_import_path("/a.sigil"), None);
    assert_eq!(normalize_import_path("dir"), None);
}

#[test]
fn absolute_paths_are_slash_rooted_or_drive_rooted() {
    use sigil_core::language::path::{has_drive_prefix, is_absolute};
    for drive in ["C:/", "c:\\", "Z:/x", "a:\\x\\y"] {
        assert!(has_drive_prefix(drive), "{drive}");
        assert!(is_absolute(drive), "{drive}");
    }
    for not_drive in ["", "C", "C:", "C:x", "1:/", "CC:/", "/C:/", "é:/", "C;/"] {
        assert!(!has_drive_prefix(not_drive), "{not_drive}");
    }
    for rooted in ["/", "/a", "//host/share", "/C:/"] {
        assert!(is_absolute(rooted), "{rooted}");
    }
    for relative in ["", "a", "./a", "../a", "C:", "C:x", "\\a"] {
        assert!(!is_absolute(relative), "{relative}");
    }
}

const PROVIDER: &str = "component C {\n  goal {\n    Own a responsibility.\n  }\n\n  interface {\n    A *query* has meaning.\n  }\n}\n";

#[test]
fn an_excluded_provider_cannot_be_reached_by_an_explicit_import() {
    let mut files = MemoryFs::new();
    files.insert(
        ".sigil/config.json",
        r#"{"sigilVersion":"0.9.0","workspace":{"name":"t"},"files":{"include":["**/*.sigil"],"exclude":["hidden/**"]}}"#,
    );
    files.insert("hidden/provider.sigil", PROVIDER);
    // A module summary that only imports gets no access of its own.
    files.insert(
        "_module.sigil",
        "@hidden/provider.sigil from C import { query }\n",
    );
    files.insert(
        "consumer.sigil",
        format!("@hidden/provider.sigil from C import {{ query }}\n{PROVIDER}"),
    );
    let workspace = Workspace::load_with(&files).unwrap();
    assert!(
        !workspace
            .sources
            .iter()
            .any(|source| source.path == "hidden/provider.sigil")
    );
    let resolved = ResolvedWorkspace::from(&workspace);
    let mut unresolved: Vec<(&str, &str)> = resolved
        .diagnostics
        .iter()
        .map(|d| (d.code.as_str(), d.file_path.as_deref().unwrap_or("")))
        .collect();
    unresolved.sort();
    assert_eq!(
        unresolved,
        [
            ("SIGIL_UNRESOLVED_IMPORT_PATH", "_module.sigil"),
            ("SIGIL_UNRESOLVED_IMPORT_PATH", "consumer.sigil"),
        ]
    );
}
