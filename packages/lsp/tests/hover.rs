#![cfg(unix)]
//! Hover: what each kind of position shows, with the contract's Facets and the
//! glossary entry, never implementation ownership. The recorded sessions of
//! the TypeScript server are replayed at the end.
mod support;

use serde_json::{Value, json};
use support::{CLEAN, CONSUMER, Client, Temp, replay::replay_features};

const GLOSSARY: &str = "{\n  \"schemaVersion\": 1,\n  \"terms\": [\n    {\n      \"term\": \"Execution\",\n      \"definition\": \"One run of the provider.\",\n      \"aliases\": []\n    }\n  ],\n  \"contexts\": [\n    {\n      \"id\": \"booking\",\n      \"include\": [\"booking.sigil\"],\n      \"exclude\": [],\n      \"terms\": [\n        {\n          \"term\": \"hold\",\n          \"definition\": \"Booking capacity before confirmation.\",\n          \"aliases\": [\"temporary reservation\"]\n        },\n        {\n          \"term\": \"Booking charge\",\n          \"definition\": \"What a booking costs.\",\n          \"aliases\": [\"bookingterm\"]\n        }\n      ]\n    }\n  ]\n}\n";

const BOOKING: &str = "component Booking {\n  goal {\n    A temporary reservation creates a hold.\n  }\n\n  interface {\n    BookingTerm {\n      The hold remains visible.\n    }\n  }\n}\n";

/// A source file that claims to implement the provider's Tag.
const ANNOTATED: &str = "// @sigil implements contract.sigil::Thing::Execution interface\nexport const run = () => 1;\n";

/// A consumer that also has a Facet about something else.
const PLAIN_CONSUMER: &str = "@contract.sigil from Thing import { Execution }\n\ncomponent Consumer {\n  goal {\n    Consume the provider contract for Execution.\n\n    Say hello.\n  }\n}\n";

