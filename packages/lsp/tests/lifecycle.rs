#![cfg(unix)]
//! Lifecycle, document synchronization, reloading and recovery: what the
//! recorded sessions cannot express, because they need a failing disk, a
//! clock, or the server's own seams.
mod support;

use serde_json::{Value, json};
use sigil_lsp::{
    rpc::classify,
    server::{Server, ServerOptions, State},
};
use std::{thread::sleep, time::Duration};
use support::{
    ALWAYS, BROKEN, CLEAN, Client, Disk, LONG_DELAY, SHORT_DELAY, Temp, id, published,
    published_for, responses, workspace_with,
};

fn error_of(response: &Value) -> (i64, String) {
    (
        response["error"]["code"].as_i64().expect("an error code"),
        response["error"]["message"].as_str().unwrap().to_owned(),
    )
}

#[test]
fn a_request_before_initialize_answers_not_initialized() {
    let temp = Temp::workspace();
    let mut client = Client::at(&temp.root);
    for method in ["shutdown", "textDocument/hover", "unknown/method"] {
        let response = client.request(method, json!({}));
        assert_eq!(
            error_of(&response),
            (-32002, "Server is not initialized.".to_owned()),
            "{method}"
        );
    }
    assert_eq!(client.server.state(), State::Uninitialized);
    // A notification before initialize changes nothing.
    assert!(client.open(&temp.uri("a.sigil"), 1, CLEAN).is_empty());
    assert!(client.server.snapshot().is_none());
}

#[test]
fn initialize_twice_is_invalid_params_and_unknown_methods_are_not_found() {
    let temp = Temp::workspace();
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let again = client.request("initialize", json!({"rootUri": temp.uri("")}));
    assert_eq!(
        error_of(&again),
        (-32602, "initialize may only be sent once.".to_owned())
    );
    let unknown = client.request("textDocument/completion", json!({}));
    assert_eq!(
        error_of(&unknown),
        (
            -32601,
            "Method not found: textDocument/completion".to_owned()
        )
    );
    assert_eq!(client.server.state(), State::Running);
}

#[test]
fn a_request_after_shutdown_answers_shutting_down() {
    let temp = Temp::workspace();
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    assert_eq!(
        client.request("shutdown", Value::Null)["result"],
        Value::Null
    );
    assert_eq!(client.server.state(), State::ShutdownRequested);
    for method in ["shutdown", "textDocument/completion", "initialize"] {
        let response = client.request(method, json!({}));
        assert_eq!(
            error_of(&response),
            (-32600, "Server is shutting down.".to_owned()),
            "{method}"
        );
    }
    // A notification after shutdown is ignored.
    assert!(client.open(&temp.uri("a.sigil"), 1, CLEAN).is_empty());
    assert!(
        client
            .server
            .snapshot()
            .unwrap()
            .file_index("a.sigil")
            .is_none()
    );
}

#[test]
fn initialize_advertises_exactly_what_the_contract_names() {
    let temp = Temp::workspace();
    let mut client = Client::at(&temp.root);
    let response = client.request("initialize", json!({"rootUri": temp.uri("")}));
    assert_eq!(
        response["result"],
        json!({
            "capabilities": {
                "positionEncoding": "utf-16",
                "textDocumentSync": {"openClose": true, "change": 1},
                "definitionProvider": true,
                "documentSymbolProvider": true,
                "hoverProvider": true,
                "semanticTokensProvider": {
                    "legend": {"tokenTypes": ["type", "tag", "term"], "tokenModifiers": []},
                    "full": true,
                },
                "executeCommandProvider": {"commands": ["sigil.renderDocument"]},
            },
            "serverInfo": {"name": "sigil-lsp", "version": env!("CARGO_PKG_VERSION")},
        })
    );
}

fn dynamic_registration_params(temp: &Temp, declared: Option<bool>) -> Value {
    match declared {
        Some(flag) => json!({
            "rootUri": temp.uri(""),
            "capabilities": {"workspace": {"didChangeWatchedFiles": {"dynamicRegistration": flag}}},
        }),
        None => json!({"rootUri": temp.uri("")}),
    }
}

