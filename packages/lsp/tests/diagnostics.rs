#![cfg(unix)]
//! What the server publishes for a snapshot: the shape of each diagnostic, its
//! positions, and when a URI is published or cleared.
mod support;

use serde_json::{Value, json};
use support::{
    BROKEN, CLEAN, CONSUMER, Client, PROVIDER_WITHOUT_TAG, Temp, published, published_for,
    workspace_with,
};

fn codes(diagnostics: &[Value]) -> Vec<String> {
    diagnostics
        .iter()
        .map(|d| d["code"].as_str().unwrap().to_owned())
        .collect()
}

fn component(name: &str) -> String {
    format!(
        "component {name} {{\n  goal {{\n    Do the Shared work.\n  }}\n\n  interface {{\n    Shared {{\n      run() starts a Shared.\n    }}\n  }}\n}}\n"
    )
}

#[test]
fn an_unknown_tag_in_a_buffer_is_published_fixed_by_a_change_and_back_on_close() {
    // The consumer imports a Tag that the provider on disk does not define.
    let temp = workspace_with(&[
        ("contract.sigil", PROVIDER_WITHOUT_TAG),
        ("consumer.sigil", CONSUMER),
    ]);
    let mut client = Client::at(&temp.root);
    let provider = temp.uri("contract.sigil");
    let consumer = temp.uri("consumer.sigil");
    let started = client.start(&temp);
    let unresolved = || vec!["SIGIL_UNRESOLVED_IMPORTED_TAG".to_owned()];
    let errors = |found: Vec<Value>| -> Vec<String> {
        codes(&found)
            .into_iter()
            .filter(|c| c != "SIGIL_UNTAGGED_FACET")
            .collect()
    };
    assert_eq!(
        errors(published_for(&started, &consumer).unwrap()),
        unresolved()
    );

    // The buffer defines the Tag: the consumer's error is cleared.
    let out = client.open(&provider, 1, CLEAN);
    assert_eq!(
        errors(published_for(&out, &consumer).unwrap()),
        Vec::<String>::new()
    );
    let out = client.change(&provider, 2, &[PROVIDER_WITHOUT_TAG]);
    assert_eq!(
        errors(published_for(&out, &consumer).unwrap()),
        unresolved()
    );
    let out = client.change(&provider, 3, &[CLEAN]);
    assert_eq!(
        errors(published_for(&out, &consumer).unwrap()),
        Vec::<String>::new()
    );
    // Closing the buffer over the file that is still without the Tag brings
    // the disk diagnostics back.
    let out = client.close(&provider);
    assert_eq!(
        errors(published_for(&out, &consumer).unwrap()),
        unresolved()
    );
}

#[test]
fn a_diagnostic_carries_its_code_severity_message_range_and_data() {
    let temp = workspace_with(&[("a.sigil", BROKEN)]);
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let found = published_for(&out, &temp.uri("a.sigil")).unwrap();
    assert_eq!(
        codes(&found),
        [
            "SIGIL_MISSING_GOAL",
            "SIGIL_MISSING_INTERFACE",
            "SIGIL_UNKNOWN_SECTION"
        ]
    );
    let unknown = &found[2];
    assert_eq!(unknown["severity"], 1);
    assert_eq!(unknown["source"], "sigil");
    assert_eq!(unknown["message"], "Unknown contract \"mystery\".");
    assert_eq!(unknown["relatedInformation"], json!([]));
    let start = BROKEN.find("mystery").unwrap();
    assert_eq!(
        unknown["data"],
        json!({
            "stage": "parsing",
            "originalRange": {"start": start, "end": start + "mystery".len()},
            "coordinateSystem": "utf8-bytes",
            "locationAvailable": true,
            "related": [],
        })
    );
    assert_eq!(
        unknown["range"],
        json!({"start": {"line": 1, "character": 2}, "end": {"line": 1, "character": 9}})
    );
}

