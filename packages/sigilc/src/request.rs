//! A single durable ordered scoped-request ledger.
//!
//! This is deliberately a small state record, not a worker queue or job
//! database. External workers still perform preparation, reconstruction,
//! tests, and approval; `request status` only recomputes native gates and
//! releases items whose declared predecessors are terminal.
use crate::scope::Scope;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestDefinition {
    pub version: u32,
    pub id: String,
    pub items: Vec<RequestItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestItem {
    pub id: String,
    pub scope: Scope,
    #[serde(default)]
    pub after: Vec<String>,
    /// Opaque references to externally produced delivery/check/deletion
    /// evidence. The compiler records them but never validates or interprets
    /// their claims.
    #[serde(default)]
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LifecycleState {
    Queued,
    Ready,
    Closed,
    Converged,
    Drift,
    Unavailable,
}

impl LifecycleState {
    pub fn terminal(&self) -> bool {
        matches!(self, Self::Closed | Self::Converged)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemState {
    pub id: String,
    pub after: Vec<String>,
    pub evidence: Vec<String>,
    pub state: LifecycleState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersistedRequest {
    pub version: u32,
    pub request_fingerprint: String,
    pub frontend: String,
    pub frontend_input_fingerprint: String,
    pub definition: RequestDefinition,
    pub items: Vec<ItemState>,
}

pub fn validate(definition: &RequestDefinition) -> Result<(), String> {
    if definition.version != VERSION {
        return Err("unsupported scoped request version".into());
    }
    if definition.id.trim().is_empty() {
        return Err("scoped request id must be nonempty".into());
    }
    if definition.items.is_empty() {
        return Err("scoped request requires at least one item".into());
    }
    let mut ids = BTreeSet::new();
    for item in &definition.items {
        if item.id.trim().is_empty() {
            return Err("scoped request item id must be nonempty".into());
        }
        if !ids.insert(item.id.as_str()) {
            return Err(format!("duplicate scoped request item id: {}", item.id));
        }
        if item.scope.version != VERSION {
            return Err(format!("unsupported scope version for item {}", item.id));
        }
        if item
            .evidence
            .iter()
            .any(|reference| reference.trim().is_empty())
        {
            return Err(format!("empty evidence reference for {}", item.id));
        }
        let mut predecessors = BTreeSet::new();
        for predecessor in &item.after {
            if predecessor == &item.id {
                return Err(format!(
                    "scoped request item cannot depend on itself: {}",
                    item.id
                ));
            }
            if !predecessors.insert(predecessor.as_str()) {
                return Err(format!(
                    "duplicate predecessor {predecessor} for {}",
                    item.id
                ));
            }
        }
    }
    let known: BTreeSet<_> = definition
        .items
        .iter()
        .map(|item| item.id.as_str())
        .collect();
    let positions: BTreeMap<_, _> = definition
        .items
        .iter()
        .enumerate()
        .map(|(index, item)| (item.id.as_str(), index))
        .collect();
    for item in &definition.items {
        for predecessor in &item.after {
            if !known.contains(predecessor.as_str()) {
                return Err(format!("unknown predecessor {predecessor} for {}", item.id));
            }
            if positions[predecessor.as_str()] >= positions[item.id.as_str()] {
                return Err(format!(
                    "predecessor {predecessor} must precede {} in scoped request order",
                    item.id
                ));
            }
        }
    }
    let graph: BTreeMap<_, _> = definition
        .items
        .iter()
        .map(|item| {
            (
                item.id.as_str(),
                item.after.iter().map(String::as_str).collect::<Vec<_>>(),
            )
        })
        .collect();
    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    for id in graph.keys() {
        visit(id, &graph, &mut visiting, &mut visited)?;
    }
    Ok(())
}

fn visit<'a>(
    id: &'a str,
    graph: &BTreeMap<&'a str, Vec<&'a str>>,
    visiting: &mut BTreeSet<&'a str>,
    visited: &mut BTreeSet<&'a str>,
) -> Result<(), String> {
    if visited.contains(id) {
        return Ok(());
    }
    if !visiting.insert(id) {
        return Err(format!("scoped request predecessor cycle at {id}"));
    }
    for predecessor in &graph[id] {
        visit(predecessor, graph, visiting, visited)?;
    }
    visiting.remove(id);
    visited.insert(id);
    Ok(())
}

pub fn fingerprint(definition: &RequestDefinition) -> Result<String, String> {
    let bytes =
        serde_json::to_vec(&("sigil-scoped-request-v1", definition)).map_err(|e| e.to_string())?;
    Ok(crate::sources::hash(&bytes))
}

pub fn new_state(
    definition: RequestDefinition,
    frontend: String,
    frontend_input_fingerprint: String,
    scopes: Vec<Value>,
) -> Result<PersistedRequest, String> {
    validate(&definition)?;
    if scopes.len() != definition.items.len() {
        return Err("scoped request scope report count does not match items".into());
    }
    let items = definition
        .items
        .iter()
        .zip(scopes)
        .map(|(item, scope)| ItemState {
            id: item.id.clone(),
            after: item.after.clone(),
            evidence: item.evidence.clone(),
            state: if item.after.is_empty() {
                LifecycleState::Ready
            } else {
                LifecycleState::Queued
            },
            scope: Some(scope),
            gate: None,
            input_fingerprint: None,
            reason: None,
        })
        .collect();
    Ok(PersistedRequest {
        version: VERSION,
        request_fingerprint: fingerprint(&definition)?,
        frontend,
        frontend_input_fingerprint,
        definition,
        items,
    })
}

pub fn load(bytes: Option<Vec<u8>>) -> Result<PersistedRequest, String> {
    let bytes = bytes.ok_or_else(|| "no scoped request exists; run request create".to_owned())?;
    let state: PersistedRequest =
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid scoped request state: {e}"))?;
    if state.version != VERSION {
        return Err("unsupported scoped request state version".into());
    }
    validate(&state.definition)?;
    if state.request_fingerprint != fingerprint(&state.definition)? {
        return Err("scoped request definition fingerprint mismatch".into());
    }
    if state.items.len() != state.definition.items.len()
        || state
            .items
            .iter()
            .zip(&state.definition.items)
            .any(|(actual, expected)| {
                actual.id != expected.id
                    || actual.after != expected.after
                    || actual.evidence != expected.evidence
            })
    {
        return Err("scoped request item state does not match definition".into());
    }
    Ok(state)
}

pub fn encode(state: &PersistedRequest) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(state).map_err(|e| e.to_string())
}
