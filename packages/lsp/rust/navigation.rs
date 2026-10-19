//! Go to definition.
use crate::{
    occurrences::{
        component_occurrences, contains, glossary_references, location, tag_definition,
        tag_occurrences,
    },
    params,
    server::Answer,
    snapshot::Snapshot,
    uri::file_uri_to_path,
};
use serde_json::Value;
use sigil_core::language::{parse::Span, position::EditorPosition};

/// The answer to `textDocument/definition`: a `Location`, or null.
pub(crate) fn definition(snapshot: &Snapshot, params: &Value) -> Answer {
    let given = params::text_document_position(params)?;
    let path = file_uri_to_path(&given.uri)
        .map_err(|error| crate::server::RequestError::Internal(error.message().to_owned()))?;
    let position = match (u32::try_from(given.line), u32::try_from(given.character)) {
        (Ok(line), Ok(character)) => EditorPosition { line, character },
        _ => return Ok(Value::Null),
    };
    Ok(definition_at(snapshot, &path, position).unwrap_or(Value::Null))
}

/// The definition of whatever is written at `position` in the file at `path`.
/// The first match wins: a Tag, a component name, an import path, a glossary
/// term.
pub(crate) fn definition_at(
    snapshot: &Snapshot,
    path: &str,
    position: EditorPosition,
) -> Option<Value> {
    let file = snapshot.file_index(path)?;
    let byte = snapshot.byte_at(path, position)?;
    let resolved = &snapshot.resolved;
    let at = |range: &Span| byte >= range.start && byte < range.end;
    if let Some(found) = tag_occurrences(snapshot, file)
        .iter()
        .find(|i| at(&i.range))
    {
        let (file_path, range) = tag_definition(snapshot, found.tag)?;
        return location(snapshot, &file_path, range);
    }
    if let Some(found) = component_occurrences(snapshot, file)
        .iter()
        .find(|i| at(&i.range))
    {
        let component = &resolved.components[found.component];
        let range = resolved.declaration(component).name_range;
        return location(snapshot, &resolved.paths[component.file], range);
    }
    let document = &resolved.documents[file];
    if let Some((target, provider)) = resolved.imports.iter().find_map(|item| {
        let target = item.target?;
        (item.file == file && at(&document.imports[item.declaration].path_range))
            .then_some((target, item.provider))
    }) {
        let range = provider.map_or(Span::default(), |p| {
            resolved.declaration(&resolved.components[p]).name_range
        });
        return location(snapshot, &resolved.paths[target], range);
    }
    let glossary = glossary_references(snapshot, path)
        .into_iter()
        .find(|i| contains(&i.range, position))?;
    let glossary_path = snapshot.glossary.glossary_path.as_deref()?;
    location(
        snapshot,
        glossary_path,
        Span::new(
            glossary.term.declaration_range.start,
            glossary.term.declaration_range.end,
        ),
    )
}
