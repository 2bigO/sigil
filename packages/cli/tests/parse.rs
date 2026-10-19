#![cfg(unix)]
//! `parse`: one document with a source range for each part, for any `.sigil`
//! file. The JSON shape, the text outline and the markdown are pinned here;
//! the TypeScript output they replace serialized internal objects.
mod support;

use serde_json::Value;
use support::{CONFIG, Temp};

/// Every kind of part, with no diagnostics. Line 4 holds a Tag, line 9 a link
/// and a payload follows it.
const DOCUMENT: &str = "@b.sigil from B import { x }\ncomponent A {\n  goal {\n    Own *Tag* here.\n  }\n\n  interface {\n    Box {\n      run() with [n](./n.md).\n      ```text\n      raw\n      ```\n    }\n  }\n}\n";

fn parse(temp: &Temp, args: &[&str]) -> (i32, Value, String) {
    let mut argv = vec!["parse"];
    argv.extend_from_slice(args);
    let ran = temp.sigil(&argv);
    let json = serde_json::from_str(&ran.stdout).unwrap_or(Value::Null);
    (ran.code, json, ran.stdout)
}

fn workspace_with(path: &str, source: &str) -> Temp {
    let temp = Temp::workspace();
    temp.write(path, source);
    temp
}

/// The source text a `range` object of the JSON covers.
fn slice<'a>(source: &'a str, node: &Value) -> &'a str {
    let range = &node["range"];
    let start = range["start"].as_u64().unwrap() as usize;
    let end = range["end"].as_u64().unwrap() as usize;
    &source[start..end]
}

fn at(node: &Value, end: &str) -> (u64, u64) {
    let place = &node["range"][end];
    (
        place["line"].as_u64().unwrap(),
        place["column"].as_u64().unwrap(),
    )
}

#[test]
fn json_shape_is_pinned() {
    let temp = workspace_with("g.sigil", DOCUMENT);
    let (code, _, stdout) = parse(&temp, &["g.sigil"]);
    assert_eq!(code, 0);
    let golden = [
        r#"{"command":"parse","workspaceRoot":".","configPath":".sigil/config.json","sigilVersion":"0.9.0","#,
        r#""workspaceName":"test","document":{"filePath":"g.sigil","valid":true,"complete":true,"imports":[{"path":"b.sigil","#,
        r#""provider":"B","selections":[{"name":"x","valid":true,"range":{"start":25,"end":26,"from":{"line":1,"#,
        r#""column":26},"to":{"line":1,"column":27}}}],"valid":true,"complete":true,"range":{"start":0,"#,
        r#""end":29,"from":{"line":1,"column":1},"to":{"line":2,"column":1}}}],"components":[{"name":"A","#,
        r#""valid":true,"complete":true,"range":{"start":29,"end":177,"from":{"line":2,"column":1},"to":{"line":16,"#,
        r#""column":1}},"sections":[{"name":"goal","known":true,"valid":true,"complete":true,"range":{"start":43,"#,
        r#""end":76,"from":{"line":3,"column":1},"to":{"line":6,"column":1}},"facets":[{"valid":true,"complete":true,"#,
        r#""range":{"start":52,"end":72,"from":{"line":4,"column":1},"to":{"line":5,"column":1}},"proseRange":{"start":52,"#,
        r#""end":72,"from":{"line":4,"column":1},"to":{"line":5,"column":1}},"tags":[{"name":"Tag","valid":true,"#,
        r#""range":{"start":60,"end":65,"from":{"line":4,"column":9},"to":{"line":4,"column":14}}}],"links":[],"#,
        r#""payload":null}],"groups":[]},{"name":"interface","known":true,"valid":true,"complete":true,"#,
        r#""range":{"start":77,"end":175,"from":{"line":7,"column":1},"to":{"line":15,"column":1}},"facets":[],"#,
        r#""groups":[{"name":"Box","valid":true,"complete":true,"range":{"start":91,"end":171,"from":{"line":8,"#,
        r#""column":1},"to":{"line":14,"column":1}},"facets":[{"valid":true,"complete":true,"range":{"start":101,"#,
        r#""end":165,"from":{"line":9,"column":1},"to":{"line":13,"column":1}},"proseRange":{"start":101,"#,
        r#""end":131,"from":{"line":9,"column":1},"to":{"line":10,"column":1}},"tags":[],"links":[{"label":"n","#,
        r#""destination":"./n.md","image":false,"range":{"start":118,"end":129,"from":{"line":9,"column":18},"#,
        r#""to":{"line":9,"column":29}}}],"payload":{"notation":"text","valid":true,"complete":true,"range":{"start":131,"#,
        r#""end":165,"from":{"line":10,"column":1},"to":{"line":13,"column":1}},"bodyRange":{"start":145,"#,
        r#""end":155,"from":{"line":11,"column":1},"to":{"line":12,"column":1}}}}],"groups":[]}]}]}],"invalidRegions":[]},"#,
        r#""diagnostics":[]}"#,
    ]
    .concat();
    assert_eq!(stdout, format!("{golden}\n"));
}