#[test]
fn initialized_sends_one_watch_request_only_to_a_client_that_can_register() {
    let temp = Temp::workspace();
    let mut client = Client::at(&temp.root);
    let out = client.start_with(dynamic_registration_params(&temp, Some(true)));
    let requests = responses(&out);
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0],
        json!({
            "jsonrpc": "2.0",
            "id": "sigil/watch/request",
            "method": "client/registerCapability",
            "params": {"registrations": [{
                "id": "sigil/language-watch",
                "method": "workspace/didChangeWatchedFiles",
                "registerOptions": {"watchers": [{"globPattern": "**/*", "kind": 7}]},
            }]},
        })
    );
    // Once only, and the client's answer is accepted and ignored.
    assert!(
        client
            .notify("initialized", json!({}))
            .iter()
            .all(|m| m.get("id").is_none())
    );
    let reply = json!({"jsonrpc": "2.0", "id": "sigil/watch/request", "result": null});
    assert!(client.send(reply).is_empty());
    let late = json!({"jsonrpc": "2.0", "id": "sigil/watch/request", "error": {"code": -1, "message": "no"}});
    assert!(client.send(late).is_empty());

    for declared in [Some(false), None] {
        let mut client = Client::at(&temp.root);
        let out = client.start_with(dynamic_registration_params(&temp, declared));
        assert!(responses(&out).is_empty(), "{declared:?}");
    }
}

#[test]
fn a_change_whose_version_is_not_newer_is_ignored() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let uri = temp.uri("a.sigil");
    client.open(&uri, 5, CLEAN);
    let loads = client.server.generation();
    for version in [5, 4, 0] {
        assert!(
            client.change(&uri, version, &[BROKEN]).is_empty(),
            "version {version}"
        );
    }
    assert_eq!(client.server.generation(), loads);
    // A newer version is applied.
    let out = client.change(&uri, 6, &[BROKEN]);
    assert!(!published_for(&out, &uri).unwrap().is_empty());
}

#[test]
fn the_last_of_several_changes_wins() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let uri = temp.uri("a.sigil");
    client.open(&uri, 1, CLEAN);
    let out = client.change(&uri, 2, &[CLEAN, BROKEN]);
    assert!(!published_for(&out, &uri).unwrap().is_empty());
    let out = client.change(&uri, 3, &[BROKEN, CLEAN]);
    assert_eq!(published_for(&out, &uri).unwrap().len(), 0);
    // No changes at all is ignored.
    assert!(client.change(&uri, 4, &[]).is_empty());
}

#[test]
fn a_change_for_a_document_that_was_never_opened_is_ignored() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let before = client.server.generation();
    assert!(client.change(&temp.uri("a.sigil"), 1, &[BROKEN]).is_empty());
    assert_eq!(client.server.generation(), before);
    // The disk text still stands.
    let snapshot = client.server.snapshot().unwrap();
    assert!(snapshot.from_disk("a.sigil"));
}

#[test]
fn closing_returns_the_file_to_its_disk_text_and_republishes_the_closed_uri() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    let uri = temp.uri("a.sigil");
    client.open(&uri, 1, BROKEN);
    assert!(!client.server.snapshot().unwrap().from_disk("a.sigil"));
    let out = client.close(&uri);
    assert_eq!(published_for(&out, &uri).unwrap().len(), 0);
    assert!(client.server.snapshot().unwrap().from_disk("a.sigil"));
    // Closing a document that is not open still publishes its URI.
    let other = temp.uri("never-opened.sigil");
    let out = client.close(&other);
    assert_eq!(published_for(&out, &other), Some(Vec::new()));
}

