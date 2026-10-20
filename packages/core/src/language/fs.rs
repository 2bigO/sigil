//! Where a workspace reads its files from: the disk, memory, or the disk with
//! caller-supplied text laid over chosen paths.
use super::{path::normalize_path, workspace::list_files};
use std::{
    collections::BTreeMap,
    io::{self, ErrorKind},
    path::{Path, PathBuf},
};

/// A read-only view of a workspace's files by workspace-relative path.
pub trait SourceFs {
    /// The bytes of one file, or none when it does not exist.
    fn read(&self, path: &str) -> io::Result<Option<Vec<u8>>>;
    /// Every candidate file, workspace-relative and sorted.
    fn list_files(&self) -> io::Result<Vec<String>>;
}

/// The files under a workspace root on disk.
pub struct DiskFs {
    root: PathBuf,
}

impl DiskFs {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
        }
    }
}

impl SourceFs for DiskFs {
    fn read(&self, path: &str) -> io::Result<Option<Vec<u8>>> {
        match std::fs::read(self.root.join(path)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn list_files(&self) -> io::Result<Vec<String>> {
        list_files(&self.root)
    }
}

/// Files held in memory, for callers and tests that have no disk workspace.
#[derive(Default)]
pub struct MemoryFs {
    files: BTreeMap<String, Vec<u8>>,
}

impl MemoryFs {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, path: &str, bytes: impl Into<Vec<u8>>) {
        self.files.insert(normalize_path(path), bytes.into());
    }
}

impl SourceFs for MemoryFs {
    fn read(&self, path: &str) -> io::Result<Option<Vec<u8>>> {
        Ok(self.files.get(&normalize_path(path)).cloned())
    }

    fn list_files(&self) -> io::Result<Vec<String>> {
        Ok(self.files.keys().cloned().collect())
    }
}

/// Caller-supplied text laid over a base: a path with supplied text reads as
/// that text, any other path reads from the base. The base is never written.
pub struct Overlay<'a> {
    base: &'a dyn SourceFs,
    texts: BTreeMap<String, String>,
}

impl<'a> Overlay<'a> {
    pub fn new(base: &'a dyn SourceFs) -> Self {
        Self {
            base,
            texts: BTreeMap::new(),
        }
    }

    pub fn set(&mut self, path: &str, text: impl Into<String>) {
        self.texts.insert(normalize_path(path), text.into());
    }

    pub fn remove(&mut self, path: &str) {
        self.texts.remove(&normalize_path(path));
    }
}

impl SourceFs for Overlay<'_> {
    fn read(&self, path: &str) -> io::Result<Option<Vec<u8>>> {
        match self.texts.get(&normalize_path(path)) {
            Some(text) => Ok(Some(text.clone().into_bytes())),
            None => self.base.read(path),
        }
    }

    fn list_files(&self) -> io::Result<Vec<String>> {
        let mut files = self.base.list_files()?;
        files.extend(self.texts.keys().cloned());
        files.sort();
        files.dedup();
        Ok(files)
    }
}
