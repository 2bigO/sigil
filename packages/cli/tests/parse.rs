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

/// Two groups, a loose Facet between them, and a group nested in a group that
/// is followed by a Facet of its own. Each Facet belongs to its innermost group.
const GROUPS: &str = "component A {\n  goal {\n    Own.\n  }\n  interface {\n    #First {\n      One.\n    }\n    Loose fact.\n    #Outer {\n      #Inner {\n        Nested fact.\n      }\n      After.\n    }\n  }\n}\n";

/// A group nested in a group and nothing else after it.
const NESTED: &str = "component A {\n  goal {\n    Own.\n  }\n  interface {\n    #Outer {\n      #Inner {\n        Nested fact.\n      }\n    }\n  }\n}\n";

/// The Facets and groups the JSON of a group lists directly, by name or text.
fn group_facets(source: &str, group: &Value) -> Vec<String> {
    group["facets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|facet| slice(source, facet).trim().to_owned())
        .collect()
}

fn group_names(groups: &Value) -> Vec<String> {
    groups
        .as_array()
        .unwrap()
        .iter()
        .map(|group| group["name"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn a_facet_in_a_nested_group_is_listed_only_under_the_innermost_group() {
    let temp = workspace_with("n.sigil", NESTED);
    let (code, json, _) = parse(&temp, &["n.sigil"]);
    assert_eq!(code, 1);
    assert_eq!(json["diagnostics"][0]["code"], "SIGIL_NESTED_TAG_GROUP");
    let interface = &json["document"]["components"][0]["sections"][1];
    assert_eq!(interface["facets"].as_array().unwrap().len(), 0);
    let outer = &interface["groups"][0];
    assert_eq!(outer["name"], "#Outer");
    assert!(group_facets(NESTED, outer).is_empty());
    let inner = &outer["groups"][0];
    assert_eq!(inner["name"], "#Inner");
    assert_eq!(group_facets(NESTED, inner), ["Nested fact."]);

    let ran = temp.sigil(&["parse", "n.sigil", "--format", "text"]);
    assert_eq!(ran.code, 1);
    assert_eq!(
        ran.stdout,
        "\
document n.sigil invalid, complete
  component A 0..119 1:1-13:1 invalid
    section goal 14..36 2:1-5:1
      facet 23..32 3:1-4:1
    section interface 36..117 5:1-12:1
      group #Outer 50..113 6:1-11:1
        group #Inner 63..107 7:1-10:1 invalid
          facet 78..99 8:1-9:1 invalid
error SIGIL_NESTED_TAG_GROUP n.sigil:7:1: Grouping Tags cannot nest.
"
    );
}

#[test]
fn an_outer_group_lists_only_its_own_facets_beside_a_nested_group() {
    let temp = workspace_with("o.sigil", GROUPS);
    let (code, json, _) = parse(&temp, &["o.sigil"]);
    assert_eq!(code, 1);
    let interface = &json["document"]["components"][0]["sections"][1];
    assert_eq!(group_facets(GROUPS, &interface["groups"][0]), ["One."]);
    let loose = interface["facets"].as_array().unwrap();
    assert_eq!(loose.len(), 1);
    assert_eq!(slice(GROUPS, &loose[0]).trim(), "Loose fact.");
    let outer = &interface["groups"][1];
    assert_eq!(group_facets(GROUPS, outer), ["After."]);
    assert_eq!(group_names(&outer["groups"]), ["#Inner"]);
    assert_eq!(group_facets(GROUPS, &outer["groups"][0]), ["Nested fact."]);
    // Every Facet appears once: the goal's, One, Loose, After and Nested.
    assert_eq!(json.to_string().matches("\"proseRange\"").count(), 5);
}

#[test]
fn the_text_outline_follows_source_order_with_the_depth_of_each_parent() {
    let temp = workspace_with("o.sigil", GROUPS);
    let ran = temp.sigil(&["parse", "o.sigil", "--format", "text"]);
    assert_eq!(ran.code, 1);
    assert_eq!(
        ran.stdout,
        "\
document o.sigil invalid, complete
  component A 0..178 1:1-18:1 invalid
    section goal 14..36 2:1-5:1
      facet 23..32 3:1-4:1
    section interface 36..176 5:1-17:1
      group #First 50..80 6:1-9:1
        facet 63..74 7:1-8:1
      facet 80..96 9:1-10:1
      group #Outer 96..172 10:1-16:1
        group #Inner 109..153 11:1-14:1 invalid
          facet 124..145 12:1-13:1 invalid
        facet 153..166 14:1-15:1
error SIGIL_NESTED_TAG_GROUP o.sigil:11:1: Grouping Tags cannot nest.
"
    );
}

/// An import with no valid selection, an image link, a payload without a
/// notation, an unknown section and a section left open.
const ODD: &str = "@b.sigil from B import { }\ncomponent A {\n  goal {\n    Own ![pic](./p.png) here.\n    ```\n    raw\n    ```\n  }\n  mystery {\n    Odd.\n  }\n  interface {\n    run()\n";

#[test]
fn json_pins_unknown_incomplete_image_bare_payload_and_empty_import() {
    let temp = workspace_with("u.sigil", ODD);
    let (code, _, stdout) = parse(&temp, &["u.sigil"]);
    assert_eq!(code, 1);
    let golden = [
        r#"{"command":"parse","workspaceRoot":".","configPath":".sigil/config.json","sigilVersion":"0.9.0","#,
        r#""workspaceName":"test","document":{"filePath":"u.sigil","valid":false,"complete":false,"#,
        r#""imports":[{"path":"b.sigil","provider":"B","selections":[{"name":"","valid":false,"range":{"start":25,"#,
        r#""end":25,"from":{"line":1,"column":26},"to":{"line":1,"column":26}}}],"valid":false,"complete":true,"#,
        r#""range":{"start":0,"end":27,"from":{"line":1,"column":1},"to":{"line":2,"column":1}}}],"#,
        r#""components":[{"name":"A","valid":false,"complete":false,"range":{"start":27,"end":157,"from":{"line":2,"#,
        r#""column":1},"to":{"line":14,"column":1}},"sections":[{"name":"goal","known":true,"valid":true,"#,
        r#""complete":true,"range":{"start":41,"end":108,"from":{"line":3,"column":1},"to":{"line":9,"column":1}},"#,
        r#""facets":[{"valid":true,"complete":true,"range":{"start":50,"end":104,"from":{"line":4,"column":1},"#,
        r#""to":{"line":8,"column":1}},"proseRange":{"start":50,"end":80,"from":{"line":4,"column":1},"#,
        r#""to":{"line":5,"column":1}},"tags":[],"links":[{"label":"pic","destination":"./p.png","image":true,"#,
        r#""range":{"start":58,"end":73,"from":{"line":4,"column":9},"to":{"line":4,"column":24}}}],"#,
        r#""payload":{"notation":null,"valid":true,"complete":true,"range":{"start":80,"end":104,"from":{"line":5,"#,
        r#""column":1},"to":{"line":8,"column":1}},"bodyRange":{"start":88,"end":96,"from":{"line":6,"column":1},"#,
        r#""to":{"line":7,"column":1}}}}],"groups":[]},{"name":"mystery","known":false,"valid":false,"#,
        r#""complete":true,"range":{"start":108,"end":133,"from":{"line":9,"column":1},"to":{"line":12,"column":1}},"#,
        r#""facets":[],"groups":[]},{"name":"interface","known":true,"valid":false,"complete":false,"#,
        r#""range":{"start":133,"end":157,"from":{"line":12,"column":1},"to":{"line":14,"column":1}},"#,
        r#""facets":[{"valid":true,"complete":true,"range":{"start":147,"end":157,"from":{"line":13,"column":1},"#,
        r#""to":{"line":14,"column":1}},"proseRange":{"start":147,"end":157,"from":{"line":13,"column":1},"#,
        r#""to":{"line":14,"column":1}},"tags":[],"links":[],"payload":null}],"groups":[]}]}],"invalidRegions":[]},"#,
        r#""diagnostics":[{"code":"SIGIL_PARSE_STRUCTURE","stage":"parsing","severity":"error","#,
        r#""message":"Malformed or incomplete Tag import selection list.","filePath":"u.sigil","range":{"start":0,"#,
        r#""end":27},"related":[],"sourceLocation":{"line":1,"column":1}},{"code":"SIGIL_UNCLOSED_BLOCK","#,
        r#""stage":"parsing","severity":"error","message":"Unclosed component block.","filePath":"u.sigil","#,
        r#""range":{"start":27,"end":41},"related":[{"filePath":"u.sigil","range":{"start":157,"end":157}}],"#,
        r#""sourceLocation":{"line":2,"column":1}},{"code":"SIGIL_UNKNOWN_SECTION","stage":"parsing","#,
        r#""severity":"error","message":"Unknown contract \"mystery\".","filePath":"u.sigil","range":{"start":110,"#,
        r#""end":117},"related":[],"sourceLocation":{"line":9,"column":3}},{"code":"SIGIL_UNCLOSED_BLOCK","#,
        r#""stage":"parsing","severity":"error","message":"Unclosed section block.","filePath":"u.sigil","#,
        r#""range":{"start":133,"end":147},"related":[{"filePath":"u.sigil","range":{"start":157,"end":157}}],"#,
        r#""sourceLocation":{"line":12,"column":1}}]}"#,
    ]
    .concat();
    assert_eq!(stdout, format!("{golden}\n"));
}

#[test]
fn text_pins_unknown_incomplete_image_bare_payload_and_empty_import() {
    let temp = workspace_with("u.sigil", ODD);
    let ran = temp.sigil(&["parse", "u.sigil", "--format", "text"]);
    assert_eq!(ran.code, 1);
    assert_eq!(
        ran.stdout,
        "\
document u.sigil invalid, incomplete
  import b.sigil from B {  } 0..27 1:1-2:1 invalid
  component A 27..157 2:1-14:1 invalid incomplete
    section goal 41..108 3:1-9:1
      facet 50..104 4:1-8:1
        payload 80..104 5:1-8:1
    section mystery 108..133 9:1-12:1 invalid unknown
    section interface 133..157 12:1-14:1 invalid incomplete
      facet 147..157 13:1-14:1
error SIGIL_PARSE_STRUCTURE u.sigil:1:1: Malformed or incomplete Tag import selection list.
error SIGIL_UNCLOSED_BLOCK u.sigil:2:1: Unclosed component block.
error SIGIL_UNKNOWN_SECTION u.sigil:9:3: Unknown contract \"mystery\".
error SIGIL_UNCLOSED_BLOCK u.sigil:12:1: Unclosed section block.
"
    );
}

#[test]
fn markdown_pins_unknown_incomplete_image_bare_payload_and_empty_import() {
    let temp = workspace_with("u.sigil", ODD);
    let ran = temp.sigil(&["parse", "u.sigil", "--format", "markdown"]);
    assert_eq!(ran.code, 1);
    assert_eq!(
        ran.stdout,
        "\
# Parse u.sigil

- Document: u.sigil
- Validity: invalid
- Completeness: incomplete

## Imports

- import b.sigil from B {  }: `0..27 1:1-2:1` invalid

## Components

- component A: `27..157 2:1-14:1` invalid incomplete
  - section goal: `41..108 3:1-9:1`
    - facet: `50..104 4:1-8:1`
      - payload: `80..104 5:1-8:1`
  - section mystery: `108..133 9:1-12:1` invalid unknown
  - section interface: `133..157 12:1-14:1` invalid incomplete
    - facet: `147..157 13:1-14:1`

## Invalid regions

None.

## Diagnostics

- error SIGIL_PARSE_STRUCTURE u.sigil:1:1: Malformed or incomplete Tag import selection list.
- error SIGIL_UNCLOSED_BLOCK u.sigil:2:1: Unclosed component block.
- error SIGIL_UNKNOWN_SECTION u.sigil:9:3: Unknown contract \"mystery\".
- error SIGIL_UNCLOSED_BLOCK u.sigil:12:1: Unclosed section block.
"
    );
}

#[test]
fn markdown_lists_invalid_regions_and_diagnostics() {
    let source = "component A {\n  goal {\n    Own.\n  }\n  interface {\n    run()\n\n    ```text\n    x\n    ```\n  }\n}\nmystery\n";
    let temp = workspace_with("d.sigil", source);
    let ran = temp.sigil(&["parse", "d.sigil", "--format", "markdown"]);
    assert_eq!(ran.code, 1);
    assert_eq!(
        ran.stdout,
        "\
# Parse d.sigil

- Document: d.sigil
- Validity: invalid
- Completeness: complete

## Imports

None.

## Components

- component A: `0..93 1:1-13:1` invalid
  - section goal: `14..36 2:1-5:1`
    - facet: `23..32 3:1-4:1`
  - section interface: `36..91 5:1-12:1`
    - facet: `50..60 6:1-7:1`

## Invalid regions

- invalid detachedPayload: `61..87 8:1-11:1`
  - payload text: `61..87 8:1-11:1`
- invalid structure: `93..101 13:1-14:1`

## Diagnostics

- error SIGIL_DETACHED_LITERAL_BLOCK d.sigil:8:1: A payload needs immediately preceding prose in the same container.
- error SIGIL_PARSE_STRUCTURE d.sigil:13:1: Text does not fit this structural context.
"
    );
}