#[test]
fn a_buffer_outside_the_root_publishes_an_empty_list_and_does_not_join() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let outside = Temp::new();
    let mut client = Client::at(&temp.root);
    let before = client.start(&temp);
    let uri = outside.uri("other.sigil");
    let out = client.open(&uri, 1, BROKEN);
    assert_eq!(published_for(&out, &uri), Some(Vec::new()));
    let snapshot = client.server.snapshot().unwrap();
    let path = outside.path("other.sigil");
    assert!(snapshot.file_index(&path.to_string_lossy()).is_none());
    assert_eq!(snapshot.resolved.paths, vec!["a.sigil".to_owned()]);
    // The workspace's own diagnostics are unchanged.
    let after: Vec<_> = published(&out)
        .into_iter()
        .filter(|(u, _)| *u != uri)
        .collect();
    assert_eq!(after, published(&before));
}

#[test]
fn a_config_that_does_not_parse_is_published_and_the_server_keeps_running() {
    let temp = Temp::new();
    temp.write(".sigil/config.json", "{");
    temp.write("a.sigil", CLEAN);
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let config = temp.uri(".sigil/config.json");
    let found = published_for(&out, &config).unwrap();
    assert_eq!(found[0]["code"], "SIGIL_CONFIG_PARSE");
    assert_eq!(client.server.state(), State::Running);
    let response = client.request("workspace/symbol", json!({}));
    assert_eq!(error_of(&response).0, -32601);
}

#[test]
fn a_workspace_without_a_config_publishes_one_diagnostic_at_the_start_directory() {
    let temp = Temp::new();
    temp.write("a.sigil", CLEAN);
    let mut client = Client::at(&temp.root);
    let out = client.start(&temp);
    let config = temp.uri(".sigil/config.json");
    let found = published_for(&out, &config).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0]["code"], "SIGIL_CONFIG_NOT_FOUND");
    assert_eq!(
        found[0]["message"],
        format!(
            "No ancestor .sigil/config.json was found from {}.",
            temp.text()
        )
    );
    assert_eq!(published(&out).len(), 1);
}

#[test]
fn a_start_in_a_nested_folder_finds_the_root_above_it() {
    let temp = workspace_with(&[("a.sigil", BROKEN)]);
    temp.write("pkg/deep/b.sigil", CLEAN);
    // The server runs elsewhere; the client names a folder two levels down.
    let elsewhere = Temp::new();
    let mut client = Client::at(&elsewhere.root);
    let out = client.start_with(json!({
        "rootUri": elsewhere.uri(""),
        "workspaceFolders": [{"uri": temp.uri("pkg/deep"), "name": "deep"}],
    }));
    assert!(
        !published_for(&out, &temp.uri("a.sigil"))
            .unwrap()
            .is_empty()
    );
    let snapshot = client.server.snapshot().unwrap();
    assert_eq!(snapshot.root(), temp.text());
    assert!(snapshot.file_index("pkg/deep/b.sigil").is_some());
}

#[test]
fn a_nested_workspace_conflict_is_published_with_absolute_locations() {
    // Discovery shows its paths relative to the process's directory, which is
    // above this directory, and the snapshot makes them absolute again.
    let temp = Temp::below_cwd();
    temp.write(".sigil/config.json", support::CONFIG);
    temp.write("child/.sigil/config.json", support::CONFIG);
    temp.write("child/a.sigil", CLEAN);
    let child = temp.path("child");
    let mut client = Client::at(&child);
    let out = client.start_with(json!({"rootUri": temp.uri("child")}));
    let config = temp.uri("child/.sigil/config.json");
    let found = published_for(&out, &config).expect("published at the child's config");
    let nested = found
        .iter()
        .find(|d| d["code"] == "SIGIL_NESTED_CONFIG")
        .expect("a nested config diagnostic");
    assert_eq!(
        nested["message"],
        format!(
            "Workspace {} is nested inside parent workspace {} without being excluded by it.",
            child.display(),
            temp.text()
        )
    );
    let parent_config = temp.uri(".sigil/config.json");
    assert_eq!(
        nested["relatedInformation"][0]["location"]["uri"],
        parent_config
    );
    assert_eq!(
        nested["data"]["related"][0]["filePath"],
        format!("{}/.sigil/config.json", temp.text())
    );
}

