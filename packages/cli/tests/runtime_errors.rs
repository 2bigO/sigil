#![cfg(unix)]
//! Runtime failures (exit 3): one line on standard error, nothing on standard
//! output. The wording is the TypeScript command line's, so it is pinned here
//! exactly, including the operating system messages it quotes.
mod support;

use support::Temp;

#[test]
fn a_non_sigil_file_beside_a_selected_source_matches_no_source() {
    let temp = Temp::workspace();
    temp.write("selected.sigil", support::BASE_SOURCE);
    temp.write("notes.txt", "plain text\n");
    let before = temp.files();
    let notes = temp.path("notes.txt");
    let ran = temp.sigil(&["fmt", "selected.sigil", "notes.txt"]);
    assert_eq!((ran.code, ran.stdout.as_str()), (3, ""));
    assert_eq!(
        ran.stderr,
        format!("No Sigil source matched {}.\n", notes.display())
    );
    assert_eq!(temp.files(), before);
}

#[test]
fn a_non_sigil_file_as_the_first_target_cannot_start_the_workspace_search() {
    let temp = Temp::workspace();
    temp.write("notes.txt", "plain text\n");
    let ran = temp.sigil(&["fmt", "notes.txt"]);
    assert_eq!((ran.code, ran.stdout.as_str()), (3, ""));
    assert_eq!(
        ran.stderr,
        format!(
            "Not a directory (os error 20): stat '{}/notes.txt/.sigil/config.json'\n",
            temp.text()
        )
    );
}

#[test]
fn a_missing_source_to_parse_is_the_operating_system_message() {
    let temp = Temp::workspace();
    let ran = temp.sigil(&["parse", "missing.sigil"]);
    assert_eq!((ran.code, ran.stdout.as_str()), (3, ""));
    assert_eq!(
        ran.stderr,
        format!(
            "No such file or directory (os error 2): readfile '{}/missing.sigil'\n",
            temp.text()
        )
    );
}

#[test]
fn a_non_sigil_file_as_the_workspace_path_is_a_runtime_failure_for_every_command() {
    let temp = Temp::workspace();
    temp.write("notes.txt", "plain text\n");
    for command in ["check", "version", "glossary"] {
        let ran = temp.sigil(&[command, "notes.txt"]);
        assert_eq!((ran.code, ran.stdout.as_str()), (3, ""), "{command}");
        assert_eq!(
            ran.stderr,
            format!(
                "Not a directory (os error 20): stat '{}/notes.txt/.sigil/config.json'\n",
                temp.text()
            ),
            "{command}"
        );
    }
}
