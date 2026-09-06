use std::process::Command;

#[test]
fn ontology_is_available_without_workspace_or_model_configuration() {
    let result = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(["ontology", "--format", "json"])
        .current_dir(std::env::temp_dir())
        .output()
        .unwrap();
    assert!(result.status.success());
    let ontology: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(ontology["namespace"], sigilc::turtle::ONTOLOGY);
    assert_eq!(ontology["predicates"]["dependsOn"], "entity");
    assert!(ontology["predicates"].get("complete-scope").is_none());
    assert!(
        !String::from_utf8(result.stdout)
            .unwrap()
            .contains("Evidence")
    );
    let invalid = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .args(["ontology", "--model", "anything"])
        .output()
        .unwrap();
    assert_eq!(invalid.status.code(), Some(2));
    assert!(invalid.stdout.is_empty());
}
