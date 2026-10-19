//! `graph`, `context`, `retrieve` and `render` are invalid usage, and the
//! workspace is never read for them. These run on every platform.
mod support;

use support::{CONFIG, Temp};

const REMOVED: [&str; 4] = ["graph", "context", "retrieve", "render"];

const ARGUMENTS: [&[&str]; 7] = [
    &[],
    &["--help"],
    &["some/path"],
    &["--format", "json"],
    &["--component", "Example"],
    &["--file", "a.sigil", "--purpose", "semantic"],
    &["--root", "."],
];

fn check_refused(temp: &Temp, label: &str) {
    for command in REMOVED {
        for extra in ARGUMENTS {
            let mut args = vec![command];
            args.extend_from_slice(extra);
            let ran = temp.sigil(&args);
            assert_eq!(ran.code, 2, "{label}: {args:?}");
            assert_eq!(ran.stdout, "", "{label}: {args:?}");
            assert!(
                ran.stderr.starts_with(&format!(
                    "Error: Unknown command \"{command}\".\n\nUsage: sigil <command> [options]\n"
                )),
                "{label}: {args:?}: {}",
                ran.stderr
            );
        }
    }
}

#[test]
fn removed_commands_are_refused_where_no_config_exists() {
    check_refused(&Temp::new(), "no config");
}

#[test]
fn removed_commands_are_refused_in_a_valid_workspace() {
    let temp = Temp::workspace();
    temp.write("main.sigil", "component A {\n  goal {\n    Do.\n  }\n}\n");
    check_refused(&temp, "valid config");
}

#[test]
fn removed_commands_do_not_read_a_broken_config() {
    // A directory where the config file should be is not a config at all.
    let temp = Temp::new();
    temp.mkdir(".sigil/config.json");
    check_refused(&temp, "config is a directory");

    let broken = Temp::new();
    broken.write(".sigil/config.json", "{");
    check_refused(&broken, "invalid config");
}

#[cfg(unix)]
#[test]
fn removed_commands_do_not_read_an_unreadable_config() {
    use std::os::unix::fs::PermissionsExt;
    let temp = Temp::workspace();
    let config = temp.path(".sigil/config.json");
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o000)).unwrap();
    // A command that reads the workspace fails at runtime, unless the process
    // may read any file; the removed commands are refused either way.
    let reads = std::fs::read(&config).is_ok();
    let ran = temp.sigil(&["version"]);
    if !reads {
        assert_eq!(ran.code, 3, "{}", ran.stderr);
        assert_eq!(ran.stdout, "");
    }
    check_refused(&temp, "unreadable config");
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o644)).unwrap();
}

#[test]
fn removed_commands_leave_the_workspace_untouched() {
    let temp = Temp::workspace();
    let before = temp.files();
    check_refused(&temp, "valid config");
    assert_eq!(temp.files(), before);
    assert_eq!(before[".sigil/config.json"], CONFIG);
}

#[test]
fn removed_commands_never_appear_in_help() {
    let temp = Temp::new();
    let ran = temp.sigil(&["--help"]);
    for command in REMOVED {
        assert!(
            !ran.stdout
                .lines()
                .any(|line| line.trim_start().starts_with(command)),
            "{command} in help"
        );
    }
}
