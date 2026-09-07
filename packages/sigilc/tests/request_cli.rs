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
    assert!(root.0.join(".sigil/workflow/request.json").is_file());
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
