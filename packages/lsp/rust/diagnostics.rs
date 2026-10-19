//! The diagnostics of a snapshot as `publishDiagnostics` payloads.
use crate::snapshot::Snapshot;
use serde_json::{Value, json};
use sigil_core::types::{Diagnostic, RelatedLocation, Severity};
use std::collections::BTreeMap;

/// The diagnostics of `snapshot` as LSP diagnostics, by file URI. A diagnostic
/// with no file has nowhere to be shown and is left out.
pub fn by_uri(snapshot: &Snapshot) -> BTreeMap<String, Vec<Value>> {
    let mut grouped: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for item in &snapshot.diagnostics {
        let Some(path) = &item.file_path else {
            continue;
        };
        grouped
            .entry(snapshot.uri_of(path))
            .or_default()
            .push(diagnostic(snapshot, item, path));
    }
    grouped
}

/// The range of a byte range in a file: the zero range when there is none,
/// and no range when the file was not read or an end falls inside a character.
fn location(
    snapshot: &Snapshot,
    path: &str,
    range: Option<&sigil_core::types::Range>,
) -> Option<Value> {
    let Some(range) = range else {
        return Some(zero_range());
    };
    let found = snapshot.editor_range(path, range)?;
    Some(json!({
        "start": {"line": found.start.line, "character": found.start.character},
        "end": {"line": found.end.line, "character": found.end.character},
    }))
}

fn zero_range() -> Value {
    json!({"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 0}})
}

fn severity(severity: &Severity) -> u8 {
    match severity {
        Severity::Error => 1,
        Severity::Warning => 2,
        Severity::Info => 4,
    }
}

fn diagnostic(snapshot: &Snapshot, item: &Diagnostic, path: &str) -> Value {
    let range = location(snapshot, path, item.range.as_ref());
    let related_information: Vec<Value> = item
        .related
        .iter()
        .filter_map(|related| {
            let related_path = related.file_path.as_deref()?;
            let range = location(snapshot, related_path, related.range.as_ref())?;
            Some(json!({
                "location": {"uri": snapshot.uri_of(related_path), "range": range},
                "message": related.message.as_deref().unwrap_or(&item.message),
            }))
        })
        .collect();
    let related: Vec<Value> = item
        .related
        .iter()
        .map(|related| absolute_related(snapshot, related))
        .collect();
    let mut data = json!({
        "stage": item.stage,
        "coordinateSystem": "utf8-bytes",
        "locationAvailable": range.is_some(),
        "related": related,
    });
    if let Some(original) = &item.range {
        data["originalRange"] = json!({"start": original.start, "end": original.end});
    }
    json!({
        "range": range.unwrap_or_else(zero_range),
        "severity": severity(&item.severity),
        "code": item.code,
        "source": "sigil",
        "message": item.message,
        "relatedInformation": related_information,
        "data": data,
    })
}

/// A related location as `data.related` carries it: core's own fields, with
/// the file path made absolute.
fn absolute_related(snapshot: &Snapshot, related: &RelatedLocation) -> Value {
    let mut value = serde_json::to_value(related).expect("a related location serializes");
    if let Some(path) = &related.file_path {
        value["filePath"] = Value::String(snapshot.absolute_path(path));
    }
    value
}