#[test]
fn severity_maps_error_to_one_and_warning_to_two() {
    let temp = workspace_with(&[("a.sigil", BROKEN)]);
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let found = published_for(&out, &temp.uri("a.sigil")).unwrap();
    assert!(found.iter().all(|d| d["severity"] == 1));
    let untagged = component("A").replace("run() starts a Shared.", "Do work.");
    let warned = workspace_with(&[("a.sigil", &untagged)]);
    let mut client = Client::at(&warned.root);
    let out = client.start(&warned);
    let found = published_for(&out, &warned.uri("a.sigil")).unwrap();
    assert_eq!(codes(&found), ["SIGIL_UNTAGGED_FACET"]);
    assert_eq!(found[0]["severity"], 2);
}

#[test]
fn a_collision_across_files_points_at_the_other_files_absolute_location() {
    let temp = workspace_with(&[("a.sigil", &component("A")), ("b.sigil", &component("A"))]);
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let a = published_for(&out, &temp.uri("a.sigil")).unwrap();
    let duplicate = a
        .iter()
        .find(|d| d["code"] == "SIGIL_DUPLICATE_COMPONENT")
        .unwrap();
    let related = &duplicate["relatedInformation"][0];
    assert_eq!(related["location"]["uri"], temp.uri("b.sigil"));
    assert_eq!(related["message"], duplicate["message"]);
    assert_eq!(
        duplicate["data"]["related"],
        json!([{
            "filePath": temp.path("b.sigil").to_string_lossy(),
            "range": {"start": 10, "end": 11},
        }])
    );
    assert_eq!(
        duplicate["data"]["originalRange"],
        json!({"start": 10, "end": 11})
    );
    assert_eq!(duplicate["data"]["stage"], "resolution");
}

