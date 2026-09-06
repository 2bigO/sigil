mod support;
use serde_json::{Value, json};
use std::process::{Command, Output};
use support::Workspace;

fn workspace() -> Workspace {
    let root = Workspace::new();
    root.write("a.sigil", b"component A { goal { Describe A. } }");
    let mut input = serde_json::to_value(root.input(&["a.sigil"], json!([]))).unwrap();
    input["entities"] = json!([{"id":"urn:sigil:component:a.sigil:A","type":"Component","label":"A","source":"a.sigil","owner":null,"exported":true}]);
    input["units"] = json!([{"id":"urn:sigil:unit:a.sigil:1:1","source":"a.sigil","owner":"urn:sigil:component:a.sigil:A","form":"component","section":"goal","concept":null,"range":{"start":{"line":1,"column":1},"end":{"line":1,"column":35}}}]);
    root.write("frontend.json", &serde_json::to_vec(&input).unwrap());
    root
}
fn run(root: &Workspace, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(args)
        .args(["--root", ".", "--frontend", "frontend.json"])
        .current_dir(&root.0)
        .output()
        .unwrap()
}
fn result(root: &Workspace, args: &[&str], code: i32) -> Value {
    let output = run(root, args);
    assert_eq!(
        output.status.code(),
        Some(code),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
fn publish(root: &Workspace, out: &str, turtle: &str) {
    result(
        root,
        &["prepare", "design", "--source", "a.sigil", "--out", out],
        0,
    );
    root.write("facts.ttl", turtle.as_bytes());
    result(
        root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--job",
            &format!("{out}/job.json"),
            "--turtle",
            "facts.ttl",
        ],
        0,
    );
}
const PREFIX: &str =
    "@prefix s: <https://sigil.dev/ontology/1#> . @prefix a: <urn:sigil:component:a.sigil:> . ";

#[test]
fn design_cli_distinguishes_missing_empty_interpreted_and_disjoint_worlds() {
    let root = workspace();
    let missing = result(&root, &["compile", "design"], 1);
    assert_eq!(missing["world"]["state"], "Loose");
    assert_eq!(missing["all_fresh"], false);
    assert!(missing["catalog"].is_null());
    let stale = result(&root, &["stale", "design"], 1);
    assert_eq!(stale["sources"][0]["status"], "missing");
    publish(&root, "first", "");
    let empty = result(&root, &["compile", "design"], 1);
    assert_eq!(empty["world"]["state"], "Loose");
    assert_eq!(empty["all_fresh"], true);
    let provisional = result(&root, &["entities"], 0);
    assert_eq!(provisional["status"], "provisional");
    assert_eq!(
        provisional["catalog"]["entries"].as_array().unwrap().len(),
        1
    );
    publish(
        &root,
        "second",
        &format!(
            "{PREFIX}<urn:sigil:unit:a.sigil:1:1> s:from a:A; s:relation \"uses\"; s:target a:A; s:expected false ."
        ),
    );
    let interpreted = result(&root, &["compile", "design"], 0);
    assert_eq!(interpreted["world"]["state"], "Coherent");
    let authoritative = result(&root, &["entities"], 0);
    assert_eq!(authoritative["status"], "authoritative");
    assert_eq!(
        provisional["catalog"]["fingerprint"],
        authoritative["catalog"]["fingerprint"]
    );
    assert_ne!(
        provisional["design_fingerprint"],
        authoritative["design_fingerprint"]
    );
    publish(
        &root,
        "third",
        &format!("{PREFIX}a:A s:uses a:A; s:excludes a:A ."),
    );
    let disjoint = result(&root, &["compile", "design"], 1);
    assert_eq!(disjoint["world"]["state"], "Disjoint");
    assert!(result(&root, &["entities"], 1)["catalog"].is_null());
}

#[test]
fn design_cli_rejects_stale_jobs_and_unbound_or_foreign_identity() {
    let root = workspace();
    result(
        &root,
        &["prepare", "design", "--source", "a.sigil", "--out", "job"],
        0,
    );
    root.write(
        "facts.ttl",
        format!("{PREFIX}<urn:sigil:entity:foreign.sigil:X> a s:State; s:label \"X\" .").as_bytes(),
    );
    let invalid = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--job",
            "job/job.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(invalid.status.code(), Some(3));
    assert!(invalid.stdout.is_empty());
    root.write(
        "facts.ttl",
        format!("{PREFIX}a:A s:uses <urn:missing> .").as_bytes(),
    );
    result(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--job",
            "job/job.json",
            "--turtle",
            "facts.ttl",
        ],
        0,
    );
    let unknown = run(&root, &["compile", "design"]);
    assert_eq!(unknown.status.code(), Some(3));
    assert!(unknown.stdout.is_empty());
    root.write("a.sigil", b"edited after preparation");
    let stale = run(
        &root,
        &[
            "ingest",
            "design",
            "--source",
            "a.sigil",
            "--job",
            "job/job.json",
            "--turtle",
            "facts.ttl",
        ],
    );
    assert_eq!(stale.status.code(), Some(3));
    assert!(String::from_utf8_lossy(&stale.stderr).contains("frontend source changed"));
}

