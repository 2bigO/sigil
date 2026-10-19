use serde_json::{Value, json};
use sigil_lsp::params::{
    DidChangeRef, DidChangeWatchedFilesParams, DidOpenRef, ExecuteCommandParams, FileChange,
    InitializeParams, InvalidParams, PositionParams, TextDocumentParams, cancellation_id,
    did_change, did_change_watched_files, did_close, did_open, document_symbol, execute_command,
    initialize, semantic_tokens, text_document_position,
};
use sigil_lsp::rpc::Id;

fn message<T: std::fmt::Debug>(result: Result<T, InvalidParams>) -> String {
    result.unwrap_err().message().to_owned()
}

#[test]
fn initialize_accepts_absent_null_and_full_params() {
    for params in [Value::Null, json!({}), json!({"capabilities": null})] {
        assert_eq!(initialize(&params).unwrap(), InitializeParams::default());
    }
    let parsed = initialize(&json!({
        "rootUri": "file:///w",
        "workspaceFolders": [{"uri": "file:///a", "name": "a"}, {"uri": "file:///b"}],
        "capabilities": {"workspace": {"didChangeWatchedFiles": {"dynamicRegistration": true}}}
    }))
    .unwrap();
    assert_eq!(parsed.root_uri.as_deref(), Some("file:///w"));
    assert_eq!(
        parsed.workspace_folders,
        Some(vec!["file:///a".to_owned(), "file:///b".to_owned()])
    );
    assert_eq!(parsed.dynamic_registration, Some(true));
    assert!(parsed.supports_watch_registration());
    assert_eq!(parsed.start_uri(), Some("file:///a"));
}

#[test]
fn initialize_start_uri_follows_ts_precedence() {
    let from_root = initialize(&json!({"rootUri": "file:///w"})).unwrap();
    assert_eq!(from_root.start_uri(), Some("file:///w"));
    let empty_folders =
        initialize(&json!({"rootUri": "file:///w", "workspaceFolders": []})).unwrap();
    assert_eq!(empty_folders.start_uri(), Some("file:///w"));
    let null_folders =
        initialize(&json!({"rootUri": "file:///w", "workspaceFolders": null})).unwrap();
    assert_eq!(null_folders.start_uri(), Some("file:///w"));
    let empty_uri = initialize(&json!({"rootUri": ""})).unwrap();
    assert_eq!(empty_uri.start_uri(), None);
    let none = initialize(&json!({"rootUri": null})).unwrap();
    assert_eq!(none.start_uri(), None);
    assert!(!none.supports_watch_registration());
}

#[test]
fn initialize_rejects_wrong_shapes_with_the_ts_messages() {
    assert_eq!(message(initialize(&json!(5))), "params must be an object.");
    assert_eq!(message(initialize(&json!([]))), "params must be an object.");
    assert_eq!(
        message(initialize(&json!({"rootUri": 5}))),
        "initialize rootUri must be a string or null."
    );
    assert_eq!(
        message(initialize(&json!({"workspaceFolders": "x"}))),
        "initialize workspaceFolders must be an array or null."
    );
    assert_eq!(
        message(initialize(&json!({"workspaceFolders": [5]}))),
        "Each workspace folder requires a URI."
    );
    assert_eq!(
        message(initialize(&json!({"workspaceFolders": [{"name": "a"}]}))),
        "Each workspace folder requires a URI."
    );
    assert_eq!(
        message(initialize(&json!({"capabilities": 1}))),
        "params must be an object."
    );
    assert_eq!(
        message(initialize(&json!({"capabilities": {"workspace": []}}))),
        "params must be an object."
    );
    assert_eq!(
        message(initialize(
            &json!({"capabilities": {"workspace": {"didChangeWatchedFiles": 1}}})
        )),
        "params must be an object."
    );
    assert_eq!(
        message(initialize(&json!({"capabilities": {"workspace": {
            "didChangeWatchedFiles": {"dynamicRegistration": "yes"}}}}))),
        "initialize watched-file dynamicRegistration must be a boolean."
    );
}

