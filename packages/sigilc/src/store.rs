//! Small disposable index and atomic per-source publication. No job registry.
use crate::{
    assertions,
    frontend::normalized_path,
    inputs::{Binding, SemanticInput},
    sources::{self, hash},
    turtle::{Assertion, TurtleLimits},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub const ARTIFACT_EVIDENCE_VERSION: u32 = 1;

const WORLDS: &str = ".sigil/worlds";
const INDEX: &str = ".sigil/worlds/index.json";
const WORKFLOW_STATE: &str = ".sigil/workflow/request.json";
const WORKFLOW_ARCHIVE: &str = ".sigil/workflow/archive";
const WORKFLOW_INPUTS: &str = ".sigil/workflow/inputs";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Job {
    pub version: u32,
    pub binding: Binding,
    pub expected_generation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub binding: Binding,
    pub assertion_checksum: String,
    pub generation: String,
    #[serde(default)]
    pub artifact: Option<ArtifactEvidence>,
}

/// Caller-supplied links retained with an accepted projection. These are
/// references to external process/output records, never model assertions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactEvidence {
    pub version: u32,
    pub binding: String,
    pub generation: String,
    pub preparation: String,
    pub job: String,
    pub job_fingerprint: String,
    pub worker: String,
    pub ingest: String,
    pub attempts: Vec<ArtifactAttempt>,
    pub projection: String,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactAttempt {
    pub turtle: String,
    pub result: String,
    pub exit: u8,
}

/// An external attempt record. The final pending attempt intentionally has no
/// exit yet: native ingest records its actual successful exit during publication.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactAttemptInput {
    pub turtle: String,
    pub result: String,
    pub exit: Option<u8>,
}

/// Input written by the external subagent/caller. Rejected attempts carry their
/// observed exit; the final attempt is pending and becomes exit zero only when
/// this native command accepts the projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactEvidenceInput {
    pub version: u32,
    pub preparation: String,
    pub job: String,
    pub worker: String,
    pub ingest: String,
    pub attempts: Vec<ArtifactAttemptInput>,
}

const MAX_ARTIFACT_REF_BYTES: usize = 4_096;
const MAX_ARTIFACT_ATTEMPTS: usize = 128;

impl ArtifactEvidenceInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != ARTIFACT_EVIDENCE_VERSION {
            return Err("unsupported artifact evidence version".into());
        }
        for (name, value) in [
            ("preparation", &self.preparation),
            ("job", &self.job),
            ("worker", &self.worker),
            ("ingest", &self.ingest),
        ] {
            validate_artifact_ref(name, value)?;
        }
        if self.attempts.is_empty() {
            return Err("artifact evidence requires at least one ingest attempt".into());
        }
        if self.attempts.len() > MAX_ARTIFACT_ATTEMPTS {
            return Err("artifact evidence has too many ingest attempts".into());
        }
        for (index, attempt) in self.attempts.iter().enumerate() {
            validate_artifact_ref(&format!("attempt {index} Turtle"), &attempt.turtle)?;
            validate_artifact_ref(&format!("attempt {index} result"), &attempt.result)?;
            let is_final = index + 1 == self.attempts.len();
            if is_final && attempt.exit.is_some() {
                return Err(
                    "final artifact evidence attempt must have exit null until native ingest accepts it"
                        .into(),
                );
            }
            if !is_final && attempt.exit.is_none() {
                return Err("only the final artifact evidence attempt may have exit null".into());
            }
        }
        Ok(())
    }
}

impl ArtifactEvidence {
    fn build(
        input: Option<ArtifactEvidenceInput>,
        current: &Binding,
        generation: &str,
        key: &str,
        job: &Job,
    ) -> Result<Self, String> {
        let projection = format!(".sigil/worlds/{key}.egg");
        let Some(input) = input else {
            return Ok(Self {
                version: 1,
                binding: current.fingerprint(),
                generation: generation.into(),
                preparation: String::new(),
                job: String::new(),
                job_fingerprint: String::new(),
                worker: String::new(),
                ingest: String::new(),
                attempts: Vec::new(),
                projection,
                complete: false,
            });
        };
        input.validate()?;
        let mut attempts: Vec<ArtifactAttempt> = input
            .attempts
            .iter()
            .take(input.attempts.len() - 1)
            .map(|attempt| ArtifactAttempt {
                turtle: attempt.turtle.clone(),
                result: attempt.result.clone(),
                exit: attempt.exit.expect("validated non-final artifact attempt"),
            })
            .collect();
        let accepted = input.attempts.last().expect("validated artifact attempts");
        attempts.push(ArtifactAttempt {
            turtle: accepted.turtle.clone(),
            result: accepted.result.clone(),
            exit: 0,
        });
        Ok(Self {
            version: ARTIFACT_EVIDENCE_VERSION,
            binding: current.fingerprint(),
            generation: generation.into(),
            preparation: input.preparation,
            job: input.job,
            job_fingerprint: hash(
                &serde_json::to_vec(&("sigil-job-v2", job)).map_err(|e| e.to_string())?,
            ),
            worker: input.worker,
            ingest: input.ingest,
            attempts,
            projection,
            complete: true,
        })
    }