#[test]
fn every_part_range_slices_the_source_back() {
    let temp = workspace_with("g.sigil", DOCUMENT);
    let (code, json, _) = parse(&temp, &["g.sigil"]);
    assert_eq!(code, 0);
    let document = &json["document"];
    assert_eq!(document["filePath"], "g.sigil");
    assert_eq!(document["valid"], true);
    assert_eq!(document["complete"], true);

    let import = &document["imports"][0];
    assert_eq!(slice(DOCUMENT, import), "@b.sigil from B import { x }\n");
    assert_eq!(import["path"], "b.sigil");
    assert_eq!(import["provider"], "B");
    assert_eq!(slice(DOCUMENT, &import["selections"][0]), "x");

    let component = &document["components"][0];
    assert_eq!(component["name"], "A");
    assert!(slice(DOCUMENT, component).starts_with("component A {"));
    assert!(slice(DOCUMENT, component).ends_with("}\n"));
    let sections = component["sections"].as_array().unwrap();
    assert_eq!(sections.len(), 2);
    assert!(slice(DOCUMENT, &sections[0]).starts_with("  goal {"));
    assert!(slice(DOCUMENT, &sections[1]).starts_with("  interface {"));
    assert_eq!(sections[0]["name"], "goal");
    assert_eq!(sections[1]["name"], "interface");

    let goal_facet = &sections[0]["facets"][0];
    assert_eq!(slice(DOCUMENT, goal_facet), "    Own *Tag* here.\n");
    let tag = &goal_facet["tags"][0];
    assert_eq!(tag["name"], "Tag");
    assert_eq!(slice(DOCUMENT, tag), "*Tag*");

    let group = &sections[1]["groups"][0];
    assert_eq!(group["name"], "Box");
    assert!(slice(DOCUMENT, group).starts_with("    Box {"));
    let facet = &group["facets"][0];
    assert!(slice(DOCUMENT, facet).starts_with("      run() with"));
    let prose = slice(
        DOCUMENT,
        &serde_json::json!({ "range": facet["proseRange"] }),
    );
    assert_eq!(prose, "      run() with [n](./n.md).\n");
    assert_eq!(slice(DOCUMENT, &facet["links"][0]), "[n](./n.md)");
    let payload = &facet["payload"];
    assert_eq!(payload["notation"], "text");
    assert_eq!(
        slice(DOCUMENT, payload),
        "      ```text\n      raw\n      ```\n"
    );
    let body = serde_json::json!({ "range": payload["bodyRange"] });
    assert_eq!(slice(DOCUMENT, &body), "      raw\n");
}