/// The (line, UTF-16 column) of the `nth` occurrence of `needle` in a text
/// whose line endings are all `\n`.
fn at(text: &str, needle: &str, nth: usize) -> (u32, u32) {
    let offset = text
        .match_indices(needle)
        .nth(nth)
        .unwrap_or_else(|| panic!("{needle:?} #{nth} is not in the text"))
        .0;
    let before = &text[..offset];
    let line = before.matches('\n').count() as u32;
    let start = before.rfind('\n').map_or(0, |i| i + 1);
    (line, before[start..].encode_utf16().count() as u32)
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

fn hover(client: &mut Client, uri: &str, position: (u32, u32)) -> Value {
    let response = client.request(
        "textDocument/hover",
        json!({
            "textDocument": {"uri": uri},
            "position": {"line": position.0, "character": position.1},
        }),
    );
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

fn markdown(hover: &Value) -> &str {
    assert_eq!(hover["contents"]["kind"], "markdown");
    hover["contents"]["value"].as_str().expect("markdown")
}

fn link(label: &str, uri: &str, line: u32, column: u32) -> String {
    format!("[{label}]({uri}#L{line},{column})")
}

#[test]
fn a_tag_on_a_consumer_shows_origin_provider_consumer_and_glossary_without_ownership() {
    let (temp, mut client) = started(&[
        ("contract.sigil", CLEAN),
        ("consumer.sigil", CONSUMER),
        ("impl.ts", ANNOTATED),
        (".sigil/glossary.json", GLOSSARY),
    ]);
    let contract = temp.uri("contract.sigil");
    let consumer = temp.uri("consumer.sigil");
    let tag = link("Execution", &contract, 7, 5);
    let found = hover(&mut client, &consumer, at(CONSUMER, "Execution", 3));
    let expected = [
        format!("### Tag {tag}"),
        String::new(),
        format!(
            "Origin: {} in `contract.sigil`",
            link("Thing", &contract, 1, 11)
        ),
        String::new(),
        format!("### component {}", link("Thing", &contract, 1, 11)),
        String::new(),
        "Source: `contract.sigil`".to_owned(),
        String::new(),
        "**Goal**".to_owned(),
        format!("- Represent one useful {tag}."),
        String::new(),
        "**Cases**".to_owned(),
        format!("- Running succeeds. Each {tag} ends."),
        String::new(),
        "**Interface**".to_owned(),
        format!("- run() starts an {tag}."),
        String::new(),
        format!("**Consumer: {}**", link("Consumer", &consumer, 3, 11)),
        "**goal**".to_owned(),
        format!("- Consume the provider contract for {tag}."),
        "**constraints**".to_owned(),
        format!("- Consumer retries preserve {tag}."),
        "**interface**".to_owned(),
        format!("- run() uses {tag}."),
        "**interface**".to_owned(),
        format!("- execution and ExecutionCache remain prose\n      beside {tag}."),
        String::new(),
        "### term Execution".to_owned(),
        String::new(),
        "One run of the provider.".to_owned(),
        String::new(),
        "Scope: workspace".to_owned(),
    ]
    .join("\n");
    assert_eq!(markdown(&found), expected);
    assert!(!markdown(&found).contains("Owned implementations"));
    let from = at(CONSUMER, "Execution", 3);
    assert_eq!(
        found["range"],
        json!({
            "start": {"line": from.0, "character": from.1},
            "end": {"line": from.0, "character": from.1 + 9},
        })
    );
}

#[test]
fn an_import_selection_shows_the_same_tag_hover() {
    let (temp, mut client) = started(&[("contract.sigil", CLEAN), ("consumer.sigil", CONSUMER)]);
    let found = hover(&mut client, &temp.uri("consumer.sigil"), (0, 36));
    let text = markdown(&found);
    assert!(text.starts_with("### Tag [Execution]"), "{text}");
    assert!(text.contains("**Consumer: [Consumer]"), "{text}");
    assert_eq!(found["range"]["start"], json!({"line": 0, "character": 36}));
}

#[test]
fn a_provider_s_own_introduction_has_no_consumer_block() {
    let (temp, mut client) = started(&[("contract.sigil", CLEAN), ("consumer.sigil", CONSUMER)]);
    let found = hover(
        &mut client,
        &temp.uri("contract.sigil"),
        at(CLEAN, "Execution {", 0),
    );
    let text = markdown(&found);
    assert!(text.starts_with("### Tag [Execution]"), "{text}");
    assert!(text.contains("### component [Thing]"), "{text}");
    assert!(!text.contains("Consumer:"), "{text}");
    assert!(!text.contains("### term"), "{text}");
}

#[test]
fn a_consumer_lists_only_the_facets_that_concern_the_tag() {
    let (temp, mut client) = started(&[
        ("contract.sigil", CLEAN),
        ("consumer.sigil", PLAIN_CONSUMER),
    ]);
    let found = hover(
        &mut client,
        &temp.uri("consumer.sigil"),
        at(PLAIN_CONSUMER, "Execution", 1),
    );
    let text = markdown(&found);
    assert!(
        text.contains("**goal**\n- Consume the provider contract for [Execution]"),
        "{text}"
    );
    assert!(!text.contains("Say hello."), "{text}");
}

#[test]
fn a_glossary_alias_shows_the_matched_alias_and_its_context() {
    let (temp, mut client) = started(&[
        ("booking.sigil", BOOKING),
        (".sigil/glossary.json", GLOSSARY),
    ]);
    let uri = temp.uri("booking.sigil");
    let alias = hover(&mut client, &uri, at(BOOKING, "temporary reservation", 0));
    assert_eq!(
        markdown(&alias),
        "### term hold\n\nBooking capacity before confirmation.\n\nBounded context: `booking`\n\nMatched alias: `temporary reservation`"
    );
    let from = at(BOOKING, "temporary reservation", 0);
    assert_eq!(
        alias["range"],
        json!({
            "start": {"line": from.0, "character": from.1},
            "end": {"line": from.0, "character": from.1 + 21},
        })
    );
    let canonical = hover(&mut client, &uri, at(BOOKING, "hold", 0));
    assert_eq!(
        markdown(&canonical),
        "### term hold\n\nBooking capacity before confirmation.\n\nBounded context: `booking`"
    );
}

#[test]
fn a_workspace_term_shows_its_scope() {
    let (temp, mut client) = started(&[
        ("contract.sigil", CLEAN),
        (".sigil/glossary.json", GLOSSARY),
    ]);
    // The second `Execution` is prose of the first Facet, not a Tag use.
    let found = hover(
        &mut client,
        &temp.uri("contract.sigil"),
        at(CLEAN, "Execution.", 0),
    );
    assert!(
        markdown(&found)
            .contains("### term Execution\n\nOne run of the provider.\n\nScope: workspace")
    );
}

#[test]
fn a_tag_whose_name_matches_a_term_shows_both() {
    let (temp, mut client) = started(&[
        ("booking.sigil", BOOKING),
        (".sigil/glossary.json", GLOSSARY),
    ]);
    let found = hover(
        &mut client,
        &temp.uri("booking.sigil"),
        at(BOOKING, "BookingTerm {", 0),
    );
    let text = markdown(&found);
    assert!(text.starts_with("### Tag [BookingTerm]"), "{text}");
    assert!(
        text.ends_with(
            "### term Booking charge\n\nWhat a booking costs.\n\nBounded context: `booking`\n\nMatched alias: `BookingTerm`"
        ),
        "{text}"
    );
}

#[test]
fn a_component_name_and_an_import_provider_show_the_contract() {
    let (temp, mut client) = started(&[("contract.sigil", CLEAN), ("consumer.sigil", CONSUMER)]);
    let contract = temp.uri("contract.sigil");
    let consumer = temp.uri("consumer.sigil");
    let on_name = hover(&mut client, &consumer, at(CONSUMER, "Consumer", 0));
    let text = markdown(&on_name);
    assert!(
        text.starts_with(&format!(
            "### component {}\n\nSource: `consumer.sigil`\n\n**Goal**",
            link("Consumer", &consumer, 3, 11)
        )),
        "{text}"
    );
    assert!(!text.contains("Consumer:"), "{text}");
    let from = at(CONSUMER, "Consumer", 0);
    assert_eq!(
        on_name["range"]["start"],
        json!({"line": from.0, "character": from.1})
    );
    let on_import = hover(&mut client, &consumer, at(CONSUMER, "Thing", 0));
    let text = markdown(&on_import);
    assert!(
        text.starts_with(&format!(
            "### component {}\n\nSource: `contract.sigil`\n\n**Goal**",
            link("Thing", &contract, 1, 11)
        )),
        "{text}"
    );
}

#[test]
fn nothing_is_shown_for_whitespace_other_prose_or_other_files() {
    let (temp, mut client) = started(&[("contract.sigil", CLEAN), ("consumer.sigil", CONSUMER)]);
    let consumer = temp.uri("consumer.sigil");
    assert_eq!(hover(&mut client, &consumer, (1, 0)), Value::Null);
    assert_eq!(hover(&mut client, &consumer, (4, 6)), Value::Null);
    assert_eq!(hover(&mut client, &consumer, (200, 0)), Value::Null);
    assert_eq!(
        hover(&mut client, &temp.uri("elsewhere.sigil"), (0, 0)),
        Value::Null
    );
}

#[test]
fn no_hover_in_a_workspace_mentions_ownership() {
    let (temp, mut client) = started(&[
        ("contract.sigil", CLEAN),
        ("consumer.sigil", CONSUMER),
        ("impl.ts", ANNOTATED),
    ]);
    for (path, text) in [("contract.sigil", CLEAN), ("consumer.sigil", CONSUMER)] {
        let uri = temp.uri(path);
        for (line, row) in text.lines().enumerate() {
            for character in 0..=row.chars().count() {
                let found = hover(&mut client, &uri, (line as u32, character as u32));
                if !found.is_null() {
                    let text = markdown(&found);
                    assert!(!text.contains("Owned implementations"), "{text}");
                    assert!(!text.contains("impl.ts"), "{text}");
                }
            }
        }
    }
}

#[test]
fn the_recorded_hover_and_render_sessions_replay_green() {
    let tally = replay_features(&["hover", "render", "glossary", "bom"]);
    assert!(tally.scenarios >= 10 && tally.compared >= 60, "{tally:?}");
    assert!(tally.failures.is_empty(), "{}", tally.failures.join("\n\n"));
}