    fn validate_for(&self, binding: &Binding, generation: &str, key: &str) -> Result<(), String> {
        if self.version != ARTIFACT_EVIDENCE_VERSION
            || self.binding != binding.fingerprint()
            || self.generation != generation
            || (self.complete && !checksum(&self.job_fingerprint))
            || self.projection != format!(".sigil/worlds/{key}.egg")
        {
            return Err(format!("invalid artifact evidence for projection: {key}"));
        }
        if self.complete {
            if self.attempts.is_empty() || self.attempts.len() > MAX_ARTIFACT_ATTEMPTS {
                return Err(format!("invalid artifact attempts for projection: {key}"));
            }
            for (index, attempt) in self.attempts.iter().enumerate() {
                validate_artifact_ref(&format!("attempt {index} Turtle"), &attempt.turtle)?;
                validate_artifact_ref(&format!("attempt {index} result"), &attempt.result)?;
            }
            if self.attempts.last().is_none_or(|attempt| attempt.exit != 0) {
                return Err(format!(
                    "invalid accepted artifact attempt for projection: {key}"
                ));
            }
            for (name, value) in [
                ("preparation", &self.preparation),
                ("job", &self.job),
                ("worker", &self.worker),
                ("ingest", &self.ingest),
            ] {
                validate_artifact_ref(name, value)?;
            }
            Ok(())
        } else if self.preparation.is_empty()
            && self.job.is_empty()
            && self.job_fingerprint.is_empty()
            && self.worker.is_empty()
            && self.ingest.is_empty()
            && self.attempts.is_empty()
        {
            Ok(())
        } else {
            Err(format!(
                "invalid incomplete artifact evidence for projection: {key}"
            ))
        }
    }
}

