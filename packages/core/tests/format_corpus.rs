//! The formatter against the TS formatter's recorded output, on sources from
//! this repository in three shapes. The fixtures are written by
//! `scripts/generate-format-fixtures.ts`.
use serde_json::Value;
use sigil_core::language::{
    format::{format_document, format_text},
    fs::MemoryFs,
    workspace::Workspace,
};

const CONFIG: &str = r#"{"sigilVersion":"0.9.0","workspace":{"name":"format-corpus"},"files":{"include":["**/*.sigil"]}}"#;

fn corpus() -> Vec<Value> {
    serde_json::from_str(include_str!("fixtures/format/differential.json")).unwrap()
}

fn load(workspace: &Value, path: &str, input: &str) -> Workspace {
    let mut files = MemoryFs::new();
    files.insert(".sigil/config.json", CONFIG);
    for (name, text) in workspace["files"].as_object().unwrap() {
        files.insert(name, text.as_str().unwrap());
    }
    files.insert(path, input);
    Workspace::load_with(&files).unwrap()
}

#[test]
fn the_rust_formatter_returns_the_bytes_the_ts_formatter_returned() {
    let mut cases = 0;
    let mut changed = 0;
    for workspace in corpus() {
        for case in workspace["cases"].as_array().unwrap() {
            let path = case["path"].as_str().unwrap();
            let input = case["input"].as_str().unwrap();
            let label = format!("{} {path} ({})", workspace["name"], case["variant"]);
            let result = format_document(&load(&workspace, path, input), path);
            let expected = &case["expected"];
            assert_eq!(
                result.formatted_source.as_deref(),
                expected["formatted"].as_str(),
                "{label}: formatted bytes"
            );
            assert_eq!(
                result.changed,
                expected["changed"].as_bool().unwrap(),
                "{label}: changed"
            );
            let mut codes: Vec<&str> = result.diagnostics.iter().map(|d| d.code.as_str()).collect();
            codes.sort_unstable();
            let wanted: Vec<&str> = expected["codes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c.as_str().unwrap())
                .collect();
            assert_eq!(codes, wanted, "{label}: diagnostic codes");
            cases += 1;
            changed += usize::from(result.changed);
        }
    }
    assert!(cases > 90, "{cases} cases");
    assert!(changed > 40, "{changed} cases changed");
}

#[test]
fn every_source_that_the_ts_formatter_calls_canonical_is_a_fixed_point_here() {
    let mut fixed = 0;
    for workspace in corpus() {
        for case in workspace["cases"].as_array().unwrap() {
            let expected = &case["expected"];
            if case["variant"] != "as-written" || expected["formatted"].is_null() {
                continue;
            }
            let path = case["path"].as_str().unwrap();
            let input = case["input"].as_str().unwrap();
            let result = format_document(&load(&workspace, path, input), path);
            assert_eq!(result.formatted_source.as_deref(), Some(input), "{path}");
            assert!(!result.changed, "{path}");
            fixed += 1;
        }
    }
    assert!(fixed > 25, "{fixed} files");
}

#[test]
fn formatting_formatted_output_changes_nothing() {
    for workspace in corpus() {
        for case in workspace["cases"].as_array().unwrap() {
            let Some(formatted) = case["expected"]["formatted"].as_str() else {
                continue;
            };
            let path = case["path"].as_str().unwrap();
            let again = format_document(&load(&workspace, path, formatted), path);
            assert_eq!(again.formatted_source.as_deref(), Some(formatted), "{path}");
            assert!(!again.changed, "{path}");
        }
    }
    // The standalone entry agrees on a source without imports.
    let result = format_text(
        "c.sigil",
        "component C {\ngoal {\nOwn a responsibility.\n}\n\ninterface {\nOffer an interaction.\n}\n}\n",
    );
    assert!(!result.changed);
}
