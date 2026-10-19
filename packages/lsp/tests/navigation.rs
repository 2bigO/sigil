#![cfg(unix)]
//! Go to definition: what each kind of position leads to, and the positions
//! and files that lead nowhere. The recorded sessions cover the same ground
//! with other sources; these pin the cases one by one.
mod support;

use serde_json::{Value, json};
use support::{CLEAN, CONSUMER, Client, Temp};

/// A provider whose Tag has an inline definition and a later group heading.
const INLINE_PROVIDER: &str = "component Provider {\r\ngoal {\r\nOwn vocabulary.\r\n}\r\ninterface {\r\n😀 A *café results* carries a response.\r\n}\r\nconstraints {\r\ncafé results {\r\nPreserve exact content.\r\n}\r\n}\r\n}\r\n";

/// The same Tag with only group headings, in a source that ends lines with CR.
const CR_PROVIDER: &str = "component Provider {\rgoal {\rOwn vocabulary.\r}\rinterface {\rcafé results {\rOffer a response.\r}\r}\rconstraints {\rcafé results {\rPreserve exact content.\r}\r}\r}\r";

const MULTIWORD_CONSUMER: &str = "@provider.sigil from Provider import { café results }\ncomponent Consumer {\ngoal {\nServe the caller.\n}\ninterface {\n😀 Use café results now.\n\nRead [café results](./notes.md).\n```text\ncafé results\n```\n}\n}\n";

const GLOSSARY: &str = "{\n  \"schemaVersion\": 1,\n  \"terms\": [],\n  \"contexts\": [\n    {\n      \"id\": \"booking\",\n      \"include\": [\"**/*.sigil\"],\n      \"exclude\": [],\n      \"terms\": [\n        {\n          \"term\": \"hold\",\n          \"definition\": \"Booking capacity before confirmation.\",\n          \"aliases\": [\"temporary reservation\"]\n        }\n      ]\n    }\n  ]\n}\n";

const BOOKING: &str = "component Booking {\n  goal {\n    A temporary reservation creates a hold.\n\n    Ignore `temporary reservation`.\n  }\n\n  interface {\n    BookingTerm {\n      The hold remains visible.\n    }\n  }\n}\n";

/// The (line, UTF-16 column) of the `nth` occurrence of `needle`, counting
/// CRLF, CR and LF as one line ending each.
fn at(text: &str, needle: &str, nth: usize) -> (u32, u32) {
    let offset = text
        .match_indices(needle)
        .nth(nth)
        .unwrap_or_else(|| panic!("{needle:?} #{nth} is not in the text"))
        .0;
    let (mut line, mut column) = (0, 0);
    let mut chars = text[..offset].chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' if chars.peek() == Some(&'\n') => {}
            '\r' | '\n' => (line, column) = (line + 1, 0),
            c => column += c.len_utf16() as u32,
        }
    }
    (line, column)
}

fn range(from: (u32, u32), to: (u32, u32)) -> Value {
    json!({
        "start": {"line": from.0, "character": from.1},
        "end": {"line": to.0, "character": to.1},
    })
}

/// The range of `needle` (its `nth` occurrence) in `text`.
fn span(text: &str, needle: &str, nth: usize) -> Value {
    let from = at(text, needle, nth);
    range(
        from,
        (from.0, from.1 + needle.encode_utf16().count() as u32),
    )
}