#[test]
fn exit_after_shutdown_sets_zero_and_without_it_sets_one() {
    let temp = Temp::workspace();
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    assert_eq!(client.server.exit_code(), None);
    client.request("shutdown", Value::Null);
    assert!(client.notify("exit", Value::Null).is_empty());
    assert_eq!(client.server.exit_code(), Some(0));
    assert_eq!(client.server.state(), State::Exited);

    let mut client = Client::at(&temp.root);
    client.start(&temp);
    client.notify("exit", Value::Null);
    assert_eq!(client.server.exit_code(), Some(1));

    let mut client = Client::at(&temp.root);
    client.notify("exit", Value::Null);
    assert_eq!(client.server.exit_code(), Some(1));
    let response = client.request("textDocument/hover", json!({}));
    assert_eq!(error_of(&response).0, -32600);
}

#[test]
fn a_cancelled_request_answers_cancelled_once() {
    let temp = Temp::workspace();
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    client.server.cancel(&id(77));
    let ask = || json!({"jsonrpc": "2.0", "id": 77, "method": "workspace/symbol"});
    let out = client.send(ask());
    assert_eq!(error_of(&out[0]), (-32800, "Request cancelled.".to_owned()));
    let out = client.send(ask());
    assert_eq!(error_of(&out[0]).0, -32601);
    // The notification form marks the same way, for either id type.
    client.notify("$/cancelRequest", json!({"id": "x"}));
    let out = client.send(json!({"jsonrpc": "2.0", "id": "x", "method": "workspace/symbol"}));
    assert_eq!(error_of(&out[0]).0, -32800);
}

#[test]
fn a_failed_reload_clears_the_diagnostics_shows_the_cause_and_the_next_request_recovers() {
    let temp = workspace_with(&[("a.sigil", BROKEN)]);
    let disk = Disk::new();
    let mut client = Client::new(disk.options(&temp.root, LONG_DELAY));
    let out = client.start(&temp);
    let a = temp.uri("a.sigil");
    assert!(!published_for(&out, &a).unwrap().is_empty());

    disk.fail(1);
    let b = temp.uri("b.sigil");
    let out = client.open(&b, 1, CLEAN);
    let sent = published(&out);
    assert_eq!(sent, vec![(a.clone(), vec![]), (b.clone(), vec![])]);
    let last = out.last().unwrap();
    assert_eq!(last["method"], "window/showMessage");
    assert_eq!(
        last["params"],
        json!({"type": 1, "message": "Unable to load Sigil workspace: disk unplugged"})
    );
    assert!(client.server.snapshot().is_none());

    // The next request recovers at once, because the first failure was not a retry.
    let loads = disk.loads();
    let response = client.request("workspace/symbol", json!({}));
    assert_eq!(error_of(&response).0, -32601);
    assert_eq!(disk.loads(), loads + 1);
    assert!(client.server.snapshot().is_some());
    // The buffer that was open during the failure is still there.
    assert!(!client.server.snapshot().unwrap().from_disk("b.sigil"));
}

#[test]
fn a_persistent_failure_inside_the_window_answers_internal_error_without_another_read() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let disk = Disk::new();
    let mut client = Client::new(disk.options(&temp.root, LONG_DELAY));
    client.start(&temp);
    disk.fail(ALWAYS);
    let out = client.open(&temp.uri("b.sigil"), 1, CLEAN);
    assert_eq!(out.last().unwrap()["method"], "window/showMessage");

    let loads = disk.loads();
    let first = client.request("workspace/symbol", json!({}));
    let cause = "Unable to load workspace: disk unplugged".to_owned();
    assert_eq!(error_of(&first), (-32603, cause.clone()));
    assert_eq!(disk.loads(), loads + 1, "the first request tries once more");

    let second = client.request("workspace/symbol", json!({}));
    assert_eq!(error_of(&second), (-32603, cause));
    assert_eq!(disk.loads(), loads + 1, "the second is inside the window");
    // Even a disk that works again is not read inside the window.
    disk.fail(0);
    let third = client.request("workspace/symbol", json!({}));
    assert_eq!(error_of(&third).0, -32603);
    assert_eq!(disk.loads(), loads + 1);
    // Shutdown does not read the workspace.
    assert_eq!(
        client.request("shutdown", Value::Null)["result"],
        Value::Null
    );
}