#[test]
fn did_open_accepts_and_rejects() {
    let params = json!({"textDocument": {
        "uri": "file:///a.sigil", "version": 3, "text": "x", "languageId": "sigil"}});
    let parsed = did_open(&params).unwrap();
    assert_eq!(
        parsed,
        DidOpenRef {
            uri: "file:///a.sigil",
            version: 3.0,
            text: "x",
        }
    );
    assert_eq!(
        message(did_open(&json!(null))),
        "didOpen params must be an object."
    );
    assert_eq!(
        message(did_open(&json!({"textDocument": []}))),
        "didOpen textDocument must be an object."
    );
    assert_eq!(
        message(did_open(&json!({}))),
        "didOpen textDocument must be an object."
    );
    let missing = "didOpen requires uri, version, and text.";
    for document in [
        json!({"version": 1, "text": ""}),
        json!({"uri": 1, "version": 1, "text": ""}),
        json!({"uri": "u", "text": ""}),
        json!({"uri": "u", "version": "1", "text": ""}),
        json!({"uri": "u", "version": 1}),
        json!({"uri": "u", "version": 1, "text": null}),
    ] {
        assert_eq!(
            message(did_open(&json!({"textDocument": document}))),
            missing
        );
    }
}

#[test]
fn did_change_accepts_and_rejects() {
    let params = json!({
        "textDocument": {"uri": "u", "version": 2},
        "contentChanges": [{"text": "a"}, {"text": "b", "range": null}]
    });
    let parsed = did_change(&params).unwrap();
    assert_eq!(
        parsed,
        DidChangeRef {
            uri: "u",
            version: 2.0,
            texts: vec!["a", "b"],
        }
    );
    assert!(
        did_change(&json!({"textDocument": {"uri": "u", "version": 2}, "contentChanges": []}))
            .unwrap()
            .texts
            .is_empty()
    );
    assert_eq!(
        message(did_change(&json!(1))),
        "didChange params must be an object."
    );
    assert_eq!(
        message(did_change(&json!({"textDocument": null}))),
        "didChange textDocument must be an object."
    );
    let wrong = "didChange requires uri, version, and full text changes.";
    for params in [
        json!({"textDocument": {"version": 1}, "contentChanges": []}),
        json!({"textDocument": {"uri": "u"}, "contentChanges": []}),
        json!({"textDocument": {"uri": "u", "version": 1}}),
        json!({"textDocument": {"uri": "u", "version": 1}, "contentChanges": {}}),
        json!({"textDocument": {"uri": "u", "version": 1}, "contentChanges": [1]}),
        json!({"textDocument": {"uri": "u", "version": 1}, "contentChanges": [{"text": 1}]}),
        json!({"textDocument": {"uri": "u", "version": 1}, "contentChanges": [{"range": {}}]}),
    ] {
        assert_eq!(message(did_change(&params)), wrong, "{params}");
    }
}

#[test]
fn did_close_document_symbol_and_semantic_tokens_share_the_document_check() {
    let ok = json!({"textDocument": {"uri": "file:///a"}});
    let expected = TextDocumentParams {
        uri: "file:///a".into(),
    };
    assert_eq!(did_close(&ok).unwrap(), expected);
    assert_eq!(document_symbol(&ok).unwrap(), expected);
    assert_eq!(semantic_tokens(&ok).unwrap(), expected);
    assert_eq!(
        message(did_close(&json!([]))),
        "didClose params must be an object."
    );
    assert_eq!(
        message(document_symbol(&json!(null))),
        "documentSymbol params must be an object."
    );
    assert_eq!(
        message(semantic_tokens(&json!(1))),
        "semanticTokens params must be an object."
    );
    for check in [did_close, document_symbol, semantic_tokens] {
        assert_eq!(
            message(check(&json!({}))),
            "textDocument must be an object."
        );
        assert_eq!(
            message(check(&json!({"textDocument": 5}))),
            "textDocument must be an object."
        );
        assert_eq!(
            message(check(&json!({"textDocument": {}}))),
            "textDocument requires a URI."
        );
        assert_eq!(
            message(check(&json!({"textDocument": {"uri": 5}}))),
            "textDocument requires a URI."
        );
    }
}

