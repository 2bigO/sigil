#![cfg(unix)]
//! The `glossary` command beyond the recorded cases: absent glossary, an
//! unrelated error beside a valid glossary, and the markdown output.
mod support;

use serde_json::Value;
use support::Temp;

const GLOSSARY: &str = "{\"schemaVersion\":1,\"terms\":[{\"term\":\"hold\",\"definition\":\"Capacity kept before confirmation.\"}],\"contexts\":[]}";

const BASE: &str = "component Base {\n  goal {\n    Ship it.\n  }\n  interface {\n    value {\n      A value.\n    }\n  }\n}\n";

const BOOKING: &str = "component Booking {\n  goal {\n    Keep a hold.\n  }\n  interface {\n    Hold {\n      A hold is visible.\n    }\n  }\n}\n";

/// Imports a Tag that does not exist: an error unrelated to the glossary.
const BROKEN: &str = "@base.sigil from Base import { value, missing }\ncomponent Broken {\n  goal {\n    Ship it.\n  }\n  interface {\n    Use value.\n  }\n}\n";

fn json(temp: &Temp) -> (i32, Value) {
    let ran = temp.sigil(&["glossary", "--format", "json"]);
    assert_eq!(ran.stderr, "");
    (ran.code, serde_json::from_str(&ran.stdout).expect("JSON"))
}

#[test]
fn no_glossary_file_prints_absent_and_exits_zero() {
    let temp = Temp::workspace();
    temp.write("booking.sigil", BOOKING);
    let ran = temp.sigil(&["glossary"]);
    assert_eq!(ran.code, 0);
    assert_eq!(
        ran.stdout,
        "Workspace root: .\nGlossary: absent\nSchema version: none\nTerms: 0\nContexts: 0\nOccurrences: 0\n"
    );
    let (code, value) = json(&temp);
    assert_eq!(code, 0);
    assert_eq!(value["glossaryPath"], Value::Null);
    assert_eq!(value["schemaVersion"], Value::Null);
}

#[test]
fn a_valid_glossary_with_an_unrelated_error_reports_it_and_exits_one() {
    let temp = Temp::workspace();
    temp.write(".sigil/glossary.json", GLOSSARY);
    temp.write("base.sigil", BASE);
    temp.write("booking.sigil", BOOKING);
    temp.write("a.sigil", BROKEN);
    let (code, value) = json(&temp);
    assert_eq!(code, 1);
    assert_eq!(value["schemaVersion"], 1);
    assert_eq!(value["glossaryPath"], ".sigil/glossary.json");
    assert_eq!(value["occurrences"].as_array().unwrap().len(), 2);
    assert_eq!(
        value["diagnostics"][0]["code"],
        "SIGIL_UNRESOLVED_IMPORTED_TAG"
    );
    let text = temp.sigil(&["glossary"]);
    assert_eq!(text.code, 1);
    assert!(
        text.stdout
            .lines()
            .last()
            .unwrap()
            .starts_with("error SIGIL_UNRESOLVED_IMPORTED_TAG: ")
    );
}

#[test]
fn occurrences_carry_character_locations() {
    let temp = Temp::workspace();
    temp.write(".sigil/glossary.json", GLOSSARY);
    temp.write(
        "booking.sigil",
        "component Booking {\n  goal {\n    \u{1F600} Keep a hold.\n  }\n  interface {\n    Hold {\n      A thing.\n    }\n  }\n}\n",
    );
    let (_, value) = json(&temp);
    assert_eq!(
        value["occurrences"][0]["sourceLocation"],
        serde_json::json!({"line": 3, "column": 14})
    );
    let text = temp.sigil(&["glossary"]);
    assert!(text.stdout.contains("booking.sigil:3:14 hold -> hold\n"));
}

#[test]
fn an_invalid_glossary_exits_one_and_keeps_its_path() {
    let temp = Temp::workspace();
    temp.write(".sigil/glossary.json", "{");
    let (code, value) = json(&temp);
    assert_eq!(code, 1);
    assert_eq!(value["glossaryPath"], ".sigil/glossary.json");
    assert_eq!(value["schemaVersion"], Value::Null);
}

#[test]
fn markdown_for_an_absent_glossary() {
    let temp = Temp::workspace();
    let ran = temp.sigil(&["glossary", "--format", "markdown"]);
    assert_eq!(ran.code, 0);
    assert_eq!(
        ran.stdout,
        "# Sigil glossary\n\n- Workspace root: .\n- Glossary: absent\n- Schema version: none\n- Terms: 0\n- Contexts: 0\n- Occurrences: 0\n\n## Occurrences\n\nNone.\n\n## Diagnostics\n\nNone.\n"
    );
}

#[test]
fn markdown_lists_the_occurrences_and_diagnostics_the_text_does() {
    let temp = Temp::workspace();
    temp.write(".sigil/glossary.json", GLOSSARY);
    temp.write("base.sigil", BASE);
    temp.write("booking.sigil", BOOKING);
    temp.write("a.sigil", BROKEN);
    let ran = temp.sigil(&["glossary", "--format", "markdown"]);
    assert_eq!(ran.code, 1);
    assert_eq!(
        ran.stdout,
        "# Sigil glossary\n\n- Workspace root: .\n- Glossary: .sigil/glossary.json\n- Schema version: 1\n- Terms: 1\n- Contexts: 0\n- Occurrences: 2\n\n## Occurrences\n\n\
         - booking.sigil:3:12 hold -> hold\n\
         - booking.sigil:7:9 hold -> hold\n\n\
         ## Diagnostics\n\n\
         - error SIGIL_UNRESOLVED_IMPORTED_TAG: Component Base does not own an unambiguous Tag \"missing\".\n"
    );
}

#[test]
fn a_missing_config_reports_the_recorded_code() {
    let temp = Temp::new();
    let ran = temp.sigil(&["glossary"]);
    assert_eq!(ran.code, 1);
    assert!(ran.stdout.contains("Glossary: absent\n"));
    assert!(ran.stdout.contains("error SIGIL_CONFIG_NOT_FOUND: "));
}