#[test]
fn an_excluded_file_still_parses() {
    let temp = Temp::new();
    temp.write(
        ".sigil/config.json",
        r#"{"sigilVersion":"0.9.0","workspace":{"name":"test","members":[]},"files":{"include":["**/*.sigil"],"exclude":["skip/**"]},"tools":{}}"#,
    );
    temp.write("skip/left-out.sigil", DOCUMENT);
    let (code, json, _) = parse(&temp, &["skip/left-out.sigil"]);
    assert_eq!(code, 0, "{json}");
    assert_eq!(json["document"]["filePath"], "skip/left-out.sigil");
    assert_eq!(json["document"]["components"][0]["name"], "A");
    assert_eq!(json["diagnostics"].as_array().unwrap().len(), 0);
}

#[test]
fn a_file_outside_the_workspace_parses_with_an_explicit_root() {
    let temp = Temp::new();
    temp.write("ws/.sigil/config.json", CONFIG);
    temp.write("elsewhere/a.sigil", DOCUMENT);
    let root = temp.path("ws").to_string_lossy().into_owned();
    let file = temp
        .path("elsewhere/a.sigil")
        .to_string_lossy()
        .into_owned();
    let (code, json, _) = parse(&temp, &[&file, "--root", &root]);
    assert_eq!(code, 0, "{json}");
    assert_eq!(json["workspaceRoot"], root);
    assert_eq!(json["document"]["filePath"], file);
}

