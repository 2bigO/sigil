#![cfg(unix)]
//! The `init` command beyond the recorded cases: the files it writes, what it
//! refuses to touch, markdown, and that its output is a loadable workspace.
mod support;

use sigil_core::language::{glossary::parse_glossary, workspace::Workspace};
use support::{Temp, replay};

const SEED_NAMES: [&str; 8] = [
    "Decision:",
    "Scope:",
    "Assumptions:",
    "Trade-offs:",
    "Design issues addressed:",
    "Discarded alternatives:",
    "Consequences:",
    "Revisit when:",
];

const DEFAULT_CONFIG: &str = r#"{
  "sigilVersion": "0.9.0",
  "workspace": {
    "name": "my-project",
    "members": []
  },
  "files": {
    "include": [
      "**/*.sigil"
    ],
    "exclude": [
      ".git/**",
      ".deno/**",
      "node_modules/**",
      "build/**",
      "coverage/**"
    ]
  },
  "tools": {}
}
"#;

/// The seed glossary exactly as the TypeScript command line recorded it.
fn recorded_glossary() -> String {
    let case = replay::load()
        .into_iter()
        .find(|case| case.name == "init-defaults-text")
        .expect("the recording has init-defaults-text");
    case.files_after["project/.sigil/glossary.json"].clone()
}

fn project() -> Temp {
    let temp = Temp::new();
    temp.mkdir("my-project");
    temp
}

#[test]
fn a_new_directory_gets_the_config_and_the_seed_glossary() {
    let temp = project();
    let ran = temp.sigil(&["init", "my-project"]);
    assert_eq!(ran.code, 0, "{ran:?}");
    assert_eq!(
        ran.stdout,
        "Created my-project/.sigil/config.json\nWorkspace my-project on Sigil 0.9.0\n"
    );
    assert_eq!(ran.stderr, "");
    let files = temp.files();
    assert_eq!(files["my-project/.sigil/config.json"], DEFAULT_CONFIG);
    assert_eq!(
        files["my-project/.sigil/glossary.json"],
        recorded_glossary()
    );
    assert_eq!(files.len(), 2);
}

#[test]
fn the_seed_glossary_has_the_eight_terms_hidden_from_agent_context() {
    let temp = project();
    temp.sigil(&["init", "my-project"]);
    let text = std::fs::read(temp.path("my-project/.sigil/glossary.json")).unwrap();
    let parsed = parse_glossary(&text, ".sigil/glossary.json");
    assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
    let glossary = parsed.glossary.expect("the seed glossary parses");
    let names: Vec<&str> = glossary.terms.iter().map(|t| t.term.as_str()).collect();
    assert_eq!(names, SEED_NAMES);
    assert!(glossary.terms.iter().all(|term| !term.agent_context));
    assert!(glossary.contexts.is_empty());
}

#[test]
fn an_existing_config_is_refused_and_nothing_changes() {
    for existing in [
        r#"{"sigilVersion":"0.9.0","workspace":{"name":"kept","members":[]},"files":{"include":["**/*.sigil"]},"tools":{}}"#,
        "{",
    ] {
        let temp = project();
        temp.write("my-project/.sigil/config.json", existing);
        let before = temp.files();
        let ran = temp.sigil(&["init", "my-project", "--name", "other"]);
        assert_eq!(ran.code, 1, "{ran:?}");
        assert_eq!(
            ran.stdout,
            format!(
                "error SIGIL_CONFIG_EXISTS: Refusing to overwrite existing {}/my-project/.sigil/config.json.\n",
                temp.text()
            )
        );
        assert_eq!(ran.stderr, "");
        assert_eq!(temp.files(), before);
    }
}

#[test]
fn an_existing_glossary_is_kept_while_the_config_is_written() {
    let temp = project();
    let glossary = "{\"schemaVersion\":1,\"terms\":[],\"contexts\":[]}";
    temp.write("my-project/.sigil/glossary.json", glossary);
    let ran = temp.sigil(&["init", "my-project"]);
    assert_eq!(ran.code, 0, "{ran:?}");
    let files = temp.files();
    assert_eq!(files["my-project/.sigil/glossary.json"], glossary);
    assert_eq!(files["my-project/.sigil/config.json"], DEFAULT_CONFIG);
}

#[test]
fn name_include_and_exclude_appear_in_the_config() {
    let temp = project();
    let ran = temp.sigil(&[
        "init",
        "my-project",
        "--name",
        "  Named  ",
        "--include",
        "docs/**/*.sigil",
        "--include",
        "design/**/*.sigil",
        "--exclude",
        "vendor/**",
        "--exclude",
        "tmp/**",
        "--quiet",
    ]);
    assert_eq!(ran.code, 0, "{ran:?}");
    assert_eq!(ran.stdout, "");
    let config: serde_json::Value =
        serde_json::from_str(&temp.files()["my-project/.sigil/config.json"]).unwrap();
    assert_eq!(config["workspace"]["name"], "Named");
    assert_eq!(
        config["files"]["include"],
        serde_json::json!(["docs/**/*.sigil", "design/**/*.sigil"])
    );
    assert_eq!(
        config["files"]["exclude"],
        serde_json::json!(["vendor/**", "tmp/**"])
    );
}

