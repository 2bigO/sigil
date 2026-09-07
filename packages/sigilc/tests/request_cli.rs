mod support;

use serde_json::{Value, json};
use std::process::Command;
use support::Workspace;

fn workspace() -> Workspace {
    let root = Workspace::new();
    for path in ["a.sigil", "b.sigil", "c.sigil"] {
        root.write(path, b"// authored");
    }
    root.write("main.any", b"implementation target");
    let mut frontend = serde_json::to_value(root.input(
        &["a.sigil", "b.sigil", "c.sigil"],
        json!([{"source":"a.sigil","target":"b.sigil","names":[]}]),
    ))
    .unwrap();
    frontend["entities"] = json!(
        ["a.sigil", "b.sigil", "c.sigil"]
            .iter()
            .map(|path| {
                let label = path[..1].to_uppercase();
                json!({
                    "id": format!("urn:sigil:component:{path}:{label}"),
                    "type": "Component",
                    "label": label,
                    "source": path,
                    "owner": null,
                    "exported": true
                })
            })
            .collect::<Vec<_>>()
    );
    root.write("frontend.json", &serde_json::to_vec(&frontend).unwrap());
    for (name, path) in [
        ("scope-a.json", "a.sigil"),
        ("scope-b.json", "b.sigil"),
        ("scope-c.json", "c.sigil"),
    ] {
        root.write(
            name,
            &serde_json::to_vec(&json!({
                "version": 1,
                "design": {"paths": [path]},
                "implementation": {"paths": ["main.any"]}
            }))
            .unwrap(),
        );
    }
    root.write(
        "request.json",
        &serde_json::to_vec(&json!({
            "version": 1,
            "id": "frontend-dogfood",
            "items": [
                {"id": "first", "scope": {"version": 1, "design": {"paths": ["a.sigil"]}, "implementation": {"paths": ["main.any"]}}},
                {"id": "second", "after": ["first"], "scope": {"version": 1, "design": {"paths": ["b.sigil"]}, "implementation": {"paths": ["main.any"]}}},
                {"id": "third", "after": ["first"], "scope": {"version": 1, "design": {"paths": ["c.sigil"]}, "implementation": {"paths": ["main.any"]}}}
            ]
        }))
        .unwrap(),
    );
    root
}

fn run(root: &Workspace, args: &[&str], code: i32) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(args)
        .args(["--root", "."])
        .current_dir(&root.0)
        .output()
        .unwrap();
    assert_eq!(
        output.status.code(),
        Some(code),
        "args {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn request(root: &Workspace, args: &[&str], code: i32) -> Value {
    run(root, args, code)
}

fn publish(root: &Workspace, side: &str, source: &str, scope: &str, out: &str) {
    run(
        root,
        &[
            "prepare",
            side,
            "--frontend",
            "frontend.json",
            "--source",
            source,
            "--scope",
            scope,
            "--out",
            out,
        ],
        0,
    );
    root.write("facts.ttl", b"@prefix s: <https://sigil.dev/ontology/1#> .");
    let job = format!("{out}/job.json");
    run(
        root,
        &[
            "ingest",
            side,
            "--frontend",
            "frontend.json",
            "--source",
            source,
            "--scope",
            scope,
            "--job",
            &job,
            "--turtle",
            "facts.ttl",
        ],
        0,
    );
}

#[test]
fn ordered_request_releases_after_terminal_gate_and_survives_restart() {
    let root = workspace();
    let created = request(
        &root,
        &[
            "request",
            "create",
            "--frontend",
            "frontend.json",
            "--definition",
            "request.json",
        ],
        0,
    );
    let items = created["request"]["items"].as_array().unwrap();
    assert_eq!(items[0]["state"], "ready");
    assert_eq!(items[1]["state"], "queued");
    assert_eq!(items[2]["state"], "queued");
    let repeated = request(
        &root,
        &[
            "request",
            "create",
            "--frontend",
            "frontend.json",
            "--definition",
            "request.json",
        ],
        0,
    );
    assert_eq!(
        repeated["request"]["requestFingerprint"],
        created["request"]["requestFingerprint"]
    );

    let initial = request(&root, &["request", "status"], 0);
    assert_eq!(initial["request"]["items"][0]["state"], "ready");
    assert_eq!(initial["request"]["items"][1]["state"], "queued");

    publish(&root, "design", "a.sigil", "scope-a.json", "design-a");
    publish(&root, "design", "b.sigil", "scope-a.json", "design-b");
    let waiting = request(&root, &["request", "status"], 0);
    assert_eq!(waiting["request"]["items"][0]["state"], "ready");
    assert_eq!(waiting["request"]["items"][1]["state"], "queued");
    assert_eq!(waiting["request"]["items"][2]["state"], "queued");

    publish(
        &root,
        "implementation",
        "main.any",
        "scope-a.json",
        "implementation-a",
    );
    let released = request(&root, &["request", "status"], 0);
    assert_eq!(released["request"]["items"][0]["state"], "closed");
    assert_eq!(released["request"]["items"][1]["state"], "ready");
    assert_eq!(released["request"]["items"][2]["state"], "ready");

    let restarted = request(&root, &["request", "status"], 0);
    assert_eq!(restarted["request"]["items"][0]["state"], "closed");
    assert_eq!(restarted["request"]["items"][1]["state"], "ready");
    assert_eq!(restarted["request"]["items"][2]["state"], "ready");
    assert_eq!(
        restarted["request"]["requestFingerprint"],
        created["request"]["requestFingerprint"]
    );

    // Moving to the next ordered item changes the Design catalog for the same
    // implementation source. The first item's exact binding must remain
    // terminal while the second item publishes its replacement binding.
    publish(&root, "design", "b.sigil", "scope-b.json", "design-b-next");
    publish(
        &root,
        "implementation",
        "main.any",
        "scope-b.json",
        "implementation-b",
    );
    let progressed = request(&root, &["request", "status"], 0);
    assert_eq!(progressed["request"]["items"][0]["state"], "closed");
    assert_eq!(progressed["request"]["items"][1]["state"], "closed");
    assert_eq!(progressed["request"]["items"][2]["state"], "ready");
    let index: Value =
        serde_json::from_slice(&std::fs::read(root.0.join(".sigil/worlds/index.json")).unwrap())
            .unwrap();
    assert!(
        index["entries"]
            .as_object()
            .unwrap()
            .keys()
            .any(|key| key.starts_with("implementation/main.any~"))
    );
    assert!(root.0.join(".sigil/workflow/request.json").is_file());
}

