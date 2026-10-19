//! Argument handling that needs no workspace: help, `--version`, usage errors
//! and the `lsp` stub. These run on every platform.
mod support;

use support::{REMOVED, Temp};

const KEPT: [&str; 6] = ["init", "version", "parse", "check", "fmt", "glossary"];

fn help_of(temp: &Temp, command: &str) -> String {
    let ran = temp.sigil(&[command, "--help"]);
    assert_eq!(ran.code, 0, "{command} --help");
    assert_eq!(ran.stderr, "");
    ran.stdout
}

#[test]
fn version_flag_prints_the_bare_cli_version() {
    let temp = Temp::new();
    let ran = temp.sigil(&["--version"]);
    assert_eq!(ran.code, 0);
    assert_eq!(ran.stdout, format!("{}\n", env!("CARGO_PKG_VERSION")));
    assert_eq!(ran.stderr, "");
}

#[test]
fn version_matches_deno_json() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("deno.json");
    let deno: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(deno["version"], env!("CARGO_PKG_VERSION"));
}

#[test]
fn version_flag_is_honored_only_as_the_first_argument() {
    let temp = Temp::new();
    let ran = temp.sigil(&["check", "--version"]);
    assert_eq!(ran.code, 2);
    assert_eq!(ran.stdout, "");
    assert!(
        ran.stderr
            .starts_with("Error: Unsupported option --version.\n\n")
    );
}

#[test]
fn root_help_lists_the_kept_commands_and_lsp_but_no_removed_one() {
    let temp = Temp::new();
    for args in [&["--help"][..], &[][..]] {
        let ran = temp.sigil(args);
        let text = if args.is_empty() {
            assert_eq!(ran.code, 2);
            assert_eq!(ran.stdout, "");
            ran.stderr
        } else {
            assert_eq!(ran.code, 0);
            assert_eq!(ran.stderr, "");
            ran.stdout
        };
        for command in KEPT.iter().chain(&["lsp"]) {
            assert!(
                text.lines()
                    .any(|line| line.trim_start().starts_with(&format!("{command} "))),
                "{command} is listed:\n{text}"
            );
        }
        for command in REMOVED {
            assert!(
                !text
                    .lines()
                    .any(|line| line.trim_start().starts_with(&format!("{command} "))),
                "{command} is not listed:\n{text}"
            );
        }
        assert!(text.contains("--version"));
    }
}

#[test]
fn no_command_is_a_usage_error_naming_the_commands() {
    let temp = Temp::new();
    let ran = temp.sigil(&[]);
    assert_eq!(ran.code, 2);
    assert_eq!(ran.stdout, "");
    assert!(
        ran.stderr
            .starts_with("Error: Expected command: init, version, parse, check, fmt, glossary, or lsp.\n\nUsage: sigil <command>")
    );
}

#[test]
fn help_after_each_kept_command_prints_that_commands_usage() {
    let temp = Temp::new();
    for command in KEPT.iter().chain(&["lsp"]) {
        let help = help_of(&temp, command);
        assert!(
            help.starts_with(&format!("Usage: sigil {command}")),
            "{help}"
        );
        assert!(help.ends_with("  --help            Show this help\n"));
    }
}

#[test]
fn help_anywhere_after_a_command_wins_over_other_errors() {
    let temp = Temp::new();
    let plain = help_of(&temp, "check");
    for args in [
        &["check", "--bogus", "--help"][..],
        &["check", "--help", "--bogus"],
        &["check", "a", "b", "--help"],
        &["check", "--root", "--help"],
        &["check", "--check", "--help"],
    ] {
        let ran = temp.sigil(args);
        assert_eq!(
            (ran.code, ran.stdout.as_str(), ran.stderr.as_str()),
            (0, plain.as_str(), ""),
            "{args:?}"
        );
    }
}

#[test]
fn a_usage_error_prints_the_error_a_blank_line_and_the_commands_usage() {
    let temp = Temp::new();
    for command in KEPT {
        let help = help_of(&temp, command);
        let ran = temp.sigil(&[command, "--bogus"]);
        assert_eq!(ran.code, 2, "{command}");
        assert_eq!(ran.stdout, "");
        assert_eq!(
            ran.stderr,
            format!("Error: Unsupported option --bogus.\n\n{help}")
        );
    }
}

