use serde_json::{Value, json};
use sigil_lsp::rpc::{
    Framer, Id, Incoming, Item, classify, encode, failure, invalid_request, notification,
    parse_error, request, success,
};

fn frame(body: &str) -> Vec<u8> {
    format!("Content-Length: {}\r\n\r\n{body}", body.len()).into_bytes()
}

fn messages(items: &[Item]) -> Vec<Value> {
    items
        .iter()
        .map(|item| match item {
            Item::Message(value) => value.clone(),
            Item::ParseError => Value::String("parse-error".into()),
        })
        .collect()
}

#[test]
fn a_message_split_inside_its_header_arrives_when_complete() {
    let bytes = frame(r#"{"a":1}"#);
    let mut framer = Framer::new();
    assert!(framer.feed(&bytes[..8]).is_empty());
    let items = framer.feed(&bytes[8..]);
    assert_eq!(messages(&items), vec![json!({"a": 1})]);
}

#[test]
fn a_message_split_inside_its_body_arrives_when_complete() {
    let bytes = frame(r#"{"a":1}"#);
    let mut framer = Framer::new();
    let cut = bytes.len() - 3;
    assert!(framer.feed(&bytes[..cut]).is_empty());
    assert_eq!(messages(&framer.feed(&bytes[cut..])), vec![json!({"a": 1})]);
}

#[test]
fn a_message_fed_one_byte_at_a_time_arrives_once() {
    let bytes = frame(r#"{"a":1}"#);
    let mut framer = Framer::new();
    let mut all = Vec::new();
    for byte in &bytes {
        all.extend(framer.feed(std::slice::from_ref(byte)));
    }
    assert_eq!(messages(&all), vec![json!({"a": 1})]);
}

#[test]
fn two_messages_in_one_chunk_yield_two() {
    let mut bytes = frame(r#"{"a":1}"#);
    bytes.extend(frame(r#"{"b":2}"#));
    let items = Framer::new().feed(&bytes);
    assert_eq!(messages(&items), vec![json!({"a": 1}), json!({"b": 2})]);
}

#[test]
fn a_multibyte_body_is_measured_in_bytes() {
    let body = "{\"t\":\"é\u{4e2d}\u{1f600}\"}";
    assert_ne!(body.len(), body.chars().count());
    let items = Framer::new().feed(&frame(body));
    assert_eq!(messages(&items), vec![json!({"t": "é\u{4e2d}\u{1f600}"})]);
}

#[test]
fn encode_writes_the_length_in_utf8_bytes() {
    let value = json!({"t": "é\u{4e2d}"});
    let body = serde_json::to_string(&value).unwrap();
    let encoded = encode(&value);
    let expected = format!("Content-Length: {}\r\n\r\n{body}", body.len());
    assert_eq!(encoded, expected.into_bytes());
    assert_ne!(body.len(), body.chars().count());
}

#[test]
fn encoded_messages_decode_again() {
    let value = json!({"jsonrpc": "2.0", "id": 1, "result": null});
    let items = Framer::new().feed(&encode(&value));
    assert_eq!(messages(&items), vec![value]);
}

#[test]
fn a_malformed_body_between_good_frames_yields_good_error_good() {
    let mut bytes = frame(r#"{"a":1}"#);
    bytes.extend(frame("{not json"));
    bytes.extend(frame(r#"{"b":2}"#));
    let items = Framer::new().feed(&bytes);
    assert_eq!(
        messages(&items),
        vec![json!({"a": 1}), json!("parse-error"), json!({"b": 2})]
    );
}

#[test]
fn an_invalid_utf8_body_is_decoded_with_replacement_text_as_in_ts() {
    let mut bytes = b"Content-Length: 9\r\n\r\n{\"a\":\"".to_vec();
    bytes.extend([0xff]);
    bytes.extend(b"\"}");
    bytes.extend(frame(r#"{"b":2}"#));
    let items = Framer::new().feed(&bytes);
    assert_eq!(
        messages(&items),
        vec![json!({"a": "\u{fffd}"}), json!({"b": 2})]
    );
}

#[test]
fn the_header_name_is_case_insensitive() {
    let body = r#"{"a":1}"#;
    let bytes = format!("content-length: {}\r\n\r\n{body}", body.len());
    let items = Framer::new().feed(bytes.as_bytes());
    assert_eq!(messages(&items), vec![json!({"a": 1})]);
    let bytes = format!("CONTENT-LENGTH:{}\r\n\r\n{body}", body.len());
    let items = Framer::new().feed(bytes.as_bytes());
    assert_eq!(messages(&items), vec![json!({"a": 1})]);
}

#[test]
fn an_extra_content_type_header_is_ignored() {
    let body = r#"{"a":1}"#;
    let bytes = format!(
        "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let items = Framer::new().feed(bytes.as_bytes());
    assert_eq!(messages(&items), vec![json!({"a": 1})]);
}

#[test]
fn a_missing_content_length_yields_one_parse_error_and_framing_resumes() {
    let mut bytes = b"Content-Type: x\r\n\r\n{}".to_vec();
    bytes.extend(frame(r#"{"b":2}"#));
    let items = Framer::new().feed(&bytes);
    assert_eq!(
        messages(&items),
        vec![json!("parse-error"), json!({"b": 2})]
    );
}

#[test]
fn a_non_numeric_content_length_yields_one_parse_error_and_framing_resumes() {
    for length in ["abc", "-5", "1.5", "", "0x10", "99999999999999999999999"] {
        let mut bytes = format!("Content-Length: {length}\r\n\r\n{{}}").into_bytes();
        bytes.extend(frame(r#"{"b":2}"#));
        let items = Framer::new().feed(&bytes);
        assert_eq!(
            messages(&items),
            vec![json!("parse-error"), json!({"b": 2})],
            "length {length:?}"
        );
    }
}

#[test]
fn resync_works_when_the_next_frame_arrives_in_a_later_chunk() {
    let mut framer = Framer::new();
    let first = framer.feed(b"Content-Length: nope\r\n\r\n{}");
    assert_eq!(messages(&first), vec![json!("parse-error")]);
    assert!(framer.feed(b"Content-Len").is_empty());
    let items = framer.feed(format!("gth: 7\r\n\r\n{}", r#"{"b":2}"#).as_bytes());
    assert_eq!(messages(&items), vec![json!({"b": 2})]);
}

#[test]
fn a_lone_content_length_value_with_spaces_is_trimmed() {
    let items = Framer::new().feed(b"Content-Length:   2  \r\n\r\n{}");
    assert_eq!(messages(&items), vec![json!({})]);
}

#[test]
fn a_zero_length_body_is_a_parse_error() {
    let items = Framer::new().feed(b"Content-Length: 0\r\n\r\n");
    assert_eq!(messages(&items), vec![json!("parse-error")]);
}

fn classified(value: Value) -> Incoming {
    classify(value)
}

#[test]
fn a_request_has_an_id_a_method_and_params() {
    let incoming = classified(
        json!({"jsonrpc": "2.0", "id": 7, "method": "textDocument/hover", "params": {"a": 1}}),
    );
    assert_eq!(
        incoming,
        Incoming::Request {
            id: Id::from_value(&json!(7)).unwrap(),
            method: "textDocument/hover".into(),
            params: json!({"a": 1}),
        }
    );
    let incoming = classified(json!({"jsonrpc": "2.0", "id": "x", "method": "shutdown"}));
    assert_eq!(
        incoming,
        Incoming::Request {
            id: Id::from_value(&json!("x")).unwrap(),
            method: "shutdown".into(),
            params: Value::Null,
        }
    );
}

#[test]
fn a_notification_has_no_id() {
    let incoming = classified(json!({"jsonrpc": "2.0", "method": "initialized", "params": {}}));
    assert_eq!(
        incoming,
        Incoming::Notification {
            method: "initialized".into(),
            params: json!({}),
        }
    );
}

#[test]
fn a_response_with_a_result_or_an_error_is_accepted_even_with_a_null_id() {
    let ok = classified(json!({"jsonrpc": "2.0", "id": null, "result": null}));
    assert_eq!(ok, Incoming::Response { id: None });
    let ok = classified(json!({"jsonrpc": "2.0", "id": "r1", "result": 1}));
    assert_eq!(
        ok,
        Incoming::Response {
            id: Id::from_value(&json!("r1"))
        }
    );
    let error =
        classified(json!({"jsonrpc": "2.0", "id": 3, "error": {"code": -1, "message": "no"}}));
    assert_eq!(
        error,
        Incoming::Response {
            id: Id::from_value(&json!(3))
        }
    );
}

#[test]
fn invalid_shapes_are_invalid_requests() {
    let shapes = [
        json!(null),
        json!(5),
        json!("text"),
        json!([1, 2]),
        json!({"method": "x"}),
        json!({"jsonrpc": "1.0", "method": "x"}),
        json!({"jsonrpc": 2.0, "method": "x"}),
        json!({"jsonrpc": "2.0", "id": true, "method": "x"}),
        json!({"jsonrpc": "2.0", "id": null, "method": "x"}),
        json!({"jsonrpc": "2.0", "id": [1], "method": "x"}),
        json!({"jsonrpc": "2.0"}),
        json!({"jsonrpc": "2.0", "method": 5, "id": 1}),
        json!({"jsonrpc": "2.0", "id": true, "result": 1}),
        json!({"jsonrpc": "2.0", "id": 1}),
        json!({"jsonrpc": "2.0", "id": 1, "error": {"code": "x", "message": "m"}}),
        json!({"jsonrpc": "2.0", "id": 1, "error": {"code": 1}}),
    ];
    for shape in shapes {
        assert_eq!(classified(shape.clone()), Incoming::Invalid, "{shape}");
    }
}

#[test]
fn the_invalid_request_failure_has_a_null_id() {
    assert_eq!(
        invalid_request(),
        json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32600, "message": "Invalid Request"}})
    );
    assert_eq!(
        parse_error(),
        json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "Parse error"}})
    );
}

#[test]
fn error_codes_match_the_protocol() {
    use sigil_lsp::rpc::*;
    assert_eq!(PARSE_ERROR, -32700);
    assert_eq!(INVALID_REQUEST, -32600);
    assert_eq!(METHOD_NOT_FOUND, -32601);
    assert_eq!(INVALID_PARAMS, -32602);
    assert_eq!(INTERNAL_ERROR, -32603);
    assert_eq!(SERVER_NOT_INITIALIZED, -32002);
    assert_eq!(REQUEST_CANCELLED, -32800);
    assert_eq!(CONTENT_MODIFIED, -32801);
}

#[test]
fn builders_produce_the_envelope() {
    let id = Id::from_value(&json!(4)).unwrap();
    assert_eq!(
        success(&id, json!({"ok": true})),
        json!({"jsonrpc": "2.0", "id": 4, "result": {"ok": true}})
    );
    assert_eq!(
        failure(Some(&id), -32601, "Method not found"),
        json!({"jsonrpc": "2.0", "id": 4, "error": {"code": -32601, "message": "Method not found"}})
    );
    assert_eq!(
        failure(None, -32700, "Parse error"),
        json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "Parse error"}})
    );
    assert_eq!(
        notification("window/showMessage", json!({"type": 1})),
        json!({"jsonrpc": "2.0", "method": "window/showMessage", "params": {"type": 1}})
    );
    assert_eq!(
        request(
            &Id::from_value(&json!("sigil/watch/request")).unwrap(),
            "client/registerCapability",
            json!({})
        ),
        json!({"jsonrpc": "2.0", "id": "sigil/watch/request", "method": "client/registerCapability", "params": {}})
    );
}

#[test]
fn an_id_round_trips_through_json() {
    assert_eq!(Id::from_value(&json!(1)).unwrap().to_value(), json!(1));
    assert_eq!(Id::from_value(&json!("a")).unwrap().to_value(), json!("a"));
    assert!(Id::from_value(&json!(null)).is_none());
    assert!(Id::from_value(&json!(true)).is_none());
}
