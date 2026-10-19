#![cfg(unix)]
//! The `version` command beyond the recorded cases: the core version, markdown,
//! and the missing-config messages.
mod support;

use serde_json::Value;
use support::Temp;

const CORE: &str = sigil_core::language::CORE_VERSION;
const CLI: &str = env!("CARGO_PKG_VERSION");

#[test]
fn json_reports_the_cli_core_and_language_versions() {
    let temp = Temp::workspace();
    let (code, value) = temp.json("version", &[]);
    assert_eq!(code, 0);
    assert_eq!(value["command"], "version");
    assert_eq!(value["cliVersion"], CLI);
    assert_eq!(value["coreVersion"], CORE);
    assert_eq!(value["sigilVersion"], "0.9.0");
    assert_eq!(value["workspaceName"], "test");
    assert_eq!(value["workspaceRoot"], ".");
    assert_eq!(value["configPath"], ".sigil/config.json");
    assert_eq!(value["diagnostics"], serde_json::json!([]));
}

#[test]
fn json_keys_come_in_the_recorded_order() {
    let temp = Temp::workspace();
    let ran = temp.sigil(&["version", "--format", "json"]);
    assert_eq!(
        ran.stdout,
        format!(
            "{{\"command\":\"version\",\"cliVersion\":\"{CLI}\",\"coreVersion\":\"{CORE}\",\"workspaceRoot\":\".\",\"configPath\":\".sigil/config.json\",\"sigilVersion\":\"0.9.0\",\"workspaceName\":\"test\",\"diagnostics\":[]}}\n"
        )
    );
}

#[test]
fn text_is_five_lines() {
    let temp = Temp::workspace();
    let ran = temp.sigil(&["version"]);
    assert_eq!(ran.code, 0);
    assert_eq!(
        ran.stdout,
        format!(
            "CLI: {CLI}\nCore: {CORE}\nWorkspace: .\nWorkspace name: test\nConfigured Sigil: 0.9.0\n"
        )
    );
}

#[test]
fn markdown_has_a_heading_the_three_versions_and_diagnostics() {
    let temp = Temp::workspace();
    let ran = temp.sigil(&["version", "--format", "markdown"]);
    assert_eq!(ran.code, 0);
    assert_eq!(
        ran.stdout,
        format!(
            "# Sigil version\n\n- CLI: {CLI}\n- Core: {CORE}\n- Workspace: .\n- Workspace name: test\n- Configured Sigil: 0.9.0\n\n## Diagnostics\n\nNone.\n"
        )
    );
}

#[test]
fn markdown_lists_diagnostics_like_the_text_does() {
    let temp = Temp::new();
    let ran = temp.sigil(&["version", "--format", "markdown"]);
    assert_eq!(ran.code, 1);
    let text = temp.sigil(&["version"]);
    let line = text.stdout.lines().last().unwrap().to_owned();
    assert!(line.starts_with(
        "error SIGIL_CONFIG_NOT_FOUND: No ancestor .sigil/config.json was found from "
    ));
    assert!(ran.stdout.contains("- Workspace name: unresolved\n"));
    assert!(
        ran.stdout
            .ends_with(&format!("\n## Diagnostics\n\n- {line}\n")),
        "{}",
        ran.stdout
    );
}

#[test]
fn quiet_prints_nothing_and_keeps_the_exit_status() {
    let ok = Temp::workspace();
    for format in ["json", "text", "markdown"] {
        let ran = ok.sigil(&["version", "--quiet", "--format", format]);
        assert_eq!(
            (ran.code, ran.stdout.as_str(), ran.stderr.as_str()),
            (0, "", "")
        );
    }
    let missing = Temp::new();
    let ran = missing.sigil(&["version", "--quiet"]);
    assert_eq!(
        (ran.code, ran.stdout.as_str(), ran.stderr.as_str()),
        (1, "", "")
    );
}

#[test]
fn pretty_indents_by_two_spaces() {
    let temp = Temp::workspace();
    let ran = temp.sigil(&["version", "--format", "json", "--pretty"]);
    assert!(
        ran.stdout
            .starts_with("{\n  \"command\": \"version\",\n  \"cliVersion\"")
    );
    assert!(ran.stdout.ends_with("  \"diagnostics\": []\n}\n"));
}

