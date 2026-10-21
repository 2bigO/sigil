#![cfg(unix)]
//! The shared Markdown renderer and `sigil.renderDocument`: link resolution,
//! escaping, literal blocks and the command's answers.
mod support;

use serde_json::{Value, json};
use sigil_lsp::render::{escape_markdown, resolve_link};
use support::{CLEAN, CONSUMER, Client, started};

const BASE: &str = "file:///workspace/dir/a.sigil";

#[test]
fn links_resolve_like_the_url_parser_of_the_typescript_server() {
    // Expected values are `new URL(destination, base).href` in Deno 2.9, then
    // `(`, `)` and `>` percent-encoded.
    let cases: &[(&str, Option<&str>)] = &[
        (
            "./notes (v2).md",
            Some("file:///workspace/dir/notes%20%28v2%29.md"),
        ),
        ("./image.svg", Some("file:///workspace/dir/image.svg")),
        ("../x.md", Some("file:///workspace/x.md")),
        ("../../../../x.md", Some("file:///x.md")),
        ("/abs/p q.md", Some("file:///abs/p%20q.md")),
        ("#frag", Some("file:///workspace/dir/a.sigil#frag")),
        ("?q=1 2", Some("file:///workspace/dir/a.sigil?q=1%202")),
        ("", Some("file:///workspace/dir/a.sigil")),
        ("a/./b/../c.md", Some("file:///workspace/dir/a/c.md")),
        ("a/b/..", Some("file:///workspace/dir/a/")),
        ("a/b/.", Some("file:///workspace/dir/a/b/")),
        ("a/%2e%2E/c", Some("file:///workspace/dir/c")),
        (
            "notes.md#sec tion",
            Some("file:///workspace/dir/notes.md#sec%20tion"),
        ),
        (
            "notes.md?x=a b#y z",
            Some("file:///workspace/dir/notes.md?x=a%20b#y%20z"),
        ),
        ("https://Example.COM", Some("https://example.com/")),
        (
            "https://Example.COM:443/a b?q c#f g",
            Some("https://example.com/a%20b?q%20c#f%20g"),
        ),
        ("http://a.b:80/", Some("http://a.b/")),
        ("http://a.b:8080/x", Some("http://a.b:8080/x")),
        ("https://example.com/a/../b", Some("https://example.com/b")),
        ("HTTP://x.y/%41 b", Some("http://x.y/%41%20b")),
        ("mailto:Foo@Bar.com", Some("mailto:Foo@Bar.com")),
        ("mailto:a b", Some("mailto:a b")),
        ("data:text/plain,hi there", Some("data:text/plain,hi there")),
        ("tel:+1 555", Some("tel:+1 555")),
        ("file:///x/y z", Some("file:///x/y%20z")),
        ("file:rel.md", Some("file:///workspace/dir/rel.md")),
        ("file:/abs.md", Some("file:///abs.md")),
        ("//host/share/x", Some("file://host/share/x")),
        ("a\\b\\c.md", Some("file:///workspace/dir/a/b/c.md")),
        ("\\abs.md", Some("file:///abs.md")),
        ("café.md", Some("file:///workspace/dir/caf%C3%A9.md")),
        (
            "a^b|c{d}e`f\"g<h>i.md",
            Some("file:///workspace/dir/a^b|c%7Bd%7De%60f%22g%3Ch%3Ei.md"),
        ),
        (
            "a'b.md?c'd#e'f",
            Some("file:///workspace/dir/a'b.md?c%27d#e'f"),
        ),
        ("e`d", Some("file:///workspace/dir/e%60d")),
        (
            "x.md#a`b\"c<d>",
            Some("file:///workspace/dir/x.md#a%60b%22c%3Cd%3E"),
        ),
        ("C:\\x.md", Some("c:\\x.md")),
        ("C:/x.md", Some("c:/x.md")),
        (" lead.md ", Some("file:///workspace/dir/lead.md")),
        ("tab\tbed.md", Some("file:///workspace/dir/tabbed.md")),
        ("a%zz.md", Some("file:///workspace/dir/a%zz.md")),
        ("a%20b.md", Some("file:///workspace/dir/a%20b.md")),
        ("http://", None),
        ("http://user:pw@Host/x", Some("http://user:pw@host/x")),
        ("http://[::1]:80/x", Some("http://[::1]/x")),
        ("ftp://h/x", Some("ftp://h/x")),
        ("https://exa mple.com", None),
        ("https://example.com:99999", None),
        ("http://a.b?x", Some("http://a.b/?x")),
        ("http://a.b#x", Some("http://a.b/#x")),
        ("http:a.b/x", Some("http://a.b/x")),
        ("http:\\\\a.b\\x", Some("http://a.b/x")),
        ("a(b).md", Some("file:///workspace/dir/a%28b%29.md")),
        ("a<b", Some("file:///workspace/dir/a%3Cb")),
    ];
    for (destination, expected) in cases {
        assert_eq!(
            resolve_link(destination, BASE).as_deref(),
            *expected,
            "{destination:?}"
        );
    }
}

