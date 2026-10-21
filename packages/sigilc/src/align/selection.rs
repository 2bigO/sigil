//! Compiler-owned settings inside the core configuration's tools extension.
use crate::{
    language::{fs::DiskFs, tools::read_tool_settings},
    scope::{DesignMembership, design_membership},
    sources::{self, AlignmentManifest, Selection},
    structure::{DesignInput, EntityType, normalized_path},
};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::{collections::BTreeSet, path::Path};

const KEY: &str = "tools.sigilc.implementation";

#[derive(Debug, Clone, Serialize)]
pub struct ImplementationSelection {
    #[serde(flatten)]
    pub selection: Selection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub design: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct OutsideComponent {
    pub id: String,
    pub label: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSelection {
    pub fingerprint: String,
    /// Effective configuration only: neighboring content edits cannot invalidate
    /// another file's prepare binding through this digest.
    pub selection_fingerprint: String,
    pub config: ImplementationSelection,
    pub design: DesignMembership,
    pub outside_components: Vec<OutsideComponent>,
    pub implementation: AlignmentManifest,
}

/// Read `tools.sigilc.implementation` from the settings core merges from the
/// workspace config and the local override. Each layer is checked on its own
/// first, so an invalid shared value stays an error when the override replaces
/// it. Symlinked config files are refused before core reads them.
pub fn load(root: &Path) -> Result<ImplementationSelection, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    sources::checked_path(&root, ".sigil/config.json")?;
    sources::checked_path(&root, ".sigil/local.json")?;
    let settings = read_tool_settings(&DiskFs::new(&root)).map_err(|diagnostics| {
        diagnostics
            .iter()
            .map(|d| {
                if d.code == "SIGIL_CONFIG_NOT_FOUND" {
                    format!(".sigil/config.json ({KEY}): {}", d.message)
                } else {
                    d.message.clone()
                }
            })
            .collect::<Vec<_>>()
            .join("; ")
    })?;
    validate_layer(&settings.shared)?;
    if let Some(local) = &settings.local {
        validate_layer(local)?;
    }
    parse_settings(
        settings
            .merged
            .get("sigilc")
            .and_then(|sigilc| sigilc.get("implementation"))
            .ok_or_else(|| format!("missing required configuration key {KEY}"))?,
    )
}

fn validate_layer(tools: &Map<String, Value>) -> Result<(), String> {
    validate_namespace(&json!({ "tools": tools }))
}

fn validate_namespace(config: &Value) -> Result<(), String> {
    let Some(settings) = config.pointer("/tools/sigilc") else {
        return Ok(());
    };
    let object = settings
        .as_object()
        .ok_or("tools.sigilc must be a JSON object")?;
    for key in object.keys() {
        if key != "implementation" {
            return Err(format!("unknown configuration key tools.sigilc.{key}"));
        }
    }
    if let Some(implementation) = object.get("implementation") {
        parse_settings(implementation)?;
    }
    Ok(())
}

fn parse_settings(value: &Value) -> Result<ImplementationSelection, String> {
    let mut object = value
        .as_object()
        .ok_or_else(|| format!("{KEY} must be a JSON object"))?
        .clone();
    for (key, value) in &object {
        match key.as_str() {
            "allowEmpty" if value.is_boolean() => {}
            "paths" | "dirs" | "include" | "exclude" | "vendorDirs" | "design" => {
                if !value.as_array().is_some_and(|items| {
                    items
                        .iter()
                        .all(|v| v.as_str().is_some_and(|s| !s.is_empty()))
                }) {
                    return Err(format!("{KEY}.{key} must be an array of non-empty strings"));
                }
            }
            "allowEmpty" => return Err(format!("{KEY}.allowEmpty must be a boolean")),
            _ => return Err(format!("unknown configuration key {KEY}.{key}")),
        }
    }
    let design = object
        .remove("design")
        .map(serde_json::from_value)
        .transpose()
        .map_err(|e| format!("{KEY}.design: {e}"))?;
    let selection =
        serde_json::from_value(Value::Object(object)).map_err(|e| format!("{KEY}: {e}"))?;
    Ok(ImplementationSelection { selection, design })
}

impl ImplementationSelection {
    /// Resolve promise membership using the retained design scope closure. The
    /// full design stays intact for the design check and per-source bindings.
    pub fn resolve(
        &self,
        root: &Path,
        input: &DesignInput,
        max_bytes: u64,
    ) -> Result<ResolvedSelection, String> {
        input.assert_consistent()?;
        let all_sources: BTreeSet<_> = input.sources.iter().map(|s| s.path.clone()).collect();
        let roots = match &self.design {
            Some(paths) => {
                if paths.is_empty() {
                    return Err(format!(
                        "{KEY}.design must contain at least one design root"
                    ));
                }
                let mut unique = BTreeSet::new();
                for path in paths {
                    normalized_path(path).map_err(|e| format!("{KEY}.design: {e}"))?;
                    if !unique.insert(path) {
                        return Err(format!("{KEY}.design contains duplicate root {path}"));
                    }
                    if !all_sources.contains(path) {
                        return Err(format!("{KEY}.design root absent from workspace: {path}"));
                    }
                }
                paths.clone()
            }
            None => all_sources.iter().cloned().collect(),
        };
        let design = design_membership(input, roots.iter().map(String::as_str));
        let mut outside_components: Vec<_> = input
            .entities
            .iter()
            .filter(|e| e.kind == EntityType::Component && !design.sources.contains(&e.source))
            .map(|e| OutsideComponent {
                id: e.id.clone(),
                label: e.label.clone(),
                source: e.source.clone(),
            })
            .collect();
        outside_components.sort_by(|a, b| a.id.cmp(&b.id));
        let implementation =
            sources::discover_alignment(root, &self.selection, &all_sources, max_bytes)
                .map_err(|e| format!("{KEY}: {e}"))?;
        let selection_fingerprint = sources::hash(
            &serde_json::to_vec(&("sigil-align-config-v1", self, max_bytes))
                .map_err(|e| e.to_string())?,
        );
        let fingerprint = sources::hash(
            &serde_json::to_vec(&(
                "sigil-align-selection-v1",
                self,
                &design,
                &outside_components,
                &implementation,
                max_bytes,
            ))
            .map_err(|e| e.to_string())?,
        );
        Ok(ResolvedSelection {
            fingerprint,
            selection_fingerprint,
            config: self.clone(),
            design,
            outside_components,
            implementation,
        })
    }
}