#[test]
fn a_missing_config_exits_1_with_the_not_found_diagnostic() {
    let temp = Temp::new();
    let (code, value) = temp.json("version", &[]);
    assert_eq!(code, 1);
    assert_eq!(value["configPath"], Value::Null);
    assert_eq!(value["sigilVersion"], Value::Null);
    assert_eq!(value["workspaceName"], Value::Null);
    assert_eq!(value["workspaceRoot"], ".");
    let diagnostic = &value["diagnostics"][0];
    assert_eq!(diagnostic["code"], "SIGIL_CONFIG_NOT_FOUND");
    assert_eq!(diagnostic["stage"], "workspace");
    assert_eq!(diagnostic["severity"], "error");
    assert_eq!(diagnostic["filePath"], ".sigil/config.json");
    assert_eq!(
        diagnostic["message"],
        format!(
            "No ancestor .sigil/config.json was found from {}.",
            temp.text()
        )
    );
}

#[test]
fn an_explicit_root_without_a_config_names_the_root_in_the_message() {
    // The core's message leaves the root out; the command line adds it, as the
    // TypeScript command line did.
    let temp = Temp::new();
    temp.mkdir("empty");
    let root = temp.path("empty");
    let (code, value) = temp.json("version", &["--root", root.to_str().unwrap()]);
    assert_eq!(code, 1);
    let diagnostic = &value["diagnostics"][0];
    assert_eq!(diagnostic["code"], "SIGIL_CONFIG_NOT_FOUND");
    assert_eq!(
        diagnostic["message"],
        format!(
            "Expected .sigil/config.json directly inside workspace root {}.",
            root.display()
        )
    );
    assert_eq!(value["workspaceRoot"], root.to_str().unwrap());
    assert_eq!(value["configPath"], Value::Null);
    assert_eq!(
        diagnostic["filePath"],
        format!("{}/.sigil/config.json", root.display())
    );
}

#[test]
fn a_relative_explicit_root_is_shown_relative() {
    let temp = Temp::new();
    temp.write("project/.sigil/config.json", support::CONFIG);
    let (code, value) = temp.json("version", &["--root", "project"]);
    assert_eq!(code, 0);
    assert_eq!(value["workspaceRoot"], "project");
    assert_eq!(value["configPath"], "project/.sigil/config.json");

    temp.mkdir("empty");
    let (code, value) = temp.json("version", &["--root", "empty"]);
    assert_eq!(code, 1);
    assert_eq!(value["workspaceRoot"], "empty");
    assert_eq!(
        value["diagnostics"][0]["filePath"],
        "empty/.sigil/config.json"
    );
    assert_eq!(
        value["diagnostics"][0]["message"],
        format!(
            "Expected .sigil/config.json directly inside workspace root {}/empty.",
            temp.text()
        )
    );
}

#[test]
fn an_invalid_config_reports_a_parse_diagnostic_with_its_path() {
    let temp = Temp::new();
    temp.write(".sigil/config.json", "{");
    let (code, value) = temp.json("version", &[]);
    assert_eq!(code, 1);
    assert_eq!(value["configPath"], ".sigil/config.json");
    assert_eq!(value["sigilVersion"], Value::Null);
    assert_eq!(value["diagnostics"][0]["code"], "SIGIL_CONFIG_PARSE");
    assert_eq!(value["diagnostics"][0]["filePath"], ".sigil/config.json");
}

#[test]
fn an_absolute_path_argument_shows_absolute_paths() {
    let temp = Temp::workspace();
    temp.mkdir("nested");
    let (_, value) = {
        let nested = temp.path("nested");
        let ran = support::run(&nested, &["version", "--format", "json", &temp.text()]);
        (
            ran.code,
            serde_json::from_str::<Value>(&ran.stdout).unwrap(),
        )
    };
    assert_eq!(value["workspaceRoot"], temp.text());
    assert_eq!(
        value["configPath"],
        format!("{}/.sigil/config.json", temp.text())
    );
    let ran = support::run(&temp.path("nested"), &["version", "--format", "json"]);
    let value: Value = serde_json::from_str(&ran.stdout).unwrap();
    assert_eq!(value["workspaceRoot"], "..");
    assert_eq!(value["configPath"], "../.sigil/config.json");
}