#[test]
fn request_status_uses_native_frontend_capture_after_run_artifact_is_gone() {
    let root = workspace();
    let created = request(
        &root,
        &[
            "request",
            "create",
            "--frontend",
            "frontend.json",
            "--definition",
            "request.json",
        ],
        0,
    );
    let capture = created["request"]["frontendSnapshot"].as_str().unwrap();
    assert!(root.0.join(capture).is_file());
    std::fs::remove_file(root.0.join("frontend.json")).unwrap();
    let recovered = request(&root, &["request", "status"], 0);
    assert_eq!(recovered["request"]["items"][0]["state"], "ready");
    assert_eq!(recovered["request"]["frontendSnapshot"], capture);
}

#[test]
fn request_archive_preserves_terminal_record_before_replacement() {
    let root = workspace();
    let created = request(
        &root,
        &[
            "request",
            "create",
            "--frontend",
            "frontend.json",
            "--definition",
            "request.json",
        ],
        0,
    );
    let archived = request(&root, &["request", "archive"], 0);
    let archive = archived["archive"].as_str().unwrap();
    assert!(root.0.join(archive).is_file());
    assert_eq!(
        archived["request"]["requestFingerprint"],
        created["request"]["requestFingerprint"]
    );
    assert!(!root.0.join(".sigil/workflow/request.json").exists());

    root.write(
        "replacement.json",
        br#"{"version":1,"id":"replacement","items":[{"id":"only","scope":{"version":1,"design":{"paths":["a.sigil"]},"implementation":{"paths":["main.any"]}}}]}"#,
    );
    let replacement = request(
        &root,
        &[
            "request",
            "create",
            "--frontend",
            "frontend.json",
            "--definition",
            "replacement.json",
        ],
        0,
    );
    assert_eq!(replacement["request"]["definition"]["id"], "replacement");
}

#[test]
fn terminal_request_records_and_reopens_completion_dossier() {
    let root = workspace();
    request(
        &root,
        &[
            "request",
            "create",
            "--frontend",
            "frontend.json",
            "--definition",
            "request.json",
        ],
        0,
    );
    // The implementation source is bound against the complete captured Design
    // catalog before the first narrowed item is evaluated.
    publish(
        &root,
        "design",
        "b.sigil",
        "scope-a.json",
        "design-b-bootstrap",
    );
    for (design, scope, out) in [
        ("a.sigil", "scope-a.json", "a"),
        ("b.sigil", "scope-b.json", "b"),
        ("c.sigil", "scope-c.json", "c"),
    ] {
        publish(&root, "design", design, scope, &format!("design-{out}"));
        publish(
            &root,
            "implementation",
            "main.any",
            scope,
            &format!("implementation-{out}"),
        );
        request(&root, &["request", "status"], 0);
    }
    let terminal = request(&root, &["request", "status"], 0);
    assert!(
        terminal["request"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| matches!(item["state"].as_str(), Some("closed" | "converged")))
    );
    root.write(
        "completion.json",
        br#"{
          "version": 1,
          "nativeReports": ["reports/final.json"],
          "artifacts": ["worlds/index.json"],
          "delivery": ["delivery/commit"],
          "deletion": ["audit/deletions.json"],
          "checks": ["checks/test.json"],
          "warnings": ["known loose design finding"],
          "overrides": ["user retired non-Linux runtime checks"]
        }"#,
    );
    let recorded = request(
        &root,
        &["request", "record", "--dossier", "completion.json"],
        0,
    );
    assert_eq!(
        recorded["request"]["completion"]["dossier"]["deletion"][0],
        "audit/deletions.json"
    );
    let restarted = request(&root, &["request", "status"], 0);
    assert!(restarted["request"]["completion"].is_object());

    root.write("main.any", b"changed implementation target");
    let reopened = request(&root, &["request", "status"], 0);
    assert!(reopened["request"]["completion"].is_null());
    assert_eq!(reopened["request"]["items"][0]["state"], "ready");
}

#[test]
fn request_definition_rejects_unknown_or_late_predecessors() {
    let root = workspace();
    root.write(
        "bad-request.json",
        br#"{"version":1,"id":"bad","items":[{"id":"first","after":["later"],"scope":{"version":1,"design":{"paths":["a.sigil"]},"implementation":{"paths":["main.any"]}}},{"id":"later","scope":{"version":1,"design":{"paths":["b.sigil"]},"implementation":{"paths":["main.any"]}}}]}"#,
    );
    let output = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args([
            "request",
            "create",
            "--frontend",
            "frontend.json",
            "--definition",
            "bad-request.json",
            "--root",
            ".",
        ])
        .current_dir(&root.0)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(3));
    assert!(String::from_utf8_lossy(&output.stderr).contains("must precede"));
}
