#![cfg(unix)]
//! Replay of the sessions recorded from the TypeScript server against the Rust
//! server, and the tests of each normalization the replay applies.
mod support;

use serde_json::{Value, json};
use support::replay::{
    KNOWN_DIFFERENCES, Wording, known_view, load, replay_features, rootless_overlap_uri,
    server_info_version, substitute, watch_registration,
};

fn check(features: &[&str], scenarios: usize, compared: usize) {
    let tally = replay_features(features);
    eprintln!(
        "replay {features:?}: {} scenarios, {} steps, {} compared, {} failures",
        tally.scenarios,
        tally.steps,
        tally.compared,
        tally.failures.len()
    );
    assert!(
        tally.scenarios >= scenarios && tally.compared >= compared,
        "replay of {features:?} covered {} scenarios and {} steps, expected at least {scenarios} and {compared}",
        tally.scenarios,
        tally.compared
    );
    assert!(
        tally.failures.is_empty(),
        "{} steps differ from the recording\n\n{}",
        tally.failures.len(),
        tally.failures.join("\n\n")
    );
}

#[test]
fn the_recording_keeps_its_size() {
    let fixture = load();
    let steps: usize = fixture.scenarios.iter().map(|s| s.steps.len()).sum();
    assert!(
        fixture.scenarios.len() >= 65,
        "{} scenarios",
        fixture.scenarios.len()
    );
    assert!(steps >= 650, "{steps} steps");
}

#[test]
fn replay_lifecycle_and_errors() {
    check(&["lifecycle", "errors"], 11, 75);
}

#[test]
fn replay_diagnostics() {
    check(&["diagnostics"], 14, 85);
}

#[test]
fn replay_watch_and_glossary_and_bom() {
    check(&["watch", "glossary", "bom"], 20, 125);
}

#[test]
fn replay_every_scenario() {
    check(&[], 65, 380);
}

#[test]
fn every_known_difference_names_a_recorded_scenario() {
    let fixture = load();
    for (name, _, reason) in KNOWN_DIFFERENCES {
        assert!(fixture.scenarios.iter().any(|s| s.name == *name), "{name}");
        assert!(!reason.is_empty(), "{name} has no reason");
    }
}

#[test]
fn the_root_is_percent_encoded_in_a_uri_and_raw_elsewhere() {
    let value = json!({"uri": "file://<ROOT>/a.sigil", "path": "<ROOT>/a.sigil"});
    let found = substitute(&value, "/tmp/with space");
    assert_eq!(found["uri"], "file:///tmp/with%20space/a.sigil");
    assert_eq!(found["path"], "/tmp/with space/a.sigil");
}

#[test]
fn the_server_version_normalization_touches_only_server_info() {
    let mut message = json!({"result": {"serverInfo": {"name": "sigil-lsp", "version": "0.0.1"}, "version": "0.0.1"}});
    server_info_version(&mut message);
    assert_eq!(
        message["result"]["serverInfo"]["version"],
        env!("CARGO_PKG_VERSION")
    );
    assert_eq!(message["result"]["serverInfo"]["name"], "sigil-lsp");
    assert_eq!(message["result"]["version"], "0.0.1");
}

#[test]
fn the_watch_normalization_renames_the_id_and_keeps_one_registration() {
    let mut request = json!({
        "jsonrpc": "2.0",
        "id": "sigil/ownership-watch/request",
        "method": "client/registerCapability",
        "params": {"registrations": [
            {"id": "sigil/ownership-watch", "method": "workspace/didChangeWatchedFiles"},
            {"id": "sigil/language-watch", "method": "workspace/didChangeWatchedFiles"},
        ]},
    });
    watch_registration(&mut request);
    assert_eq!(request["id"], "sigil/watch/request");
    let kept = request["params"]["registrations"].as_array().unwrap();
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0]["id"], "sigil/language-watch");

    let mut reply =
        json!({"jsonrpc": "2.0", "id": "sigil/ownership-watch/request", "result": null});
    watch_registration(&mut reply);
    assert_eq!(reply["id"], "sigil/watch/request");

    let mut other = json!({"jsonrpc": "2.0", "id": "sigil/other", "result": {"ok": true}});
    let before = other.clone();
    watch_registration(&mut other);
    assert_eq!(other, before);
}

#[test]
fn the_overlap_normalization_rewrites_one_scenario_and_one_uri() {
    let publication = |uri: &str| -> Value {
        json!({"method": "textDocument/publishDiagnostics", "params": {"uri": uri, "diagnostics": []}})
    };
    let mut message = publication("file:///contract.sigil");
    rootless_overlap_uri("glossary-context-overlap", &mut message, "/tmp/root");
    assert_eq!(message["params"]["uri"], "file:///tmp/root/contract.sigil");

    let mut other_scenario = publication("file:///contract.sigil");
    rootless_overlap_uri(
        "diagnostics-empty-workspace",
        &mut other_scenario,
        "/tmp/root",
    );
    assert_eq!(other_scenario["params"]["uri"], "file:///contract.sigil");

    let mut other_uri = publication("file:///tmp/root/other.sigil");
    rootless_overlap_uri("glossary-context-overlap", &mut other_uri, "/tmp/root");
    assert_eq!(other_uri["params"]["uri"], "file:///tmp/root/other.sigil");
}

#[test]
fn the_json_wording_view_keeps_the_head_of_the_message() {
    let recorded = "Unable to parse .sigil/config.json JSON: Expected property name or '}' in JSON at position 1";
    let own =
        "Unable to parse .sigil/config.json JSON: EOF while parsing an object at line 1 column 1";
    let view = |text| known_view(Wording::JsonParseDetail, text, "/tmp/root");
    assert_eq!(view(recorded), "Unable to parse .sigil/config.json JSON:");
    assert_eq!(view(recorded), view(own));
    // A different file or subject is still a difference.
    assert_ne!(
        view(recorded),
        view("Unable to parse .sigil/glossary.json JSON: x")
    );
    assert_eq!(
        view("Source is not valid UTF-8."),
        "Source is not valid UTF-8."
    );
}

#[test]
fn the_path_wording_view_drops_only_the_root_after_source() {
    let view = |text| known_view(Wording::AbsolutePathInMessage, text, "/tmp/root");
    assert_eq!(
        view("Source /tmp/root/a.sigil does not supply an unambiguous component Thing."),
        "Source a.sigil does not supply an unambiguous component Thing."
    );
    assert_eq!(
        view("Source a.sigil does not supply an unambiguous component Thing."),
        "Source a.sigil does not supply an unambiguous component Thing."
    );
    assert_eq!(view("Import /tmp/root/a.sigil"), "Import /tmp/root/a.sigil");
}