#[test]
fn a_retry_after_the_window_reads_again() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let disk = Disk::new();
    let mut client = Client::new(disk.options(&temp.root, SHORT_DELAY));
    client.start(&temp);
    disk.fail(ALWAYS);
    client.open(&temp.uri("b.sigil"), 1, CLEAN);
    let loads = disk.loads();
    assert_eq!(
        error_of(&client.request("workspace/symbol", json!({}))).0,
        -32603
    );
    assert_eq!(disk.loads(), loads + 1);

    sleep(SHORT_DELAY * 4);
    assert_eq!(
        error_of(&client.request("workspace/symbol", json!({}))).0,
        -32603
    );
    assert_eq!(disk.loads(), loads + 2, "one attempt after the window");

    disk.fail(0);
    sleep(SHORT_DELAY * 4);
    assert_eq!(
        error_of(&client.request("workspace/symbol", json!({}))).0,
        -32601
    );
    assert_eq!(disk.loads(), loads + 3);
    assert!(client.server.snapshot().is_some());
}

#[test]
fn a_failed_first_load_fails_initialize_and_leaves_the_server_uninitialized() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let disk = Disk::new();
    disk.fail(1);
    let mut client = Client::new(disk.options(&temp.root, LONG_DELAY));
    let response = client.request("initialize", json!({"rootUri": temp.uri("")}));
    assert_eq!(error_of(&response), (-32603, "disk unplugged".to_owned()));
    assert_eq!(client.server.state(), State::Uninitialized);
    let response = client.request("initialize", json!({"rootUri": temp.uri("")}));
    assert!(response.get("result").is_some());
    assert_eq!(client.server.state(), State::Running);
}

fn reload_count_after(disk: &Disk, client: &mut Client, uris: &[String]) -> usize {
    let before = disk.loads();
    client.watched(uris);
    disk.loads() - before
}

#[test]
fn watched_events_reload_for_sources_and_workspace_files_only() {
    let temp = workspace_with(&[("a.sigil", CLEAN), ("notes.md", "x")]);
    let disk = Disk::new();
    let mut client = Client::new(disk.options(&temp.root, LONG_DELAY));
    client.start(&temp);
    let reloads = |client: &mut Client, paths: &[&str]| {
        let uris: Vec<String> = paths.iter().map(|path| temp.uri(path)).collect();
        reload_count_after(&disk, client, &uris)
    };
    for path in [
        "a.sigil",
        "new/deep/file.sigil",
        ".sigil/config.json",
        ".sigil/glossary.json",
        ".sigil/local.json",
        "pkg/.sigil/config.json",
    ] {
        assert_eq!(reloads(&mut client, &[path]), 1, "{path}");
    }
    for path in [
        "notes.md",
        "a.sigil.bak",
        ".sigil/other.json",
        ".sigil/config.json.bak",
        "config.json",
        "src/main.rs",
    ] {
        assert_eq!(reloads(&mut client, &[path]), 0, "{path}");
    }
    // One reload for a batch, whatever its size, if any path matches.
    assert_eq!(
        reloads(&mut client, &["notes.md", "a.sigil", ".sigil/config.json"]),
        1
    );
    // A batch with a URI that is not a file, or with bad parameters, is ignored whole.
    let mixed = vec![temp.uri("a.sigil"), "http://example.com/a.sigil".to_owned()];
    assert_eq!(reload_count_after(&disk, &mut client, &mixed), 0);
    let bad = client.notify(
        "workspace/didChangeWatchedFiles",
        json!({"changes": [{"uri": 3}]}),
    );
    assert!(bad.is_empty());
    // Nothing is watched before initialize.
    let mut early = Client::new(disk.options(&temp.root, LONG_DELAY));
    let before = disk.loads();
    early.watched(&[temp.uri("a.sigil")]);
    assert_eq!(disk.loads(), before);
}