#[test]
fn invalid_regions_and_a_detached_payload_show_their_kind() {
    let source = "component A {\n  goal {\n    Own.\n  }\n  interface {\n    run()\n\n    ```text\n    x\n    ```\n  }\n}\nmystery\n";
    let temp = workspace_with("m.sigil", source);
    let (code, json, _) = parse(&temp, &["m.sigil"]);
    assert_eq!(code, 1);
    assert_eq!(json["document"]["valid"], false);
    let regions = json["document"]["invalidRegions"].as_array().unwrap();
    let kinds: Vec<&str> = regions
        .iter()
        .map(|region| region["kind"].as_str().unwrap())
        .collect();
    assert!(kinds.contains(&"structure"), "{kinds:?}");
    assert!(kinds.contains(&"detachedPayload"), "{kinds:?}");
    let structure = regions.iter().find(|r| r["kind"] == "structure").unwrap();
    assert_eq!(slice(source, structure), "mystery\n");
    assert!(structure["payload"].is_null());
    let detached = regions
        .iter()
        .find(|r| r["kind"] == "detachedPayload")
        .unwrap();
    assert_eq!(slice(source, detached), "    ```text\n    x\n    ```\n");
    assert_eq!(detached["payload"]["notation"], "text");
    let codes: Vec<&str> = json["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["code"].as_str().unwrap())
        .collect();
    assert!(codes.contains(&"SIGIL_PARSE_STRUCTURE"), "{codes:?}");
    assert!(codes.contains(&"SIGIL_DETACHED_LITERAL_BLOCK"), "{codes:?}");
    let first = &json["diagnostics"][0];
    assert!(first["sourceLocation"]["line"].as_u64().unwrap() >= 1);
}

#[test]
fn character_columns_differ_from_byte_offsets_after_a_multibyte_character() {
    let source = "component A {\n  goal {\n    Own caf\u{e9} \u{1f600} *Tag*.\n  }\n  interface {\n    run()\n  }\n}\n";
    let temp = workspace_with("u.sigil", source);
    let (code, json, _) = parse(&temp, &["u.sigil"]);
    assert_eq!(code, 0, "{json}");
    let tag = &json["document"]["components"][0]["sections"][0]["facets"][0]["tags"][0];
    assert_eq!(slice(source, tag), "*Tag*");
    let line_start = source.find("    Own").unwrap();
    let start_byte = tag["range"]["start"].as_u64().unwrap() as usize;
    // "    Own caf\u{e9} \u{1f600} " is 15 characters but 19 bytes.
    assert_eq!(start_byte - line_start, 19);
    assert_eq!(at(tag, "from"), (3, 16));
    assert_eq!(at(tag, "to"), (3, 21));
}

#[test]
fn a_crlf_file_counts_lines_and_columns_without_the_line_ending() {
    let source = "component A {\r\n  goal {\r\n    Own *Tag*.\r\n  }\r\n  interface {\r\n    run()\r\n  }\r\n}\r\n";
    let temp = workspace_with("c.sigil", source);
    let (code, json, _) = parse(&temp, &["c.sigil"]);
    assert_eq!(code, 0, "{json}");
    let component = &json["document"]["components"][0];
    assert_eq!(at(component, "from"), (1, 1));
    assert_eq!(at(component, "to"), (9, 1));
}

#[test]
fn a_config_failure_has_no_document() {
    let temp = Temp::new();
    temp.write(".sigil/config.json", "{");
    temp.write("item.sigil", DOCUMENT);
    let (code, json, _) = parse(&temp, &["item.sigil"]);
    assert_eq!(code, 1);
    assert!(json["document"].is_null());
    assert_eq!(json["command"], "parse");
    assert_eq!(json["workspaceRoot"], ".");
    assert_eq!(json["configPath"], ".sigil/config.json");
    assert!(json["sigilVersion"].is_null());
    assert_eq!(json["diagnostics"][0]["code"], "SIGIL_CONFIG_PARSE");
}

#[test]
fn a_missing_config_has_no_document() {
    let temp = Temp::new();
    temp.write("item.sigil", DOCUMENT);
    let (code, json, _) = parse(&temp, &["item.sigil"]);
    assert_eq!(code, 1);
    assert!(json["document"].is_null());
    assert!(json["configPath"].is_null());
    assert_eq!(json["diagnostics"][0]["code"], "SIGIL_CONFIG_NOT_FOUND");
}

#[test]
fn a_missing_file_is_a_runtime_failure() {
    let temp = Temp::workspace();
    let ran = temp.sigil(&["parse", "gone.sigil"]);
    assert_eq!(ran.code, 3);
    assert_eq!(ran.stdout, "");
    assert!(ran.stderr.contains("gone.sigil"), "{}", ran.stderr);
    assert_eq!(ran.stderr.lines().count(), 1);
}

#[test]
fn a_directory_is_a_runtime_failure() {
    let temp = Temp::workspace();
    temp.mkdir("dir.sigil");
    let ran = temp.sigil(&["parse", "dir.sigil"]);
    assert_eq!(ran.code, 3);
    assert_eq!(ran.stdout, "");
}

#[test]
fn invalid_utf8_gives_a_diagnostic_and_no_parts() {
    let temp = Temp::workspace();
    std::fs::write(temp.path("bad.sigil"), b"component \xff\xfe").unwrap();
    let (code, json, _) = parse(&temp, &["bad.sigil"]);
    assert_eq!(code, 1);
    let document = &json["document"];
    assert_eq!(document["filePath"], "bad.sigil");
    assert_eq!(document["valid"], false);
    assert_eq!(document["complete"], false);
    assert_eq!(document["components"].as_array().unwrap().len(), 0);
    assert_eq!(json["diagnostics"][0]["code"], "SIGIL_INVALID_ENCODING");
    assert!(json["diagnostics"][0]["sourceLocation"].is_null());
}

#[test]
fn quiet_prints_nothing_and_keeps_the_status() {
    let temp = workspace_with("m.sigil", "mystery\n");
    let ran = temp.sigil(&["parse", "m.sigil", "--quiet"]);
    assert_eq!(ran.code, 1);
    assert_eq!(ran.stdout, "");
}

#[test]
fn pretty_json_is_indented_by_two_spaces() {
    let temp = workspace_with("g.sigil", DOCUMENT);
    let ran = temp.sigil(&["parse", "g.sigil", "--pretty"]);
    assert_eq!(ran.code, 0);
    assert!(ran.stdout.starts_with("{\n  \"command\": \"parse\",\n"));
    assert!(ran.stdout.ends_with("}\n"));
}

#[test]
fn text_is_a_compact_outline() {
    let temp = workspace_with("g.sigil", DOCUMENT);
    let ran = temp.sigil(&["parse", "g.sigil", "--format", "text"]);
    assert_eq!(ran.code, 0);
    assert_eq!(
        ran.stdout,
        "\
document g.sigil valid, complete
  import b.sigil from B { x } 0..29 1:1-2:1
  component A 29..177 2:1-16:1
    section goal 43..76 3:1-6:1
      facet 52..72 4:1-5:1
        tag Tag 60..65 4:9-4:14
    section interface 77..175 7:1-15:1
      group Box 91..171 8:1-14:1
        facet 101..165 9:1-13:1
          payload text 131..165 10:1-13:1
"
    );
}

#[test]
fn text_lists_invalid_regions_and_diagnostics() {
    let source = "component A {\n  goal {\n    Own.\n  }\n  interface {\n    run()\n\n    ```text\n    x\n    ```\n  }\n}\nmystery\n";
    let temp = workspace_with("d.sigil", source);
    let ran = temp.sigil(&["parse", "d.sigil", "--format", "text"]);
    assert_eq!(ran.code, 1);
    assert_eq!(
        ran.stdout,
        "\
document d.sigil invalid, complete
  component A 0..93 1:1-13:1 invalid
    section goal 14..36 2:1-5:1
      facet 23..32 3:1-4:1
    section interface 36..91 5:1-12:1
      facet 50..60 6:1-7:1
  invalid detachedPayload 61..87 8:1-11:1
    payload text 61..87 8:1-11:1
  invalid structure 93..101 13:1-14:1
error SIGIL_DETACHED_LITERAL_BLOCK d.sigil:8:1: A payload needs immediately preceding prose in the same container.
error SIGIL_PARSE_STRUCTURE d.sigil:13:1: Text does not fit this structural context.
"
    );
}

#[test]
fn text_for_a_config_failure_lists_only_diagnostics() {
    let temp = Temp::new();
    temp.write(".sigil/config.json", "{");
    temp.write("item.sigil", DOCUMENT);
    let ran = temp.sigil(&["parse", "item.sigil", "--format", "text"]);
    assert_eq!(ran.code, 1);
    assert!(
        ran.stdout
            .starts_with("error SIGIL_CONFIG_PARSE .sigil/config.json")
    );
    assert_eq!(ran.stdout.lines().count(), 1);
}

#[test]
fn markdown_is_the_same_outline_as_nested_lists() {
    let temp = workspace_with("g.sigil", DOCUMENT);
    let ran = temp.sigil(&["parse", "g.sigil", "--format", "markdown"]);
    assert_eq!(ran.code, 0);
    assert_eq!(
        ran.stdout,
        "\
# Parse g.sigil

- Document: g.sigil
- Validity: valid
- Completeness: complete

## Imports

- import b.sigil from B { x }: `0..29 1:1-2:1`

## Components

- component A: `29..177 2:1-16:1`
  - section goal: `43..76 3:1-6:1`
    - facet: `52..72 4:1-5:1`
      - tag Tag: `60..65 4:9-4:14`
  - section interface: `77..175 7:1-15:1`
    - group Box: `91..171 8:1-14:1`
      - facet: `101..165 9:1-13:1`
        - payload text: `131..165 10:1-13:1`

## Invalid regions

None.

## Diagnostics

None.
"
    );
}

#[test]
fn the_path_is_shown_absolute_when_the_file_is_named_absolute() {
    let temp = workspace_with("g.sigil", DOCUMENT);
    let file = temp.path("g.sigil").to_string_lossy().into_owned();
    let (code, json, _) = parse(&temp, &[&file]);
    assert_eq!(code, 0);
    assert_eq!(json["workspaceRoot"], temp.text());
    assert_eq!(
        json["configPath"],
        format!("{}/.sigil/config.json", temp.text())
    );
    assert_eq!(json["document"]["filePath"], file);
}
