#![allow(dead_code)]
use serde_json::{Value, json};
use sigilc::frontend::DesignInput;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};

pub struct Workspace(pub PathBuf);
impl Workspace {
    pub fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "sigil-inputs-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }
    pub fn write(&self, path: &str, bytes: &[u8]) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    pub fn input(&self, paths: &[&str], imports: Value) -> DesignInput {
        DesignInput::parse(&serde_json::to_vec(&json!({
            "schemaVersion": 1, "frontendVersion":"test",
            "sources": paths.iter().map(|p| json!({"path":p,"text":fs::read_to_string(self.0.join(p)).unwrap()})).collect::<Vec<_>>(),
            "context": ([".sigil/config.json",".sigil/local.json",".sigil/glossary.json"].iter().map(|p| json!({"path":p,"text":fs::read_to_string(self.0.join(p)).ok()})).collect::<Vec<_>>()),
            "diagnostics":[], "entities":[], "units":[], "imports":imports,
        })).unwrap()).unwrap()
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