#[test]
fn a_flag_value_that_starts_with_a_dash_is_not_a_value() {
    let temp = Temp::new();
    for (args, message) in [
        (
            &["check", "--root", "--pretty"][..],
            "--root requires a value.",
        ),
        (&["check", "--root", "-x"], "--root requires a value."),
        (
            &["check", "--format", "--quiet"],
            "--format requires a value.",
        ),
        (&["check", "--root"], "--root requires a value."),
        (&["init", "--name", "-x"], "--name requires a value."),
        (&["init", "--include"], "--include requires a value."),
        (&["check", "-"], "Unsupported option -."),
        (&["check", "-x"], "Unsupported option -x."),
    ] {
        let ran = temp.sigil(args);
        assert_eq!(ran.code, 2, "{args:?}");
        assert_eq!(ran.stdout, "");
        assert!(
            ran.stderr
                .starts_with(&format!("Error: {message}\n\nUsage: sigil ")),
            "{args:?}: {}",
            ran.stderr
        );
    }
}

#[test]
fn option_checks_run_before_positional_counts() {
    let temp = Temp::new();
    for (args, message) in [
        (&["parse", "--check"][..], "parse does not accept --check."),
        (
            &["parse", "--show-locations"],
            "parse does not accept --show-locations.",
        ),
        (
            &["version", "a", "b", "--check"],
            "version does not accept --check.",
        ),
        (
            &["glossary", "a", "b", "--include", "x"],
            "glossary does not accept init options.",
        ),
        (
            &["check", "a", "b", "--name", "n"],
            "check does not accept init options.",
        ),
        (
            &["fmt", "--exclude", "x"],
            "fmt does not accept init options.",
        ),
        (
            &["fmt", "--show-locations"],
            "fmt does not accept --show-locations.",
        ),
        (&["init", "--check"], "init does not accept --check."),
        (&["parse"], "parse requires exactly one file."),
        (&["parse", "a", "b"], "parse requires exactly one file."),
        (&["init", "a", "b"], "init accepts at most one path."),
        (
            &["init", "--root", "x"],
            "init uses its path argument and does not accept --root.",
        ),
        (&["check", "a", "b"], "check accepts at most one path."),
        (
            &["glossary", "a", "b"],
            "glossary accepts at most one path.",
        ),
        (&["version", "a", "b"], "version accepts at most one path."),
    ] {
        let ran = temp.sigil(args);
        assert_eq!(ran.code, 2, "{args:?}");
        assert_eq!(ran.stdout, "");
        assert!(
            ran.stderr.starts_with(&format!("Error: {message}\n\n")),
            "{args:?}: {}",
            ran.stderr
        );
    }
}

#[test]
fn format_rules_differ_between_the_generic_and_the_fmt_message() {
    let temp = Temp::new();
    let generic = temp.sigil(&["fmt", "--format", "yaml"]);
    assert!(
        generic
            .stderr
            .starts_with("Error: --format must be json, text, or markdown.\n\n")
    );
    let markdown = temp.sigil(&["fmt", "--format", "markdown"]);
    assert_eq!(markdown.code, 2);
    assert!(
        markdown
            .stderr
            .starts_with("Error: --format must be text or json for fmt.\n\n")
    );
    assert_eq!(markdown.stdout, "");
}

#[test]
fn options_of_removed_commands_are_unsupported() {
    let temp = Temp::new();
    for flag in [
        "--component",
        "--file",
        "--include-dependents",
        "--purpose",
        "--max-evidence-bytes",
        "--profile",
    ] {
        let ran = temp.sigil(&["check", flag, "x"]);
        assert_eq!(ran.code, 2, "{flag}");
        assert_eq!(ran.stdout, "");
        assert!(
            ran.stderr
                .starts_with(&format!("Error: Unsupported option {flag}.\n\n"))
        );
    }
}

#[test]
fn lsp_exits_3_with_one_line_on_stderr_and_nothing_on_stdout() {
    let temp = Temp::new();
    let ran = temp.sigil(&["lsp"]);
    assert_eq!(ran.code, 3);
    assert_eq!(ran.stdout, "");
    assert_eq!(ran.stderr.lines().count(), 1, "{}", ran.stderr);
    assert!(ran.stderr.ends_with('\n'));
}

#[test]
fn lsp_accepts_nothing_but_help() {
    let temp = Temp::new();
    for (args, message) in [
        (&["lsp", "--stdio"][..], "Unsupported option --stdio."),
        (&["lsp", "extra"], "lsp accepts no arguments."),
    ] {
        let ran = temp.sigil(args);
        assert_eq!(ran.code, 2, "{args:?}");
        assert_eq!(ran.stdout, "");
        assert!(
            ran.stderr
                .starts_with(&format!("Error: {message}\n\nUsage: sigil lsp"))
        );
    }
}

#[test]
fn an_unknown_command_is_a_usage_error_with_the_root_help() {
    let temp = Temp::new();
    let ran = temp.sigil(&["frobnicate", "--help"]);
    assert_eq!(ran.code, 2);
    assert_eq!(ran.stdout, "");
    assert!(
        ran.stderr
            .starts_with("Error: Unknown command \"frobnicate\".\n\nUsage: sigil <command>")
    );
}