fn validate_artifact_ref(name: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("artifact evidence {name} reference is empty"));
    }
    if value.len() > MAX_ARTIFACT_REF_BYTES {
        return Err(format!(
            "artifact evidence {name} reference exceeds byte limit"
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(format!(
            "artifact evidence {name} reference contains control characters"
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Index {
    version: u32,
    entries: BTreeMap<String, Entry>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Freshness {
    Fresh,
    Missing,
    Modified,
    DependencyInvalidated,
    EntityCatalogInvalidated,
    Incompatible,
    Incomplete,
    Deleted,
}

#[derive(Debug)]
pub struct Inspection {
    pub status: Freshness,
    pub assertions: Vec<Assertion>,
}

#[derive(Clone, Copy)]
pub struct StoreLimits {
    pub max_index_bytes: u64,
    pub max_source_bytes: u64,
    pub assertions: TurtleLimits,
}
impl Default for StoreLimits {
    fn default() -> Self {
        Self {
            max_index_bytes: 16_000_000,
            max_source_bytes: 16_000_000,
            assertions: TurtleLimits {
                max_document_bytes: 8_000_000,
                max_assertions: 100_000,
            },
        }
    }
}

/// Owns the exclusive lock until dropped. Host code computes current Design and
/// catalog bindings inside this lifetime before preparing or publishing.
pub struct LockedStore {
    root: PathBuf,
    _lock: File,
    index: Index,
    limits: StoreLimits,
}

impl LockedStore {
    pub fn open(root: &Path, limits: StoreLimits) -> Result<Self, String> {
        let (root, lock) = acquire(root)?;
        let index = match fs::symlink_metadata(sources::checked_path(&root, INDEX)?) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Index {
                version: 2,
                entries: BTreeMap::new(),
            },
            Err(e) => return Err(e.to_string()),
            Ok(_) => serde_json::from_slice::<Index>(
                &sources::capture(&root, INDEX, limits.max_index_bytes)?.bytes,
            )
            .map_err(|e| format!("invalid projection index: {e}"))?,
        };
        if index.version != 2 {
            return Err("unsupported projection index version".into());
        }
        for (key, entry) in &index.entries {
            if *key != object_key(&entry.binding)? && *key != history_key(&entry.binding)?
                || !checksum(&entry.generation)
                || !checksum(&entry.assertion_checksum)
            {
                return Err(format!("invalid projection index entry: {key}"));
            }
            if let Some(artifact) = &entry.artifact {
                artifact.validate_for(&entry.binding, &entry.generation, key)?;
            }
        }
        Ok(Self {
            root,
            _lock: lock,
            index,
            limits,
        })
    }

    pub fn entries(&self) -> &BTreeMap<String, Entry> {
        &self.index.entries
    }

    /// Read the single native scoped-request ledger while holding the same
    /// workspace lock used for projection inspection and publication.
    pub(crate) fn workflow_state(&self) -> Result<Option<Vec<u8>>, String> {
        let path = sources::checked_path(&self.root, WORKFLOW_STATE)?;
        match fs::read(path) {
            Ok(bytes) => {
                if bytes.len() as u64 > self.limits.max_index_bytes {
                    Err("scoped request state exceeds byte limit".into())
                } else {
                    Ok(Some(bytes))
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Atomically replace the native scoped-request ledger. This state is
    /// intentionally separate from `.sigil/worlds`, which remains disposable
    /// projection cache data.
    pub(crate) fn publish_workflow_state(&self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() as u64 > self.limits.max_index_bytes {
            return Err("scoped request state exceeds byte limit".into());
        }
        atomic_write(&self.root, WORKFLOW_STATE, bytes)
    }

    /// Keep the structural input used by a durable request outside caller-owned
    /// temporary directories. Unlike worlds, this is request replay input.
    pub(crate) fn publish_workflow_frontend(
        &self,
        fingerprint: &str,
        bytes: &[u8],
    ) -> Result<String, String> {
        if bytes.len() as u64 > self.limits.max_index_bytes {
            return Err("scoped request frontend capture exceeds byte limit".into());
        }
        if !checksum(fingerprint) {
            return Err("invalid scoped request frontend fingerprint".into());
        }
        let path = format!("{WORKFLOW_INPUTS}/{fingerprint}.json");
        atomic_write(&self.root, &path, bytes)?;
        Ok(path)
    }

    /// Preserve the current request under its immutable fingerprint, then clear
    /// the single active request slot. Request history stays native and separate
    /// from disposable projection worlds.
    pub(crate) fn archive_workflow_state(&self, fingerprint: &str) -> Result<String, String> {
        let state = self
            .workflow_state()?
            .ok_or_else(|| "no scoped request exists; run request create".to_owned())?;
        let archive = format!("{WORKFLOW_ARCHIVE}/{fingerprint}.json");
        atomic_write(&self.root, &archive, &state)?;
        fs::remove_file(sources::checked_path(&self.root, WORKFLOW_STATE)?)
            .map_err(|e| e.to_string())?;
        Ok(archive)
    }

    pub fn deleted_sources(
        &self,
        side: &str,
        selected: &std::collections::BTreeSet<&str>,
    ) -> Result<Vec<String>, String> {
        let mut deleted = std::collections::BTreeSet::new();
        for entry in self.index.entries.values() {
            let path = &entry.binding.source.path;
            if entry.binding.side() != side || selected.contains(path.as_str()) {
                continue;
            }
            match fs::symlink_metadata(sources::checked_path(&self.root, path)?) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    deleted.insert(path.clone());
                }
                Err(e) => return Err(e.to_string()),
                Ok(_) => (),
            }
        }
        Ok(deleted.into_iter().collect())
    }

    /// Return a descriptor to the external caller before it supplies Turtle.
    pub fn prepare(&self, binding: Binding) -> Result<Job, String> {
        compatible(&binding)?;
        self.check_live(&binding)?;
        let expected_generation = self
            .entry_for(&binding)
            .map(|(_, entry)| entry.generation.clone());
        Ok(Job {
            version: 2,
            binding,
            expected_generation,
        })
    }

    // @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::ProjectionPublication interface
    pub fn publish(
        &mut self,
        job: &Job,
        current: &Binding,
        facts: &[Assertion],
        evidence: Option<ArtifactEvidenceInput>,
    ) -> Result<String, String> {
        compatible(current)?;
        let key = object_key(current)?;
        if job.version != 2 || job.binding != *current {
            return Err("prepared semantic inputs no longer match current inputs".into());
        }
        if self
            .entry_for(current)
            .map(|(_, entry)| entry.generation.as_str())
            != job.expected_generation.as_deref()
        {
            return Err("projection generation changed; prepare a new job".into());
        }
        self.check_live(current)?;
        if facts.len() > self.limits.assertions.max_assertions {
            return Err("projection assertion count exceeds limit".into());
        }
        let encoded = assertions::encode(facts)?;
        if encoded.len() > self.limits.assertions.max_document_bytes {
            return Err("encoded projection exceeds byte limit".into());
        }
        let mut nonce = [0u8; 32];
        getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
        let generation = hash(&nonce);
        let mut proposed = self.index.clone();
        if let Some(previous) = proposed.entries.get(&key).cloned()
            && previous.binding != *current
        {
            let previous_key = history_key(&previous.binding)?;
            preserve_projection(&self.root, &key, &previous_key, self.limits)?;
            let mut previous = previous;
            if let Some(artifact) = &mut previous.artifact {
                artifact.projection = format!(".sigil/worlds/{previous_key}.egg");
            }
            proposed.entries.insert(previous_key, previous);
            proposed.entries.remove(&key);
        }
        let artifact = ArtifactEvidence::build(evidence, current, &generation, &key, job)?;
        proposed.entries.insert(
            key.clone(),
            Entry {
                binding: current.clone(),
                assertion_checksum: hash(encoded.as_bytes()),
                generation: generation.clone(),
                artifact: Some(artifact),
            },
        );
        let data = serde_json::to_vec(&proposed).map_err(|e| e.to_string())?;
        if data.len() as u64 > self.limits.max_index_bytes {
            return Err("projection index exceeds byte limit".into());
        }
        // A crash between replacements leaves a detectable checksum mismatch or
        // orphan. Failed publication never becomes current in this handle either.
        atomic_write(
            &self.root,
            &format!("{WORLDS}/{key}.egg"),
            encoded.as_bytes(),
        )?;
        atomic_write(&self.root, INDEX, &data)?;
        self.index = proposed;
        Ok(generation)
    }

    // @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::IndexedAssembly interface
    pub fn inspect(&self, current: &Binding) -> Result<Inspection, String> {
        compatible(current)?;
        let Some((key, entry)) = self.entry_for(current) else {
            let key = object_key(current)?;
            let Some(entry) = self.index.entries.get(&key) else {
                return Ok(inspected(Freshness::Missing));
            };
            return Ok(inspected(freshness(&entry.binding, current)));
        };
        let status = freshness(&entry.binding, current);
        if status != Freshness::Fresh {
            return Ok(inspected(status));
        }
        let path = format!("{WORLDS}/{key}.egg");
        match fs::symlink_metadata(sources::checked_path(&self.root, &path)?) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(inspected(Freshness::Incomplete));
            }
            Err(e) => return Err(e.to_string()),
            Ok(meta) if !meta.is_file() => return Err("projection is not a regular file".into()),
            _ => (),
        }
        let captured = sources::capture(
            &self.root,
            &path,
            self.limits.assertions.max_document_bytes as u64,
        )?;
        if captured.identity.checksum != entry.assertion_checksum {
            return Ok(inspected(Freshness::Incomplete));
        }
        let Ok(source) = std::str::from_utf8(&captured.bytes) else {
            return Ok(inspected(Freshness::Incomplete));
        };
        match assertions::parse(source, self.limits.assertions) {
            Ok(assertions) => Ok(Inspection {
                status: Freshness::Fresh,
                assertions,
            }),
            Err(_) => Ok(inspected(Freshness::Incomplete)),
        }
    }

    /// Return the accepted artifact chain for a complete binding. An absent
    /// value means the projection predates native artifact evidence.
    pub fn artifact(&self, binding: &Binding) -> Option<&ArtifactEvidence> {
        self.entry_for(binding)
            .and_then(|(_, entry)| entry.artifact.as_ref())
    }

    // @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::BindingHistory interface
    fn entry_for(&self, binding: &Binding) -> Option<(String, &Entry)> {
        let key = object_key(binding).ok()?;
        if let Some(entry) = self.index.entries.get(&key)
            && entry.binding == *binding
        {
            return Some((key, entry));
        }
        let history = history_key(binding).ok()?;
        self.index
            .entries
            .get(&history)
            .filter(|entry| entry.binding == *binding)
            .map(|entry| (history, entry))
    }

    fn check_live(&self, binding: &Binding) -> Result<(), String> {
        let mut inputs = vec![(&binding.source.path, Some(binding.source.checksum.as_str()))];
        if let SemanticInput::Design {
            dependencies,
            context,
            ..
        } = &binding.semantic
        {
            inputs.extend(
                dependencies
                    .iter()
                    .map(|d| (&d.path, Some(d.checksum.as_str()))),
            );
            inputs.extend(context.iter().map(|c| (&c.path, c.checksum.as_deref())));
        }
        for (path, expected) in inputs {
            if let Some(expected) = expected {
                let current = sources::capture(&self.root, path, self.limits.max_source_bytes)?;
                if current.identity.checksum != expected {
                    return Err(format!("source input changed: {path}"));
                }
            } else {
                match fs::symlink_metadata(sources::checked_path(&self.root, path)?) {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                    Err(e) => return Err(e.to_string()),
                    Ok(_) => return Err(format!("source input appeared: {path}")),
                }
            }
        }
        Ok(())
    }
}

// @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::DisposableCleanup interface
pub fn clean(root: &Path) -> Result<Vec<String>, String> {
    let (root, _lock) = acquire(root)?;
    let mut removed = Vec::new();
    for entry in fs::read_dir(sources::checked_path(&root, WORLDS)?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name() == ".lock" {
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        // read_dir's file type does not follow symlinks. Never resolve a cache
        // entry's target; recursive removal also leaves symlink targets intact.
        if kind.is_dir() {
            fs::remove_dir_all(entry.path())
        } else {
            fs::remove_file(entry.path())
        }
        .map_err(|e| e.to_string())?;
        removed.push(format!("{WORLDS}/{}", entry.file_name().to_string_lossy()));
    }
    removed.sort();
    Ok(removed)
}

fn acquire(root: &Path) -> Result<(PathBuf, File), String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    fs::create_dir_all(sources::checked_path(&root, WORLDS)?).map_err(|e| e.to_string())?;
    let path = sources::checked_path(&root, &format!("{WORLDS}/.lock"))?;
    regular_or_absent(&path)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|e| format!("projection store lock unavailable: {e}"))?;
    Ok((root, lock))
}

fn inspected(status: Freshness) -> Inspection {
    Inspection {
        status,
        assertions: vec![],
    }
}

fn object_key(binding: &Binding) -> Result<String, String> {
    normalized_path(&binding.source.path)?;
    Ok(format!("{}/{}", binding.side(), binding.source.path))
}

fn history_key(binding: &Binding) -> Result<String, String> {
    Ok(format!(
        "{}~{}",
        object_key(binding)?,
        binding.fingerprint()
    ))
}

fn preserve_projection(
    root: &Path,
    current_key: &str,
    history_key: &str,
    limits: StoreLimits,
) -> Result<(), String> {
    let current = format!("{WORLDS}/{current_key}.egg");
    let history = format!("{WORLDS}/{history_key}.egg");
    let current_path = sources::checked_path(root, &current)?;
    if !regular_or_absent(&current_path)? {
        return Ok(());
    }
    let captured = sources::capture(root, &current, limits.assertions.max_document_bytes as u64)?;
    atomic_write(root, &history, &captured.bytes)
}

fn checksum(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn compatible(binding: &Binding) -> Result<(), String> {
    if binding.ontology != crate::turtle::ontology_fingerprint()
        || binding.projection_format != crate::inputs::PROJECTION_FORMAT
    {
        return Err("incompatible ontology or projection format".into());
    }
    Ok(())
}

fn freshness(previous: &Binding, current: &Binding) -> Freshness {
    if previous.ontology != current.ontology
        || previous.projection_format != current.projection_format
    {
        Freshness::Incompatible
    } else if previous.source != current.source {
        Freshness::Modified
    } else if previous.semantic != current.semantic {
        match (&previous.semantic, &current.semantic) {
            (SemanticInput::Implementation { .. }, SemanticInput::Implementation { .. }) => {
                Freshness::EntityCatalogInvalidated
            }
            (SemanticInput::Design { .. }, SemanticInput::Design { .. }) => {
                Freshness::DependencyInvalidated
            }
            _ => Freshness::Incompatible,
        }
    } else {
        Freshness::Fresh
    }
}

fn atomic_write(root: &Path, relative: &str, bytes: &[u8]) -> Result<(), String> {
    let target = sources::checked_path(root, relative)?;
    regular_or_absent(&target)?;
    fs::create_dir_all(target.parent().ok_or("artifact has no parent")?)
        .map_err(|e| e.to_string())?;
    let temporary = sources::checked_path(root, &format!("{relative}.tmp"))?;
    if regular_or_absent(&temporary)? {
        fs::remove_file(&temporary).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(temporary, target).map_err(|e| e.to_string())
}

fn regular_or_absent(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => Ok(true),
        Ok(_) => Err(format!(
            "artifact is not a regular file: {}",
            path.display()
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