#[test]
fn a_diagnostic_that_has_no_place_in_a_character_is_published_at_the_zero_range() {
    let temp = Temp::workspace();
    // A file that is not UTF-8 has no captured text, so no position exists.
    temp.write_bytes("bad.sigil", b"component \xff {}\n");
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let found = published_for(&out, &temp.uri("bad.sigil")).unwrap();
    assert_eq!(found[0]["code"], "SIGIL_INVALID_ENCODING");
    assert_eq!(
        found[0]["range"],
        json!({"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 0}})
    );
    assert_eq!(found[0]["data"]["locationAvailable"], false);
    assert_eq!(
        found[0]["data"]["originalRange"],
        json!({"start": 10, "end": 11})
    );
}

#[test]
fn a_diagnostic_without_a_range_is_published_at_the_zero_range_and_available() {
    let temp = Temp::new();
    temp.write("a.sigil", CLEAN);
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let found = published_for(&out, &temp.uri(".sigil/config.json")).unwrap();
    assert_eq!(found[0]["data"]["locationAvailable"], true);
    assert_eq!(
        found[0]["range"]["start"],
        json!({"line": 0, "character": 0})
    );
    assert!(found[0]["data"].get("originalRange").is_none());
}

#[test]
fn files_are_published_in_uri_order_and_a_cleared_file_is_republished_once() {
    let temp = workspace_with(&[
        ("b.sigil", BROKEN),
        ("a.sigil", BROKEN),
        ("c/z.sigil", BROKEN),
    ]);
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let uris: Vec<String> = published(&out).into_iter().map(|(uri, _)| uri).collect();
    assert_eq!(
        uris,
        vec![
            temp.uri("a.sigil"),
            temp.uri("b.sigil"),
            temp.uri("c/z.sigil")
        ]
    );
    // Fix one on disk: it is published empty once, then no longer.
    temp.write("b.sigil", &component("Fixed"));
    let out = client.watched(&[temp.uri("b.sigil")]);
    let after: Vec<(String, usize)> = published(&out)
        .into_iter()
        .map(|(uri, found)| (uri, found.len()))
        .collect();
    assert!(after.contains(&(temp.uri("b.sigil"), 0)), "{after:?}");
    let out = client.watched(&[temp.uri("b.sigil")]);
    assert!(published_for(&out, &temp.uri("b.sigil")).is_none());
}

#[test]
fn an_open_buffer_is_always_published_even_when_it_has_no_diagnostics() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let uri = temp.uri("a.sigil");
    let out = client.open(&uri, 1, CLEAN);
    assert_eq!(published_for(&out, &uri), Some(Vec::new()));
    let out = client.change(&uri, 2, &[CLEAN]);
    assert_eq!(published_for(&out, &uri), Some(Vec::new()));
}

#[test]
fn a_disk_byte_order_mark_is_hidden_and_a_buffer_is_counted_as_sent() {
    // An emoji before a diagnostic on line 0: two UTF-16 units.
    let text = "component Thing {} \u{1f600} \u{0} \n";
    let temp = Temp::workspace();
    temp.write("a.sigil", &format!("\u{feff}{text}"));
    let mut client = Client::at(&temp.root);
    let uri = temp.uri("a.sigil");
    let out = client.start(&temp);
    let on_line_zero = |found: &[Value]| -> Value {
        found
            .iter()
            .find(|d| d["code"] == "SIGIL_INVALID_CHARACTER")
            .unwrap()["range"]["start"]
            .clone()
    };
    let disk = on_line_zero(&published_for(&out, &uri).unwrap());
    // `component Thing {} ` is 19 units, the emoji 2, the space 1.
    assert_eq!(disk, json!({"line": 0, "character": 22}));

    // The same text as the editor shows it, without the mark.
    let out = client.open(&uri, 1, text);
    assert_eq!(on_line_zero(&published_for(&out, &uri).unwrap()), disk);
    // A buffer that does carry the mark is counted as it is: one more.
    let out = client.change(&uri, 2, &[&format!("\u{feff}{text}")]);
    assert_eq!(
        on_line_zero(&published_for(&out, &uri).unwrap()),
        json!({"line": 0, "character": 23})
    );
}

#[test]
fn a_byte_order_mark_does_not_move_later_lines() {
    let text = "component Thing {}\n\u{1f600}\u{0}\n";
    let temp = Temp::workspace();
    temp.write("a.sigil", &format!("\u{feff}{text}"));
    let mut client = Client::at(&temp.root);
    let uri = temp.uri("a.sigil");
    let out = client.start(&temp);
    let found = published_for(&out, &uri).unwrap();
    let nul = found
        .iter()
        .find(|d| d["code"] == "SIGIL_INVALID_CHARACTER")
        .unwrap();
    assert_eq!(nul["range"]["start"], json!({"line": 1, "character": 2}));
    let snapshot = client.server.snapshot().unwrap();
    assert!(snapshot.from_disk("a.sigil"));
}

#[test]
fn a_diagnostic_inside_a_hidden_mark_has_no_position() {
    let temp = Temp::workspace();
    // An invalid encoding right at the start leaves the mark with no text.
    temp.write("a.sigil", "\u{feff}\u{0}component Thing {}\n");
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let found = published_for(&out, &temp.uri("a.sigil")).unwrap();
    let nul = found
        .iter()
        .find(|d| d["code"] == "SIGIL_INVALID_CHARACTER")
        .unwrap();
    assert_eq!(nul["range"]["start"], json!({"line": 0, "character": 0}));
    assert_eq!(nul["range"]["end"], json!({"line": 0, "character": 1}));
    assert_eq!(nul["data"]["originalRange"], json!({"start": 3, "end": 4}));
}

#[test]
fn closing_through_a_notification_for_another_uri_form_reaches_the_same_buffer() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let uri = temp.uri("a.sigil");
    client.open(&uri, 1, BROKEN);
    // The same file with a redundant `./` segment.
    let alias = uri.replace("/a.sigil", "/./a.sigil");
    let out = client.close(&alias);
    assert!(published_for(&out, &alias).is_some());
    assert_eq!(published_for(&out, &uri), Some(Vec::new()));
    assert!(client.server.snapshot().unwrap().from_disk("a.sigil"));
}
