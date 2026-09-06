mod support;
use serde_json::json;
use sigilc::{
    catalog::DesignIdentities,
    frontend::{Entity, EntityType},
    inputs::{self, Binding, DesignSnapshot, SemanticInput},
    kernel::DesignState,
    sources::capture,
};
use std::collections::BTreeMap;
use support::Workspace;

const PATHS: &[&str] = &["a.sigil", "b.sigil", "c.sigil", "unrelated.sigil"];
fn workspace() -> Workspace {
    let root = Workspace::new();
    for path in PATHS {
        root.write(path, b"// original");
    }
    root
}
fn snapshot(root: &Workspace) -> DesignSnapshot {
    DesignSnapshot::capture(
        &root.0,
        root.input(
            PATHS,
            json!([
                {"source":"a.sigil","target":"b.sigil","names":[]},
                {"source":"c.sigil","target":"a.sigil","names":[]},
                {"source":"b.sigil","target":"c.sigil","names":[]}
            ]),
        ),
        10_000,
    )
    .unwrap()
}

#[test]
fn design_transitive_imports_and_cycles_bind_private_bytes() {
    let root = workspace();
    let before = snapshot(&root);
    root.write("b.sigil", b"// private change");
    let after = snapshot(&root);
    for path in ["a.sigil", "b.sigil", "c.sigil"] {
        assert_ne!(before.binding(path).unwrap(), after.binding(path).unwrap());
    }
    assert_eq!(
        before.binding("unrelated.sigil").unwrap(),
        after.binding("unrelated.sigil").unwrap()
    );
    let SemanticInput::Design { dependencies, .. } = before.binding("a.sigil").unwrap().semantic
    else {
        panic!()
    };
    assert_eq!(dependencies.len(), 2);
    assert_ne!(before.fingerprint().unwrap(), after.fingerprint().unwrap());
    root.write(".sigil/glossary.json", b"{}");
    let context_changed = snapshot(&root);
    for path in PATHS {
        assert_ne!(
            after.binding(path).unwrap(),
            context_changed.binding(path).unwrap()
        );
    }
}

#[test]
fn old_dependency_bindings_detect_deleted_edges_and_unresolved_graphs_expand_scope() {
    let root = workspace();
    let before = snapshot(&root);
    std::fs::remove_file(root.0.join("b.sigil")).unwrap();
    let paths = &["a.sigil", "c.sigil", "unrelated.sigil"];
    let deleted = DesignSnapshot::capture(
        &root.0,
        root.input(
            paths,
            json!([
                {"source":"c.sigil","target":"a.sigil","names":[]}
            ]),
        ),
        10_000,
    )
    .unwrap();
    for path in ["a.sigil", "c.sigil"] {
        assert_ne!(
            before.binding(path).unwrap(),
            deleted.binding(path).unwrap()
        );
    }
    assert_eq!(
        before.binding("unrelated.sigil").unwrap(),
        deleted.binding("unrelated.sigil").unwrap()
    );
    let unresolved = DesignSnapshot::capture(
        &root.0,
        root.input(
            paths,
            json!([
                {"source":"a.sigil","target":null,"names":[]}
            ]),
        ),
        10_000,
    )
    .unwrap();
    assert_ne!(
        deleted.binding("unrelated.sigil").unwrap(),
        unresolved.binding("unrelated.sigil").unwrap()
    );
}

#[test]
fn stale_frontend_buffers_and_context_absence_are_rejected() {
    let root = workspace();
    let input = root.input(PATHS, json!([]));
    root.write("a.sigil", b"changed");
    assert!(
        DesignSnapshot::capture(&root.0, input, 10_000)
            .err()
            .unwrap()
            .contains("source changed")
    );
    let input = root.input(PATHS, json!([]));
    root.write(".sigil/config.json", b"{}");
    assert!(
        DesignSnapshot::capture(&root.0, input, 10_000)
            .err()
            .unwrap()
            .contains("context appeared")
    );
    let input = root.input(PATHS, json!([]));
    root.write(".sigil/config.json", b"changed");
    assert!(
        DesignSnapshot::capture(&root.0, input, 10_000)
            .err()
            .unwrap()
            .contains("context changed")
    );
}

#[test]
fn implementation_key_contains_only_its_target_and_ontology_format_catalog() {
    let root = workspace();
    let mut input = root.input(PATHS, json!([]));
    let frozen = DesignIdentities::collect(&input, &BTreeMap::new())
        .unwrap()
        .freeze(DesignState::Loose, "d1".into(), true)
        .unwrap();
    root.write("arbitrary.raw", b"\xff\x00bytes");
    let first = capture(&root.0, "arbitrary.raw", 100).unwrap();
    let binding = inputs::implementation(&first, &frozen.catalog);
    root.write("neighbor.rs", b"imports changed");
    root.write("b.sigil", b"Design relationship changed");
    assert_eq!(
        binding,
        inputs::implementation(
            &capture(&root.0, "arbitrary.raw", 100).unwrap(),
            &frozen.catalog
        )
    );
    input.entities.push(Entity {
        id: "urn:sigil:component:a.sigil:A".into(),
        kind: EntityType::Component,
        label: "A".into(),
        source: "a.sigil".into(),
        owner: None,
        exported: true,
    });
    let changed = DesignIdentities::collect(&input, &BTreeMap::new())
        .unwrap()
        .freeze(DesignState::Coherent, "d2".into(), true)
        .unwrap();
    assert_ne!(binding, inputs::implementation(&first, &changed.catalog));
    root.write("arbitrary.raw", b"different");
    assert_ne!(
        binding,
        inputs::implementation(
            &capture(&root.0, "arbitrary.raw", 100).unwrap(),
            &frozen.catalog
        )
    );
    let original = serde_json::to_value(&binding).unwrap();
    for field in [
        "model",
        "prompt",
        "context",
        "neighbors",
        "symbolMap",
        "dependencies",
    ] {
        for pointer in ["", "/source", "/semantic"] {
            let mut bad = original.clone();
            bad.pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(field.into(), json!([]));
            assert!(
                serde_json::from_value::<Binding>(bad).is_err(),
                "{pointer}/{field}"
            );
        }
    }
}
