#![cfg(unix)]
//! Document symbols and semantic tokens: the tree and its kinds, exact UTF-16
//! token lengths, what is left out, and the empty answers.
mod support;

use serde_json::{Value, json};
use support::{CLEAN, CONSUMER, Client, Temp, replay};

const MULTIWORD_CONSUMER: &str = "@provider.sigil from Provider import { café results }\ncomponent Consumer {\ngoal {\nServe the caller.\n}\ninterface {\n😀 Use café results now.\n\nRead [café results](./notes.md).\n```text\ncafé results\n```\n}\n}\n";

const INLINE_PROVIDER: &str = "component Provider {\r\ngoal {\r\nOwn vocabulary.\r\n}\r\ninterface {\r\n😀 A *café results* carries a response.\r\n}\r\nconstraints {\r\ncafé results {\r\nPreserve exact content.\r\n}\r\n}\r\n}\r\n";

const BOOKING: &str = "component Booking {\n  goal {\n    A temporary reservation creates a hold.\n\n    Ignore `temporary reservation`.\n  }\n\n  interface {\n    BookingTerm {\n      The hold remains visible.\n    }\n  }\n}\n";

const GLOSSARY: &str = "{\"schemaVersion\":1,\"terms\":[],\"contexts\":[{\"id\":\"booking\",\"include\":[\"**/*.sigil\"],\"exclude\":[],\"terms\":[{\"term\":\"hold\",\"definition\":\"Booking capacity before confirmation.\",\"aliases\":[\"temporary reservation\"]}]}]}";

/// An inline Tag before a group heading in one section, and a group heading
/// before an inline Tag in the next.
const MIXED: &str = "component Thing {\n  goal {\n    Represent one useful Alpha.\n  }\n\n  state {\n    A *Beta* comes first.\n\n    Alpha {\n      Alpha stays.\n    }\n  }\n\n  interface {\n    Alpha {\n      run() starts an Alpha.\n    }\n\n    A *Gamma* comes last.\n  }\n}\n";

fn started(files: &[(&str, &str)]) -> (Temp, Client) {
    let temp = Temp::workspace();
    for (path, text) in files {
        temp.write(path, text);
    }
    let mut client = Client::at(&temp.root);
    client.start(&temp);
    (temp, client)
}