#[test]
fn preparation_omits_unbound_design_files_and_never_overwrites_a_directory() {
    let root = workspace();
    root.write("unrelated.sigil", b"secret unrelated meaning");
    let mut input: Value =
        serde_json::from_slice(&std::fs::read(root.0.join("frontend.json")).unwrap()).unwrap();
    input["sources"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":"unrelated.sigil","text":"secret unrelated meaning"}));
    root.write("frontend.json", &serde_json::to_vec(&input).unwrap());
    result(
        &root,
        &["prepare", "design", "--source", "a.sigil", "--out", "job"],
        0,
    );
    let prepared = std::fs::read_to_string(root.0.join("job/design.json")).unwrap();
    assert!(!prepared.contains("secret"));
    assert!(!prepared.contains("unrelated.sigil"));
    assert!(root.0.join("job/job.json").is_file());
    assert!(root.0.join("job/ontology.json").is_file());
    assert_eq!(
        run(
            &root,
            &["prepare", "design", "--source", "a.sigil", "--out", "job"]
        )
        .status
        .code(),
        Some(3)
    );
    assert_eq!(
        run(&root, &["compile", "design", "--model", "anything"])
            .status
            .code(),
        Some(2)
    );
}

#[test]
fn empty_scope_and_runtime_limits_never_fabricate_success() {
    let root = Workspace::new();
    root.write(
        "frontend.json",
        &serde_json::to_vec(&root.input(&[], json!([]))).unwrap(),
    );
    assert_eq!(run(&root, &["compile", "design"]).status.code(), Some(3));
    let empty = result(&root, &["compile", "design", "--allow-empty"], 0);
    assert_eq!(empty["intentional_empty"], true);
    let root = workspace();
    root.write("limits.json", b"{\"maxRows\":0}");
    let limited = run(&root, &["compile", "design", "--limits", "limits.json"]);
    assert_eq!(limited.status.code(), Some(3));
    assert!(limited.stdout.is_empty());
}

#[test]
fn deleted_index_entries_are_reported_and_never_assembled() {
    let root = workspace();
    publish(&root, "job", "");
    std::fs::remove_file(root.0.join("a.sigil")).unwrap();
    root.write(
        "frontend.json",
        &serde_json::to_vec(&root.input(&[], json!([]))).unwrap(),
    );
    let stale = result(&root, &["stale", "design"], 1);
    assert_eq!(stale["sources"][0]["status"], "deleted");
    let empty = result(&root, &["compile", "design", "--allow-empty"], 0);
    assert!(empty["sources"].as_array().unwrap().is_empty());
    assert!(
        empty["catalog"]["catalog"]["entries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