#[test]
fn a_watched_event_for_a_changed_file_publishes_the_new_diagnostics() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    temp.write("a.sigil", BROKEN);
    let uri = temp.uri("a.sigil");
    let out = client.watched(std::slice::from_ref(&uri));
    assert!(!published_for(&out, &uri).unwrap().is_empty());
    temp.write("a.sigil", CLEAN);
    let out = client.watched(std::slice::from_ref(&uri));
    assert_eq!(published_for(&out, &uri), Some(Vec::new()));
}

fn request(id: i64, method: &str) -> sigil_lsp::rpc::Incoming {
    classify(json!({"jsonrpc": "2.0", "id": id, "method": method}))
}

fn notification(method: &str, params: Value) -> sigil_lsp::rpc::Incoming {
    classify(json!({"jsonrpc": "2.0", "method": method, "params": params}))
}

#[test]
fn would_reload_names_the_messages_that_start_a_reload() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let mut client = Client::at(&temp.root);
    let uri = temp.uri("a.sigil");
    let open = notification(
        "textDocument/didOpen",
        json!({"textDocument": {"uri": uri, "version": 1, "text": CLEAN}}),
    );
    assert!(!client.server.would_reload(&open), "before initialize");
    client.start(&temp);
    assert!(client.server.would_reload(&open));
    let change = |version: i64| {
        notification(
            "textDocument/didChange",
            json!({"textDocument": {"uri": uri, "version": version}, "contentChanges": [{"text": BROKEN}]}),
        )
    };
    assert!(!client.server.would_reload(&change(2)), "not open yet");
    client.open(&uri, 1, CLEAN);
    assert!(client.server.would_reload(&change(2)));
    assert!(!client.server.would_reload(&change(1)), "not newer");
    let close = notification(
        "textDocument/didClose",
        json!({"textDocument": {"uri": uri}}),
    );
    assert!(client.server.would_reload(&close));
    let watch = |path: &str| {
        notification(
            "workspace/didChangeWatchedFiles",
            json!({"changes": [{"uri": temp.uri(path), "type": 2}]}),
        )
    };
    assert!(client.server.would_reload(&watch("b.sigil")));
    assert!(client.server.would_reload(&watch(".sigil/glossary.json")));
    assert!(!client.server.would_reload(&watch("notes.md")));
    assert!(
        !client
            .server
            .would_reload(&notification("initialized", json!({})))
    );
    assert!(
        !client
            .server
            .would_reload(&notification("$/setTrace", json!({})))
    );
    assert!(
        !client
            .server
            .would_reload(&request(3, "textDocument/hover"))
    );
    assert!(
        !client
            .server
            .would_reload(&notification("textDocument/didOpen", json!({})))
    );
    client.notify("exit", Value::Null);
    assert!(!client.server.would_reload(&open), "after exit");
}

#[test]
fn a_burst_of_deferred_edits_settles_with_one_reload() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let disk = Disk::new();
    let mut client = Client::new(disk.options(&temp.root, LONG_DELAY));
    client.start(&temp);
    let uri = temp.uri("a.sigil");
    let loads = disk.loads();
    let edit = |version: i64, text: &str| {
        if version == 1 {
            notification(
                "textDocument/didOpen",
                json!({"textDocument": {"uri": uri, "version": 1, "text": text}}),
            )
        } else {
            notification(
                "textDocument/didChange",
                json!({"textDocument": {"uri": uri, "version": version}, "contentChanges": [{"text": text}]}),
            )
        }
    };
    for (version, text) in [(1, CLEAN), (2, BROKEN), (3, CLEAN), (4, BROKEN)] {
        assert!(
            client
                .server
                .handle_deferred(edit(version, text))
                .is_empty()
        );
    }
    assert!(client.server.reload_pending());
    assert_eq!(disk.loads(), loads, "nothing is read before settle");
    let out = client.server.settle();
    assert_eq!(disk.loads(), loads + 1);
    assert!(!client.server.reload_pending());
    assert!(
        !published_for(&out, &uri).unwrap().is_empty(),
        "the last edit won"
    );
    assert!(client.server.settle().is_empty());
    assert_eq!(disk.loads(), loads + 1);
}