#[test]
fn the_directory_base_name_is_the_default_workspace_name() {
    let temp = project();
    assert_eq!(temp.sigil(&["init", "my-project/"]).code, 0);
    let config: serde_json::Value =
        serde_json::from_str(&temp.files()["my-project/.sigil/config.json"]).unwrap();
    assert_eq!(config["workspace"]["name"], "my-project");
}

#[test]
fn a_blank_name_falls_back_to_the_base_name() {
    let temp = project();
    assert_eq!(temp.sigil(&["init", "my-project", "--name", " "]).code, 0);
    let config: serde_json::Value =
        serde_json::from_str(&temp.files()["my-project/.sigil/config.json"]).unwrap();
    assert_eq!(config["workspace"]["name"], "my-project");
}

#[test]
fn root_and_a_second_path_are_usage_errors() {
    let temp = project();
    for args in [
        vec!["init", "--root", "my-project"],
        vec!["init", "my-project", "second"],
    ] {
        let ran = temp.sigil(&args);
        assert_eq!(ran.code, 2, "{args:?}: {ran:?}");
        assert_eq!(ran.stdout, "");
        assert!(ran.stderr.starts_with("Error: "), "{}", ran.stderr);
    }
    assert!(temp.files().is_empty());
}

#[test]
fn markdown_names_the_config_and_the_glossary() {
    let temp = project();
    let ran = temp.sigil(&["init", "my-project", "--format", "markdown"]);
    assert_eq!(ran.code, 0, "{ran:?}");
    assert_eq!(
        ran.stdout,
        "# Sigil init\n\
         \n\
         - Config: my-project/.sigil/config.json\n\
         - Workspace: my-project\n\
         - Sigil version: 0.9.0\n\
         - Glossary: created my-project/.sigil/glossary.json\n"
    );
}

#[test]
fn markdown_says_when_the_glossary_was_kept() {
    let temp = project();
    temp.write("my-project/.sigil/glossary.json", "{\"schemaVersion\":1}");
    let ran = temp.sigil(&["init", "my-project", "--format", "markdown"]);
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(
        ran.stdout
            .contains("- Glossary: kept existing my-project/.sigil/glossary.json\n"),
        "{}",
        ran.stdout
    );
}

#[test]
fn markdown_refusal_lists_the_diagnostic() {
    let temp = project();
    temp.write("my-project/.sigil/config.json", "{");
    let ran = temp.sigil(&["init", "my-project", "--format", "markdown"]);
    assert_eq!(ran.code, 1, "{ran:?}");
    assert_eq!(
        ran.stdout,
        format!(
            "# Sigil init\n\
             \n\
             - Config: my-project/.sigil/config.json\n\
             \n\
             ## Diagnostics\n\
             \n\
             - error SIGIL_CONFIG_EXISTS: Refusing to overwrite existing {}/my-project/.sigil/config.json.\n",
            temp.text()
        )
    );
}

#[test]
fn markdown_carries_the_facts_of_the_text_output() {
    let text = project();
    let markdown = project();
    let in_text = text
        .sigil(&["init", "my-project", "--name", "facts"])
        .stdout;
    let in_markdown = markdown
        .sigil(&[
            "init",
            "my-project",
            "--name",
            "facts",
            "--format",
            "markdown",
        ])
        .stdout;
    assert!(in_text.contains("Created my-project/.sigil/config.json"));
    assert!(in_markdown.contains("my-project/.sigil/config.json"));
    assert!(in_text.contains("Workspace facts on Sigil 0.9.0"));
    assert!(in_markdown.contains("- Workspace: facts"));
    assert!(in_markdown.contains("- Sigil version: 0.9.0"));
}

#[test]
fn the_written_workspace_loads_without_diagnostics() {
    let temp = project();
    assert_eq!(temp.sigil(&["init", "my-project"]).code, 0);
    let workspace = Workspace::load(&temp.path("my-project")).unwrap();
    assert!(
        workspace.diagnostics.is_empty(),
        "{:?}",
        workspace.diagnostics
    );
    let config = workspace.config.expect("the config loads");
    assert_eq!(config.workspace_name, "my-project");
    let glossary = workspace.glossary.expect("the glossary loads");
    assert_eq!(glossary.terms.len(), 8);
}

#[test]
fn the_working_directory_is_initialized_when_no_path_is_given() {
    let temp = project();
    let ran = support::run(&temp.path("my-project"), &["init", "--format", "json"]);
    assert_eq!(ran.code, 0, "{ran:?}");
    let value: serde_json::Value = serde_json::from_str(&ran.stdout).unwrap();
    assert_eq!(value["workspaceRoot"], ".");
    assert_eq!(value["configPath"], ".sigil/config.json");
    assert_eq!(value["workspaceName"], "my-project");
    assert!(temp.path("my-project/.sigil/config.json").is_file());
}
