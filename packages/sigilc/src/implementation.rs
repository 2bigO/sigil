//! Source-local semantic objects assembled without a source-language resolver.
use crate::{
    catalog::Catalog,
    design::SourceStatus,
    inputs::{PROJECTION_FORMAT, implementation_identity},
    kernel::{self, Limits, SaturatedWorld},
    sources::{Selection, discover, hash},
    store::{Freshness, LockedStore},
    turtle::{Assertion, ontology_fingerprint},
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[derive(Debug, Serialize)]
pub struct ImplementationReport {
    pub version: u32,
    pub input_fingerprint: String,
    pub implementation_fingerprint: String,
    pub catalog_fingerprint: String,
    pub intentional_empty: bool,
    pub all_fresh: bool,
    pub sources: Vec<SourceStatus>,
    pub assertion_sources: BTreeMap<String, Vec<String>>,
    pub world: SaturatedWorld,
}

pub struct Assembly {
    pub input_fingerprint: String,
    pub intentional_empty: bool,
    pub all_fresh: bool,
    pub sources: Vec<SourceStatus>,
    assertions: BTreeSet<Assertion>,
    assertion_sources: BTreeMap<String, Vec<String>>,
    catalog_fingerprint: String,
}

// @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::CurrentImplementation interface
pub fn assemble(
    root: &Path,
    selection: &Selection,
    catalog: &Catalog,
    store: &LockedStore,
    max_assertions: usize,
) -> Result<Assembly, String> {
    let manifest = discover(root, selection)?;
    let mut assertions = BTreeSet::new();
    let mut assertion_sources: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut sources = Vec::new();
    let mut count = 0usize;
    for file in &manifest.files {
        let inspection = store.inspect(&implementation_identity(file, catalog))?;
        if inspection.status == Freshness::Fresh {
            count = count.saturating_add(inspection.assertions.len());
            if count > max_assertions {
                return Err("aggregate Implementation assertion limit exceeded".into());
            }
            catalog.validate_implementation(&inspection.assertions)?;
            for fact in inspection.assertions {
                assertion_sources
                    .entry(fact.id())
                    .or_default()
                    .push(file.path.clone());
                assertions.insert(fact);
            }
        }
        sources.push(SourceStatus {
            source: file.path.clone(),
            status: inspection.status,
        });
    }
    let all_fresh = sources.iter().all(|s| s.status == Freshness::Fresh);
    let selected = manifest.files.iter().map(|f| f.path.as_str()).collect();
    sources.extend(
        store
            .deleted_sources("implementation", &selected)?
            .into_iter()
            .map(|source| SourceStatus {
                source,
                status: Freshness::Deleted,
            }),
    );
    sources.sort_by(|a, b| a.source.cmp(&b.source));
    let input_fingerprint = hash(
        &serde_json::to_vec(&(
            "sigil-implementation-input-v1",
            &manifest.fingerprint,
            ontology_fingerprint(),
            PROJECTION_FORMAT,
            catalog.fingerprint(),
        ))
        .map_err(|e| e.to_string())?,
    );
    Ok(Assembly {
        input_fingerprint,
        intentional_empty: manifest.intentional_empty,
        all_fresh,
        sources,
        assertions,
        assertion_sources,
        catalog_fingerprint: catalog.fingerprint().into(),
    })
}

impl Assembly {
    pub fn compile(self, limits: Limits) -> Result<ImplementationReport, String> {
        let facts: Vec<_> = self.assertions.into_iter().collect();
        let world = kernel::saturate(&facts, limits)?;
        let implementation_fingerprint = hash(
            &serde_json::to_vec(&(
                "sigil-implementation-world-v1",
                &self.input_fingerprint,
                &facts,
                &self.assertion_sources,
                &world.kernel_fingerprint,
            ))
            .map_err(|e| e.to_string())?,
        );
        Ok(ImplementationReport {
            version: 1,
            input_fingerprint: self.input_fingerprint,
            implementation_fingerprint,
            catalog_fingerprint: self.catalog_fingerprint,
            intentional_empty: self.intentional_empty,
            all_fresh: self.all_fresh,
            sources: self.sources,
            assertion_sources: self.assertion_sources,
            world,
        })
    }
}