#[test]
fn deferred_closes_and_watch_events_settle_into_one_publication_set() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let disk = Disk::new();
    let mut client = Client::new(disk.options(&temp.root, LONG_DELAY));
    client.start(&temp);
    let uri = temp.uri("a.sigil");
    client.open(&uri, 1, BROKEN);
    let loads = disk.loads();
    let close = notification(
        "textDocument/didClose",
        json!({"textDocument": {"uri": uri}}),
    );
    assert!(client.server.handle_deferred(close).is_empty());
    let watch = notification(
        "workspace/didChangeWatchedFiles",
        json!({"changes": [{"uri": temp.uri("a.sigil"), "type": 2}]}),
    );
    assert!(client.server.handle_deferred(watch).is_empty());
    let ignored = notification(
        "workspace/didChangeWatchedFiles",
        json!({"changes": [{"uri": temp.uri("notes.md"), "type": 2}]}),
    );
    assert!(client.server.handle_deferred(ignored).is_empty());
    let out = client.server.settle();
    assert_eq!(disk.loads(), loads + 1);
    assert_eq!(
        published_for(&out, &uri),
        Some(Vec::new()),
        "the closed URI is republished"
    );
}

#[test]
fn a_request_settles_pending_edits_and_answers_after_their_diagnostics() {
    let temp = workspace_with(&[("a.sigil", CLEAN)]);
    let disk = Disk::new();
    let mut client = Client::new(disk.options(&temp.root, LONG_DELAY));
    client.start(&temp);
    let uri = temp.uri("a.sigil");
    let open = notification(
        "textDocument/didOpen",
        json!({"textDocument": {"uri": uri, "version": 1, "text": BROKEN}}),
    );
    client.server.handle_deferred(open);
    let loads = disk.loads();
    let out = client.server.handle(request(9, "workspace/symbol"));
    assert_eq!(disk.loads(), loads + 1);
    let (last, rest) = out.split_last().unwrap();
    assert_eq!(last["id"], 9);
    assert!(!rest.is_empty());
    assert!(
        rest.iter()
            .all(|m| m["method"] == "textDocument/publishDiagnostics")
    );
    // A cancelled request does not read the workspace for nothing.
    client.server.handle_deferred(notification(
        "textDocument/didClose",
        json!({"textDocument": {"uri": uri}}),
    ));
    client.server.cancel(&id(10));
    let out = client.server.handle(request(10, "workspace/symbol"));
    assert_eq!(out.len(), 1);
    assert_eq!(error_of(&out[0]).0, -32800);
    assert!(client.server.reload_pending());
}

#[test]
fn the_default_options_start_from_the_process_directory() {
    let options = ServerOptions::default();
    assert_eq!(options.cwd, std::env::current_dir().unwrap());
    assert!(options.fs.is_none());
    assert_eq!(options.retry_delay, Duration::from_millis(1000));
    let server = Server::new(options);
    assert_eq!(server.state(), State::Uninitialized);
    assert_eq!(server.exit_code(), None);
}

#[test]
fn an_invalid_message_is_answered_as_an_invalid_request() {
    let temp = Temp::workspace();
    let mut client = Client::at(&temp.root);
    let out = client.send(json!({"jsonrpc": "1.0"}));
    assert_eq!(error_of(&out[0]), (-32600, "Invalid Request".to_owned()));
    assert_eq!(out[0]["id"], Value::Null);
}
