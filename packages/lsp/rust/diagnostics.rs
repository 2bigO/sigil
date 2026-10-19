//! The diagnostics of a snapshot as `publishDiagnostics` payloads.
use crate::{occurrences::lsp_range, position::range_of, snapshot::Snapshot};
use serde_json::{Value, json};
use sigil_core::{
    language::{position::EditorRange, text::SourceText},
    types::{Diagnostic, Range, RelatedLocation, Severity},
};
use std::collections::{BTreeMap, HashMap};

/// What a file's ranges are read from, found once per file for a whole pass.
struct Readings<'a> {
    snapshot: &'a Snapshot,
    files: HashMap<&'a str, Option<(&'a SourceText, bool)>>,
}

impl<'a> Readings<'a> {
    fn new(snapshot: &'a Snapshot) -> Self {
        Self {
            snapshot,
            files: HashMap::new(),
        }
    }

    fn editor_range(&mut self, path: &'a str, range: &Range) -> Option<EditorRange> {
        let snapshot = self.snapshot;
        let (source, from_disk) = (*self
            .files
            .entry(path)
            .or_insert_with(|| snapshot.reading(path)))?;
        range_of(source, from_disk, range)
    }
}

/// The diagnostics of `snapshot` as LSP diagnostics, by file URI. A diagnostic
/// with no file has nowhere to be shown and is left out.
pub fn by_uri(snapshot: &Snapshot) -> BTreeMap<String, Vec<Value>> {
    let mut grouped: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    let mut readings = Readings::new(snapshot);
    for item in &snapshot.diagnostics {
        let Some(path) = &item.file_path else {
            continue;
        };
        grouped
            .entry(snapshot.uri_of(path))
            .or_default()
            .push(diagnostic(snapshot, &mut readings, item, path));
    }
    grouped
}

/// The range of a byte range in a file: the zero range when there is none,
/// and no range when the file was not read or an end falls inside a character.
fn location<'a>(
    readings: &mut Readings<'a>,
    path: &'a str,
    range: Option<&Range>,
) -> Option<Value> {
    let Some(range) = range else {
        return Some(zero_range());
    };
    Some(lsp_range(&readings.editor_range(path, range)?))
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

fn diagnostic<'a>(
    snapshot: &Snapshot,
    readings: &mut Readings<'a>,
    item: &'a Diagnostic,
    path: &'a str,
) -> Value {
    let range = location(readings, path, item.range.as_ref());
    let related_information: Vec<Value> = item
        .related
        .iter()
        .filter_map(|related| {
            let related_path = related.file_path.as_deref()?;
            let range = location(readings, related_path, related.range.as_ref())?;
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
        data["originalRange"] = serde_json::to_value(original).expect("a range serializes");
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