fn definition(client: &mut Client, uri: &str, position: (u32, u32)) -> Value {
    let response = client.request(
        "textDocument/definition",
        json!({
            "textDocument": {"uri": uri},
            "position": {"line": position.0, "character": position.1},
        }),
    );
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

fn started(files: &[(&str, &str)]) -> (Temp, Client) {
    let temp = Temp::workspace();
    for (path, text) in files {
        temp.write(path, text);
    }
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    (temp, client)
}

fn place(temp: &Temp, path: &str, range: Value) -> Value {
    json!({"uri": temp.uri(path), "range": range})
}

#[test]
fn a_tag_use_and_an_import_selection_lead_to_the_inline_definition() {
    let (temp, mut client) = started(&[
        ("provider.sigil", INLINE_PROVIDER),
        ("consumer.sigil", MULTIWORD_CONSUMER),
    ]);
    let consumer = temp.uri("consumer.sigil");
    let inline = place(
        &temp,
        "provider.sigil",
        span(INLINE_PROVIDER, "café results", 0),
    );
    // Anywhere inside the multiword selection, and its use in prose.
    for position in [
        at(MULTIWORD_CONSUMER, "café results", 0),
        (0, at(MULTIWORD_CONSUMER, "café results", 0).1 + 11),
        at(MULTIWORD_CONSUMER, "café results", 1),
    ] {
        assert_eq!(definition(&mut client, &consumer, position), inline);
    }
    // The end of the name is outside it.
    let end = at(MULTIWORD_CONSUMER, "café results", 1);
    assert_eq!(
        definition(&mut client, &consumer, (end.0, end.1 + 12)),
        Value::Null
    );
    // A group heading of the same Tag, and the definition itself.
    let provider = temp.uri("provider.sigil");
    assert_eq!(
        definition(
            &mut client,
            &provider,
            at(INLINE_PROVIDER, "café results {", 0)
        ),
        inline
    );
    assert_eq!(
        definition(
            &mut client,
            &provider,
            at(INLINE_PROVIDER, "café results", 0)
        ),
        inline
    );
}

#[test]
fn without_an_inline_definition_the_earliest_group_heading_wins() {
    let (temp, mut client) = started(&[
        ("provider.sigil", CR_PROVIDER),
        ("consumer.sigil", MULTIWORD_CONSUMER),
    ]);
    let earliest = place(
        &temp,
        "provider.sigil",
        span(CR_PROVIDER, "café results", 0),
    );
    let consumer = temp.uri("consumer.sigil");
    let provider = temp.uri("provider.sigil");
    assert_eq!(
        definition(
            &mut client,
            &consumer,
            at(MULTIWORD_CONSUMER, "café results", 1)
        ),
        earliest
    );
    // The later heading leads to the earlier one.
    assert_eq!(
        definition(&mut client, &provider, at(CR_PROVIDER, "café results", 1)),
        earliest
    );
}

#[test]
fn a_tag_headed_in_cases_and_interface_leads_to_the_cases_heading() {
    let (temp, mut client) = started(&[("contract.sigil", CLEAN), ("consumer.sigil", CONSUMER)]);
    // CLEAN heads Execution in `cases`, before `interface`.
    let earliest = place(&temp, "contract.sigil", span(CLEAN, "Execution {", 0));
    let from_use = at(CONSUMER, "uses Execution", 0);
    let found = definition(
        &mut client,
        &temp.uri("consumer.sigil"),
        (from_use.0, from_use.1 + 5),
    );
    assert_eq!(found["uri"], earliest["uri"]);
    assert_eq!(found["range"]["start"], at_json(CLEAN, "Execution {", 0));
}

fn at_json(text: &str, needle: &str, nth: usize) -> Value {
    let (line, character) = at(text, needle, nth);
    json!({"line": line, "character": character})
}

#[test]
fn a_component_name_and_an_import_path_lead_to_the_provider() {
    let (temp, mut client) = started(&[("contract.sigil", CLEAN), ("consumer.sigil", CONSUMER)]);
    let provider = place(&temp, "contract.sigil", span(CLEAN, "Thing", 0));
    let consumer = temp.uri("consumer.sigil");
    // The provider name in the import, and the import path.
    assert_eq!(
        definition(&mut client, &consumer, at(CONSUMER, "Thing", 0)),
        provider
    );
    assert_eq!(
        definition(&mut client, &consumer, at(CONSUMER, "contract.sigil", 0)),
        provider
    );
    // The component's own name leads to itself.
    let own = place(&temp, "consumer.sigil", span(CONSUMER, "Consumer", 0));
    assert_eq!(
        definition(&mut client, &consumer, at(CONSUMER, "Consumer", 0)),
        own
    );
    // The words around the path and the keyword lead nowhere.
    assert_eq!(
        definition(&mut client, &consumer, at(CONSUMER, " from", 0)),
        Value::Null
    );
}

#[test]
fn a_glossary_occurrence_leads_to_its_glossary_entry() {
    let (temp, mut client) = started(&[
        (".sigil/glossary.json", GLOSSARY),
        ("booking.sigil", BOOKING),
    ]);
    let booking = temp.uri("booking.sigil");
    let entry = place(&temp, ".sigil/glossary.json", span(GLOSSARY, "hold", 0));
    // The canonical spelling and an alias both lead to the term.
    let (line, column) = at(BOOKING, "hold", 0);
    assert_eq!(definition(&mut client, &booking, (line, column)), entry);
    assert_eq!(
        definition(&mut client, &booking, at(BOOKING, "temporary", 0)),
        entry
    );
    // Protected inline code is not a glossary occurrence.
    assert_eq!(
        definition(&mut client, &booking, at(BOOKING, "temporary", 1)),
        Value::Null
    );
}

#[test]
fn a_link_label_a_payload_and_plain_text_lead_nowhere() {
    let (temp, mut client) = started(&[
        ("provider.sigil", INLINE_PROVIDER),
        ("consumer.sigil", MULTIWORD_CONSUMER),
    ]);
    let consumer = temp.uri("consumer.sigil");
    for (needle, nth) in [("café results", 2), ("café results", 3), ("Serve", 0)] {
        assert_eq!(
            definition(&mut client, &consumer, at(MULTIWORD_CONSUMER, needle, nth)),
            Value::Null,
            "{needle} #{nth}"
        );
    }
    // The emoji is not a name.
    assert_eq!(definition(&mut client, &consumer, (6, 0)), Value::Null);
}

#[test]
fn a_position_inside_a_line_ending_or_past_it_answers_null() {
    let (temp, mut client) = started(&[
        ("provider.sigil", INLINE_PROVIDER),
        ("consumer.sigil", MULTIWORD_CONSUMER),
    ]);
    let provider = temp.uri("provider.sigil");
    // Line 0 is `component Provider {` plus CRLF: column 20 is the CR, 21 the
    // LF, and neither is a character boundary of the text.
    let name = at(INLINE_PROVIDER, "Provider", 0);
    assert!(definition(&mut client, &provider, name).is_object());
    let end_of_line = 20;
    for column in [end_of_line + 1, end_of_line + 2, 500] {
        assert_eq!(
            definition(&mut client, &provider, (0, column)),
            Value::Null,
            "column {column}"
        );
    }
    assert_eq!(definition(&mut client, &provider, (500, 0)), Value::Null);
    // A position the protocol cannot carry in 32 bits is not found either.
    let huge = client.request(
        "textDocument/definition",
        json!({
            "textDocument": {"uri": provider},
            "position": {"line": 4_294_967_296u64, "character": 0},
        }),
    );
    assert_eq!(huge["result"], Value::Null);
}

#[test]
fn a_byte_order_mark_on_disk_shifts_line_zero_and_is_not_a_position() {
    let marked = format!("\u{feff}{INLINE_PROVIDER}");
    let (temp, mut client) = started(&[
        ("provider.sigil", &marked),
        ("consumer.sigil", MULTIWORD_CONSUMER),
    ]);
    let provider = temp.uri("provider.sigil");
    let name = place(&temp, "provider.sigil", range((0, 10), (0, 18)));
    // The editor shows `component Provider`: the name starts at column 10.
    assert_eq!(definition(&mut client, &provider, (0, 10)), name);
    assert_eq!(definition(&mut client, &provider, (0, 17)), name);
    assert_eq!(definition(&mut client, &provider, (0, 18)), Value::Null);
    // Other lines are not shifted.
    let inline = place(
        &temp,
        "provider.sigil",
        span(INLINE_PROVIDER, "café results", 0),
    );
    assert_eq!(
        definition(
            &mut client,
            &temp.uri("consumer.sigil"),
            at(MULTIWORD_CONSUMER, "café results", 1)
        ),
        inline
    );
    // The provider name in the consumer's import leads to the shifted name.
    assert_eq!(
        definition(
            &mut client,
            &temp.uri("consumer.sigil"),
            at(MULTIWORD_CONSUMER, "Provider", 0)
        ),
        name
    );
}

#[test]
fn a_buffer_has_no_mark_to_hide() {
    let (temp, mut client) = started(&[("provider.sigil", INLINE_PROVIDER)]);
    let provider = temp.uri("provider.sigil");
    let text = format!("\u{feff}{INLINE_PROVIDER}");
    client.open(&provider, 1, &text);
    // The editor's own text has the mark already stripped, so a buffer that
    // does carry one counts it.
    let name = place(&temp, "provider.sigil", range((0, 11), (0, 19)));
    assert_eq!(definition(&mut client, &provider, (0, 11)), name);
}

#[test]
fn a_file_outside_the_workspace_answers_null() {
    let (temp, mut client) = started(&[("provider.sigil", INLINE_PROVIDER)]);
    let outside = Temp::new();
    outside.write("elsewhere.sigil", INLINE_PROVIDER);
    for uri in [
        temp.uri("absent.sigil"),
        outside.uri("elsewhere.sigil"),
        temp.uri(".sigil/config.json"),
    ] {
        assert_eq!(definition(&mut client, &uri, (0, 10)), Value::Null, "{uri}");
    }
}

#[test]
fn a_missing_position_is_invalid_params() {
    let (temp, mut client) = started(&[("provider.sigil", INLINE_PROVIDER)]);
    let uri = temp.uri("provider.sigil");
    for params in [
        json!({"textDocument": {"uri": uri}}),
        json!({"textDocument": {"uri": uri}, "position": {"line": 0}}),
        json!({"textDocument": {"uri": uri}, "position": {"line": -1, "character": 0}}),
        json!({"position": {"line": 0, "character": 0}}),
        json!(null),
    ] {
        let response = client.request("textDocument/definition", params.clone());
        assert_eq!(response["error"]["code"], -32602, "{params}");
    }
    let missing = client.request(
        "textDocument/definition",
        json!({"textDocument": {"uri": uri}}),
    );
    assert_eq!(missing["error"]["message"], "position must be an object.");
    let half = client.request(
        "textDocument/definition",
        json!({"textDocument": {"uri": uri}, "position": {"line": 0}}),
    );
    assert_eq!(
        half["error"]["message"],
        "Position requires non-negative line and character values."
    );
}

#[test]
fn a_uri_that_is_not_a_file_is_an_internal_error() {
    let (_temp, mut client) = started(&[("provider.sigil", INLINE_PROVIDER)]);
    let response = client.request(
        "textDocument/definition",
        json!({
            "textDocument": {"uri": "http://example.com/x.sigil"},
            "position": {"line": 0, "character": 0},
        }),
    );
    assert_eq!(response["error"]["code"], -32603);
}