#[test]
fn did_change_watched_files_accepts_and_rejects() {
    let parsed = did_change_watched_files(&json!({"changes": [
        {"uri": "file:///a", "type": 1}, {"uri": "file:///b", "type": 2},
        {"uri": "file:///c", "type": 3.0}]}))
    .unwrap();
    assert_eq!(
        parsed,
        DidChangeWatchedFilesParams {
            changes: vec![
                FileChange {
                    uri: "file:///a".into(),
                    kind: 1
                },
                FileChange {
                    uri: "file:///b".into(),
                    kind: 2
                },
                FileChange {
                    uri: "file:///c".into(),
                    kind: 3
                },
            ]
        }
    );
    assert_eq!(
        message(did_change_watched_files(&json!(null))),
        "didChangeWatchedFiles params must be an object."
    );
    let wrong = "didChangeWatchedFiles requires URI and change type entries.";
    for params in [
        json!({}),
        json!({"changes": {}}),
        json!({"changes": [1]}),
        json!({"changes": [{"type": 1}]}),
        json!({"changes": [{"uri": "u"}]}),
        json!({"changes": [{"uri": "u", "type": 4}]}),
        json!({"changes": [{"uri": "u", "type": 0}]}),
        json!({"changes": [{"uri": "u", "type": "1"}]}),
        json!({"changes": [{"uri": 1, "type": 1}]}),
    ] {
        assert_eq!(
            message(did_change_watched_files(&params)),
            wrong,
            "{params}"
        );
    }
}

#[test]
fn position_params_accept_non_negative_integers() {
    let parsed = text_document_position(&json!({
        "textDocument": {"uri": "file:///a"},
        "position": {"line": 0, "character": 12}}))
    .unwrap();
    assert_eq!(
        parsed,
        PositionParams {
            uri: "file:///a".into(),
            line: 0,
            character: 12,
        }
    );
    let whole_float = text_document_position(&json!({
        "textDocument": {"uri": "u"}, "position": {"line": 2.0, "character": 3.0}}))
    .unwrap();
    assert_eq!((whole_float.line, whole_float.character), (2, 3));
}

#[test]
fn position_params_reject_each_wrong_shape() {
    assert_eq!(
        message(text_document_position(&json!(1))),
        "text document position params must be an object."
    );
    assert_eq!(
        message(text_document_position(
            &json!({"textDocument": {"uri": "u"}})
        )),
        "position must be an object."
    );
    let wrong = "Position requires non-negative line and character values.";
    for position in [
        json!({"line": -1, "character": 0}),
        json!({"line": 0, "character": -1}),
        json!({"line": 1.5, "character": 0}),
        json!({"line": 0, "character": 0.25}),
        json!({"line": "1", "character": 0}),
        json!({"line": 0}),
        json!({"character": 0}),
        json!({"line": null, "character": 0}),
    ] {
        assert_eq!(
            message(text_document_position(
                &json!({"textDocument": {"uri": "u"}, "position": position})
            )),
            wrong,
            "{position}"
        );
    }
    assert_eq!(
        message(text_document_position(
            &json!({"position": {"line": 0, "character": 0}})
        )),
        "textDocument must be an object."
    );
    assert_eq!(
        message(text_document_position(
            &json!({"textDocument": {}, "position": {"line": 0, "character": 0}})
        )),
        "textDocument requires a URI."
    );
}

#[test]
fn execute_command_accepts_and_rejects() {
    assert_eq!(
        execute_command(&json!({"command": "sigil.renderDocument"})).unwrap(),
        ExecuteCommandParams {
            command: "sigil.renderDocument".into(),
            arguments: None,
        }
    );
    assert_eq!(
        execute_command(&json!({"command": "c", "arguments": ["file:///a", 1]})).unwrap(),
        ExecuteCommandParams {
            command: "c".into(),
            arguments: Some(vec![json!("file:///a"), json!(1)]),
        }
    );
    assert_eq!(
        message(execute_command(&json!(null))),
        "executeCommand params must be an object."
    );
    assert_eq!(
        message(execute_command(&json!({}))),
        "executeCommand requires a command string."
    );
    assert_eq!(
        message(execute_command(&json!({"command": 1}))),
        "executeCommand requires a command string."
    );
    assert_eq!(
        message(execute_command(&json!({"command": "c", "arguments": {}}))),
        "executeCommand arguments must be an array."
    );
    assert_eq!(
        message(execute_command(&json!({"command": "c", "arguments": null}))),
        "executeCommand arguments must be an array."
    );
}

#[test]
fn cancellation_id_takes_strings_and_numbers_only() {
    assert_eq!(
        cancellation_id(&json!({"id": 5})),
        Id::from_value(&json!(5))
    );
    assert_eq!(
        cancellation_id(&json!({"id": "a"})),
        Id::from_value(&json!("a"))
    );
    for params in [
        json!({"id": null}),
        json!({"id": true}),
        json!({}),
        json!(5),
        json!([1]),
    ] {
        assert_eq!(cancellation_id(&params), None, "{params}");
    }
}