#[test]
fn the_documented_link_cases_keep_label_and_title_text() {
    assert_eq!(
        resolve_link("./notes (v2).md", "file:///workspace/a.sigil").as_deref(),
        Some("file:///workspace/notes%20%28v2%29.md")
    );
    assert_eq!(
        resolve_link("./image.svg", "file:///workspace/a.sigil").as_deref(),
        Some("file:///workspace/image.svg")
    );
}

#[test]
fn a_base_with_an_encoded_directory_keeps_its_encoding() {
    assert_eq!(
        resolve_link("../x y.md", "file:///my%20dir/sub/a.sigil").as_deref(),
        Some("file:///my%20dir/x%20y.md")
    );
}

#[test]
fn markdown_specials_in_labels_are_escaped() {
    assert_eq!(
        escape_markdown("a_b*c`d[e]f\\g"),
        "a\\_b\\*c\\`d\\[e\\]f\\\\g"
    );
    assert_eq!(escape_markdown("plain text <>&"), "plain text <>&");
}

fn render(client: &mut Client, arguments: Value) -> Value {
    client.request(
        "workspace/executeCommand",
        json!({"command": "sigil.renderDocument", "arguments": arguments}),
    )
}

fn rendered(client: &mut Client, uri: &str) -> String {
    let response = render(client, json!([uri]));
    assert!(response.get("error").is_none(), "{response}");
    response["result"].as_str().expect("a string").to_owned()
}

const TWO_COMPONENTS: &str = "component First {\n  goal {\n    Be first.\n  }\n}\n\ncomponent Second {\n  goal {\n    Be second.\n  }\n}\n";

#[test]
fn a_file_with_two_components_joins_them_with_a_rule() {
    let (temp, mut client) = started(&[("pair.sigil", TWO_COMPONENTS)]);
    let uri = temp.uri("pair.sigil");
    let text = rendered(&mut client, &uri);
    let first = format!(
        "### component [First]({uri}#L1,11)\n\nSource: `pair.sigil`\n\n**Goal**\n- Be first."
    );
    let second = format!(
        "### component [Second]({uri}#L7,11)\n\nSource: `pair.sigil`\n\n**Goal**\n- Be second."
    );
    assert_eq!(text, format!("{first}\n\n---\n\n{second}"));
}

#[test]
fn a_consumer_renders_its_own_components_with_tag_links() {
    let (temp, mut client) = started(&[("contract.sigil", CLEAN), ("consumer.sigil", CONSUMER)]);
    let text = rendered(&mut client, &temp.uri("consumer.sigil"));
    let tag = format!("[Execution]({}#L7,5)", temp.uri("contract.sigil"));
    assert!(text.starts_with(&format!(
        "### component [Consumer]({}#L3,11)\n\nSource: `consumer.sigil`\n\n**Goal**\n- Consume the provider contract for {tag}.",
        temp.uri("consumer.sigil")
    )));
    assert!(text.contains(&format!("**Interface**\n- run() uses {tag}.\n- execution and ExecutionCache remain prose\n      beside {tag}.")));
    assert!(!text.contains("---"));
}

