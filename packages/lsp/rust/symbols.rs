//! Document symbols: components, sections, local Tag groups and inline Tags.
use crate::{
    occurrences::lsp_range,
    params,
    position::{hides_mark, range_of},
    server::Answer,
    snapshot::Snapshot,
    uri::file_uri_to_path,
};
use serde_json::{Map, Value, json};
use sigil_core::language::{parse::Span, text::SourceText};

/// The answer to `textDocument/documentSymbol`: the tree of the document, or
/// an empty list when the file is not a document of the workspace.
pub(crate) fn document_symbols(snapshot: &Snapshot, params: &Value) -> Answer {
    let given = params::document_symbol(params)?;
    let path = file_uri_to_path(&given.uri)?;
    Ok(symbols_of(snapshot, &path))
}

/// The LSP `SymbolKind` of a component, and of everything inside one.
const CLASS: u8 = 5;
const PROPERTY: u8 = 7;

/// A symbol with the byte start that orders it among its siblings.
struct Entry {
    start: usize,
    value: Value,
}

fn symbols_of(snapshot: &Snapshot, path: &str) -> Value {
    let Some(document) = snapshot.document(path) else {
        return json!([]);
    };
    let Some(source) = &document.source else {
        return json!([]);
    };
    let from_disk = snapshot.from_disk(path);
    let symbol = |name: &str,
                  detail: &str,
                  kind: u8,
                  range: Span,
                  name_range: Span,
                  children: Vec<Value>| {
        let mut map = Map::new();
        map.insert("name".into(), json!(name));
        map.insert("detail".into(), json!(detail));
        map.insert("kind".into(), json!(kind));
        for (key, span) in [("range", range), ("selectionRange", name_range)] {
            if let Some(found) = editor_range(source, from_disk, span) {
                map.insert(key.into(), found);
            }
        }
        map.insert("children".into(), Value::Array(children));
        Entry {
            start: range.start,
            value: Value::Object(map),
        }
    };
    let components = document.components.iter().map(|component| {
        let sections = component
            .sections
            .iter()
            .map(|section| {
                let mut children: Vec<Entry> = section
                    .groups
                    .iter()
                    .map(|g| {
                        symbol(
                            &g.name,
                            "Tag group",
                            PROPERTY,
                            g.range,
                            g.name_range,
                            Vec::new(),
                        )
                    })
                    .chain(section.units.iter().flat_map(|facet| {
                        facet.definitions.iter().filter(|d| d.valid).map(|d| {
                            symbol(
                                &d.name,
                                "inline Tag",
                                PROPERTY,
                                d.range,
                                d.name_range,
                                Vec::new(),
                            )
                        })
                    }))
                    .collect();
                children.sort_by_key(|entry| entry.start);
                symbol(
                    &section.name,
                    "section",
                    PROPERTY,
                    section.range,
                    section.name_range,
                    children.into_iter().map(|e| e.value).collect(),
                )
                .value
            })
            .collect();
        symbol(
            &component.name,
            "component",
            CLASS,
            component.range,
            component.name_range,
            sections,
        )
        .value
    });
    Value::Array(components.collect())
}

/// The editor range of a symbol. A disk file's hidden byte-order mark is not a
/// position, so a symbol that starts at the file's first byte starts at line 0,
/// character 0, the first visible one.
fn editor_range(source: &SourceText, from_disk: bool, span: Span) -> Option<Value> {
    let hidden = if hides_mark(source, from_disk) {
        '\u{feff}'.len_utf8()
    } else {
        0
    };
    let clamped = Span::new(span.start.max(hidden), span.end.max(hidden));
    let found = range_of(source, from_disk, &clamped.range())?;
    Some(lsp_range(&found))
}