fn answer(client: &mut Client, method: &str, uri: &str) -> Value {
    let response = client.request(method, json!({"textDocument": {"uri": uri}}));
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

fn symbols(client: &mut Client, uri: &str) -> Value {
    answer(client, "textDocument/documentSymbol", uri)
}

/// The decoded tokens of a document: (line, column, length, type).
fn tokens(client: &mut Client, uri: &str) -> Vec<(u64, u64, u64, u64)> {
    let result = answer(client, "textDocument/semanticTokens/full", uri);
    let data: Vec<u64> = result["data"]
        .as_array()
        .expect("token data")
        .iter()
        .map(|n| n.as_u64().unwrap())
        .collect();
    assert_eq!(data.len() % 5, 0);
    let (mut line, mut column) = (0, 0);
    data.chunks(5)
        .map(|token| {
            line += token[0];
            column = if token[0] == 0 {
                column + token[1]
            } else {
                token[1]
            };
            assert_eq!(token[4], 0, "no modifiers");
            (line, column, token[2], token[3])
        })
        .collect()
}

/// The UTF-16 slice of a line, to check a token against the text it covers.
fn covered(text: &str, token: (u64, u64, u64, u64)) -> String {
    let line = text.lines().nth(token.0 as usize).expect("the line exists");
    let units: Vec<u16> = line.encode_utf16().collect();
    String::from_utf16(&units[token.1 as usize..(token.1 + token.2) as usize]).unwrap()
}

fn names(children: &Value) -> Vec<(String, String)> {
    children
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["name"].as_str().unwrap().to_owned(),
                c["detail"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

fn pair(name: &str, detail: &str) -> (String, String) {
    (name.to_owned(), detail.to_owned())
}

#[test]
fn symbols_nest_components_sections_groups_and_inline_tags_with_their_kinds() {
    let (temp, mut client) = started(&[("thing.sigil", MIXED)]);
    let result = symbols(&mut client, &temp.uri("thing.sigil"));
    let component = &result[0];
    assert_eq!(result.as_array().unwrap().len(), 1);
    assert_eq!(component["name"], "Thing");
    assert_eq!(component["detail"], "component");
    assert_eq!(component["kind"], 5);
    assert_eq!(
        component["range"],
        json!({"start": {"line": 0, "character": 0}, "end": {"line": 21, "character": 0}})
    );
    assert_eq!(
        component["selectionRange"],
        json!({"start": {"line": 0, "character": 10}, "end": {"line": 0, "character": 15}})
    );
    let sections = &component["children"];
    assert_eq!(
        names(sections),
        [
            pair("goal", "section"),
            pair("state", "section"),
            pair("interface", "section")
        ]
    );
    assert!(sections.as_array().unwrap().iter().all(|s| s["kind"] == 7));
    assert_eq!(sections[0]["children"], json!([]));
    // The inline Tag comes before the group heading in one section and after
    // it in the other: children follow the source.
    assert_eq!(
        names(&sections[1]["children"]),
        [pair("Beta", "inline Tag"), pair("Alpha", "Tag group")]
    );
    assert_eq!(
        names(&sections[2]["children"]),
        [pair("Alpha", "Tag group"), pair("Gamma", "inline Tag")]
    );
    for child in sections[1]["children"].as_array().unwrap() {
        assert_eq!(child["kind"], 7);
        assert_eq!(child["children"], json!([]));
    }
    // The selection of an inline Tag is its name inside the asterisks.
    assert_eq!(
        sections[1]["children"][0]["selectionRange"],
        json!({"start": {"line": 6, "character": 7}, "end": {"line": 6, "character": 11}})
    );
    assert_eq!(
        sections[1]["children"][0]["range"],
        json!({"start": {"line": 6, "character": 6}, "end": {"line": 6, "character": 12}})
    );
    // A group's range runs from its heading to its closing line.
    assert_eq!(
        sections[1]["children"][1]["selectionRange"],
        json!({"start": {"line": 8, "character": 4}, "end": {"line": 8, "character": 9}})
    );
}

#[test]
fn symbols_list_every_component_of_a_file_and_use_utf16_columns() {
    let (temp, mut client) = started(&[
        ("provider.sigil", INLINE_PROVIDER),
        (
            "two.sigil",
            &format!("{CLEAN}\n{}", CLEAN.replace("Thing", "Other")),
        ),
    ]);
    let provider = symbols(&mut client, &temp.uri("provider.sigil"));
    let interface = &provider[0]["children"][1];
    assert_eq!(interface["name"], "interface");
    // The emoji is two units: the Tag starts after `😀 A `.
    assert_eq!(
        interface["children"][0]["selectionRange"],
        json!({"start": {"line": 5, "character": 6}, "end": {"line": 5, "character": 18}})
    );
    let constraints = &provider[0]["children"][2];
    assert_eq!(
        names(&constraints["children"]),
        [pair("café results", "Tag group")]
    );

    let two = symbols(&mut client, &temp.uri("two.sigil"));
    let found: Vec<&str> = two
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(found, ["Thing", "Other"]);
}

#[test]
fn symbols_of_a_file_outside_the_workspace_are_empty() {
    let (temp, mut client) = started(&[("thing.sigil", CLEAN)]);
    let outside = Temp::new();
    outside.write("elsewhere.sigil", CLEAN);
    for uri in [
        temp.uri("absent.sigil"),
        outside.uri("elsewhere.sigil"),
        temp.uri(".sigil/config.json"),
    ] {
        assert_eq!(symbols(&mut client, &uri), json!([]), "{uri}");
    }
}

#[test]
fn symbols_of_an_open_buffer_follow_its_text() {
    let (temp, mut client) = started(&[("thing.sigil", CLEAN)]);
    let uri = temp.uri("thing.sigil");
    client.open(&uri, 1, &CLEAN.replace("Thing", "Renamed"));
    assert_eq!(symbols(&mut client, &uri)[0]["name"], "Renamed");
    client.close(&uri);
    assert_eq!(symbols(&mut client, &uri)[0]["name"], "Thing");
}

#[test]
fn symbols_hide_a_disk_byte_order_mark_and_start_the_file_at_zero() {
    let marked = format!("\u{feff}{INLINE_PROVIDER}");
    let (temp, mut client) = started(&[("provider.sigil", &marked)]);
    let uri = temp.uri("provider.sigil");
    let result = symbols(&mut client, &uri);
    // The component begins at the mark, which is not a position: it starts at
    // the first visible one, and its name is where the editor shows it.
    assert_eq!(
        result[0]["range"]["start"],
        json!({"line": 0, "character": 0})
    );
    assert_eq!(
        result[0]["selectionRange"],
        json!({"start": {"line": 0, "character": 10}, "end": {"line": 0, "character": 18}})
    );
    // An open buffer keeps what the editor sent.
    client.open(&uri, 1, &marked);
    let buffer = symbols(&mut client, &uri);
    assert_eq!(
        buffer[0]["selectionRange"]["start"],
        json!({"line": 0, "character": 11})
    );
}

#[test]
fn the_recorded_symbols_of_a_marked_file_are_compared_one_unit_to_the_left() {
    let scenario = replay::Scenario {
        name: "marked".to_owned(),
        feature: "bom".to_owned(),
        files: [("a.sigil".to_owned(), "\u{feff}component A {}".to_owned())].into(),
        steps: Vec::new(),
    };
    let request = json!({
        "method": "textDocument/documentSymbol",
        "params": {"textDocument": {"uri": "file:///tmp/a.sigil"}},
    });
    let symbol = json!({
        "range": {"start": {"line": 0, "character": 0}, "end": {"line": 1, "character": 0}},
        "selectionRange": {"start": {"line": 0, "character": 11}, "end": {"line": 0, "character": 12}},
        "children": [{
            "range": {"start": {"line": 1, "character": 4}, "end": {"line": 1, "character": 5}},
            "selectionRange": {"start": {"line": 1, "character": 4}, "end": {"line": 1, "character": 5}},
        }],
    });
    let mut response = json!({"result": [symbol.clone()]});
    replay::symbols_without_disk_bom(&scenario, &request, &mut response);
    let moved = &response["result"][0];
    assert_eq!(moved["range"], symbol["range"]);
    assert_eq!(
        moved["selectionRange"]["start"],
        json!({"line": 0, "character": 10})
    );
    assert_eq!(moved["children"], symbol["children"]);

    // Another file, another method, or an error are left as recorded.
    let other = json!({
        "method": "textDocument/documentSymbol",
        "params": {"textDocument": {"uri": "file:///tmp/b.sigil"}},
    });
    let mut untouched = json!({"result": [symbol.clone()]});
    replay::symbols_without_disk_bom(&scenario, &other, &mut untouched);
    assert_eq!(untouched, json!({"result": [symbol]}));
    let mut error = json!({"error": {"code": -32603}});
    replay::symbols_without_disk_bom(&scenario, &request, &mut error);
    assert_eq!(error, json!({"error": {"code": -32603}}));
}

#[test]
fn a_missing_document_is_invalid_params_for_symbols_and_tokens() {
    let (_temp, mut client) = started(&[("thing.sigil", CLEAN)]);
    for method in [
        "textDocument/documentSymbol",
        "textDocument/semanticTokens/full",
    ] {
        for params in [json!({}), json!({"textDocument": {}}), json!(null)] {
            let response = client.request(method, params.clone());
            assert_eq!(response["error"]["code"], -32602, "{method} {params}");
        }
    }
}

#[test]
fn token_lengths_cover_exactly_the_utf16_text_after_an_emoji() {
    let (temp, mut client) = started(&[
        ("provider.sigil", INLINE_PROVIDER),
        ("consumer.sigil", MULTIWORD_CONSUMER),
    ]);
    let found = tokens(&mut client, &temp.uri("consumer.sigil"));
    // The provider name and the selected Tag in the import, the component's
    // own name, then the use in prose after `😀 Use `, seven units in.
    assert_eq!(
        found,
        [(0, 21, 8, 0), (0, 39, 12, 1), (1, 10, 8, 0), (6, 7, 12, 1)]
    );
    for token in &found {
        let text = covered(MULTIWORD_CONSUMER, *token);
        assert!(
            ["Provider", "Consumer", "café results"].contains(&text.as_str()),
            "{text}"
        );
    }
    // The provider: its component name, the inline definition after the emoji
    // and the later group heading.
    let found = tokens(&mut client, &temp.uri("provider.sigil"));
    assert_eq!(found, [(0, 10, 8, 0), (5, 6, 12, 1), (8, 0, 12, 1)]);
    assert_eq!(covered(INLINE_PROVIDER, found[1]), "café results");
}

#[test]
fn protected_content_has_no_tokens() {
    let (temp, mut client) = started(&[
        ("provider.sigil", INLINE_PROVIDER),
        ("consumer.sigil", MULTIWORD_CONSUMER),
    ]);
    let found = tokens(&mut client, &temp.uri("consumer.sigil"));
    // Lines 8 to 10 hold a link label, and a fenced payload with the Tag.
    assert!(found.iter().all(|(line, ..)| *line < 8), "{found:?}");
}

#[test]
fn a_glossary_term_inside_a_tag_range_gives_one_token() {
    // The Tag `hold request` contains the term `hold`.
    let source = "component Booking {\n  goal {\n    Keep a hold.\n  }\n\n  interface {\n    A *hold request* is kept.\n  }\n}\n";
    let (temp, mut client) = started(&[
        (".sigil/glossary.json", GLOSSARY),
        ("booking.sigil", source),
    ]);
    let found = tokens(&mut client, &temp.uri("booking.sigil"));
    assert_eq!(
        found,
        [
            (0, 10, 7, 0),
            // Outside any Tag, the term stands alone.
            (2, 11, 4, 2),
            // Inside the Tag it does not.
            (6, 7, 12, 1),
        ]
    );
    assert_eq!(covered(source, found[2]), "hold request");
}

#[test]
fn a_glossary_term_and_its_alias_are_term_tokens() {
    let (temp, mut client) = started(&[
        (".sigil/glossary.json", GLOSSARY),
        ("booking.sigil", BOOKING),
    ]);
    let found = tokens(&mut client, &temp.uri("booking.sigil"));
    assert_eq!(
        found.iter().map(|t| t.3).collect::<Vec<_>>(),
        [0, 2, 2, 1, 2],
        "{found:?}"
    );
    assert_eq!(covered(BOOKING, found[1]), "temporary reservation");
    assert_eq!(covered(BOOKING, found[2]), "hold");
    assert_eq!(covered(BOOKING, found[3]), "BookingTerm");
    assert_eq!(covered(BOOKING, found[4]), "hold");
    // The code span in line 4 is protected.
    assert!(found.iter().all(|(line, ..)| *line != 4));
}

#[test]
fn tokens_hide_a_disk_byte_order_mark() {
    let marked = format!("\u{feff}{INLINE_PROVIDER}");
    let (temp, mut client) = started(&[("provider.sigil", &marked)]);
    let uri = temp.uri("provider.sigil");
    assert_eq!(
        tokens(&mut client, &uri),
        [(0, 10, 8, 0), (5, 6, 12, 1), (8, 0, 12, 1)]
    );
    client.open(&uri, 1, &marked);
    assert_eq!(tokens(&mut client, &uri)[0], (0, 11, 8, 0));
}

#[test]
fn tokens_of_a_file_outside_the_workspace_are_empty() {
    let (temp, mut client) = started(&[("thing.sigil", CLEAN)]);
    let outside = Temp::new();
    outside.write("elsewhere.sigil", CLEAN);
    for uri in [
        temp.uri("absent.sigil"),
        outside.uri("elsewhere.sigil"),
        temp.uri(".sigil/config.json"),
    ] {
        let result = answer(&mut client, "textDocument/semanticTokens/full", &uri);
        assert_eq!(result, json!({"data": []}), "{uri}");
    }
}

#[test]
fn a_consumer_import_selection_is_a_tag_token_with_its_provider_name() {
    let (temp, mut client) = started(&[("contract.sigil", CLEAN), ("consumer.sigil", CONSUMER)]);
    let found = tokens(&mut client, &temp.uri("consumer.sigil"));
    assert_eq!(covered(CONSUMER, found[0]), "Thing");
    assert_eq!(found[0].3, 0);
    assert_eq!(covered(CONSUMER, found[1]), "Execution");
    assert_eq!(found[1].3, 1);
    // Every later use of the Tag in prose is a Tag token.
    let uses: Vec<_> = found.iter().filter(|t| t.3 == 1).collect();
    assert!(uses.len() >= 3, "{found:?}");
    assert!(uses.iter().all(|t| {
        // The heading of `ConsumerSurface` is the Tag's own introduction.
        ["Execution", "ConsumerSurface"].contains(&covered(CONSUMER, **t).as_str())
    }));
}