#[test]
fn a_file_without_components_or_outside_the_workspace_renders_empty() {
    let (temp, mut client) = started(&[("empty.sigil", "\n"), ("a.sigil", TWO_COMPONENTS)]);
    assert_eq!(rendered(&mut client, &temp.uri("empty.sigil")), "");
    assert_eq!(rendered(&mut client, &temp.uri("missing.sigil")), "");
    assert_eq!(rendered(&mut client, "file:///elsewhere/x.sigil"), "");
}

#[test]
fn the_command_checks_its_arguments() {
    let (_temp, mut client) = started(&[]);
    for arguments in [json!([]), json!([7]), json!([null]), Value::Null] {
        let response = if arguments.is_null() {
            client.request(
                "workspace/executeCommand",
                json!({"command": "sigil.renderDocument"}),
            )
        } else {
            render(&mut client, arguments)
        };
        assert_eq!(response["error"]["code"], -32602, "{response}");
        assert_eq!(
            response["error"]["message"],
            "sigil.renderDocument requires a document URI argument."
        );
    }
    let response = client.request(
        "workspace/executeCommand",
        json!({"command": "sigil.other", "arguments": ["file:///x"]}),
    );
    assert_eq!(response["error"]["code"], -32602);
    assert_eq!(response["error"]["message"], "Unknown command: sigil.other");
    let response = client.request("workspace/executeCommand", json!({"arguments": []}));
    assert_eq!(response["error"]["code"], -32602);
}

#[test]
fn a_uri_that_is_not_a_file_uri_is_an_internal_error() {
    let (_temp, mut client) = started(&[]);
    let response = render(&mut client, json!(["https://example.com/a.sigil"]));
    assert_eq!(response["error"]["code"], -32603, "{response}");
    assert_eq!(
        response["error"]["message"],
        "Only file URIs are supported: https://example.com/a.sigil"
    );
}

const LITERALS: &str = "component Lit {\n  goal {\n    Show output.\n    ````text\n    inside ``` fence\n    ````\n\n    A second Facet.\n    ```json\n    {\"a\": 1}\n    ```\n  }\n}\n";

#[test]
fn a_literal_block_is_fenced_at_least_as_long_as_its_own() {
    let (temp, mut client) = started(&[("lit.sigil", LITERALS)]);
    let text = rendered(&mut client, &temp.uri("lit.sigil"));
    assert!(
        text.contains("- Show output.\n\n````text\n    inside ``` fence\n````\n- A second"),
        "{text}"
    );
    assert!(
        text.contains("- A second Facet.\n\n```json\n    {\"a\": 1}\n```"),
        "{text}"
    );
}

#[test]
fn an_unclosed_literal_block_ends_with_a_newline_before_its_fence() {
    let source = "component Lit {\n  goal {\n    Show output.\n    ```text\n    no closer";
    let (temp, mut client) = started(&[("lit.sigil", source)]);
    let text = rendered(&mut client, &temp.uri("lit.sigil"));
    assert!(
        text.ends_with("- Show output.\n\n```text\n    no closer\n```"),
        "{text}"
    );
}

const AUTHORED: &str = "component Docs {\n  goal {\n    Read [notes](<./notes (v2).md> \"Provider notes\") and ![image](./image.svg),\n    then [site](HTTPS://Example.com), [part](#top) and [odd](https://exa mple.com).\n  }\n}\n";

#[test]
fn authored_link_destinations_become_absolute_and_keep_their_labels_and_titles() {
    let (temp, mut client) = started(&[("docs.sigil", AUTHORED)]);
    let root = temp.uri("");
    let uri = temp.uri("docs.sigil");
    let text = rendered(&mut client, &uri);
    assert!(
        text.contains(&format!(
            "- Read [notes](<{root}/notes%20%28v2%29.md> \"Provider notes\") and ![image](<{root}/image.svg>),\n    then [site](<https://example.com/>), [part](<{uri}#top>) and [odd](https://exa mple.com)."
        )),
        "{text}"
    );
}
