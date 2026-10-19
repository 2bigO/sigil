//! Hover: a Tag with its provider and consumers, a glossary term, a component.
use crate::{
    occurrences::{
        GlossaryReference, component_occurrences, contains, glossary_references, lsp_range,
        tag_occurrences,
    },
    params,
    render::{Renderer, glossary_markdown},
    server::{Answer, RequestError},
    snapshot::Snapshot,
    uri::file_uri_to_path,
};
use serde_json::{Map, Value, json};
use sigil_core::language::{
    parse::Span,
    path::normalize_path,
    position::{EditorPosition, EditorRange},
    resolve::{AccessStatus, FacetPos, TagRef},
};

/// The answer to `textDocument/hover`: a Markdown `Hover`, or null.
pub(crate) fn hover(snapshot: &Snapshot, params: &Value) -> Answer {
    let given = params::text_document_position(params)?;
    let path = file_uri_to_path(&given.uri)
        .map_err(|error| RequestError::Internal(error.message().to_owned()))?;
    let position = match (u32::try_from(given.line), u32::try_from(given.character)) {
        (Ok(line), Ok(character)) => EditorPosition { line, character },
        _ => return Ok(Value::Null),
    };
    Ok(hover_at(snapshot, &path, position).unwrap_or(Value::Null))
}

/// The hover of whatever is written at `position` in the file at `path`. The
/// first match wins: a Tag, a glossary term, a component name.
pub fn hover_at(snapshot: &Snapshot, path: &str, position: EditorPosition) -> Option<Value> {
    let file = snapshot.file_index(path)?;
    let byte = snapshot.byte_at(path, position)?;
    let at = |range: &Span| byte >= range.start && byte < range.end;
    let renderer = Renderer::new(snapshot);
    let glossary = glossary_references(snapshot, path)
        .into_iter()
        .find(|i| contains(&i.range, position));
    if let Some(found) = tag_occurrences(snapshot, file)
        .iter()
        .find(|i| at(&i.range))
    {
        let provider = found.tag.component;
        let name = &snapshot.resolved.components[provider].tags[found.tag.tag].name;
        let mut lines = vec![
            format!("### Tag {}", renderer.tag_link(found.tag)),
            String::new(),
            format!(
                "Origin: {} in `{}`",
                renderer.component_link(provider),
                renderer.display_path(
                    &snapshot.resolved.paths[snapshot.resolved.components[provider].file]
                )
            ),
            String::new(),
        ];
        lines.extend(renderer.component(provider));
        for &consumer in found.contexts.iter().filter(|&&c| c != provider) {
            lines.push(String::new());
            lines.push(format!(
                "**Consumer: {}**",
                renderer.component_link(consumer)
            ));
            for pos in component_facets_for(snapshot, consumer, name) {
                let item = &snapshot.resolved.components[consumer];
                let section = &snapshot.resolved.facet(item, pos).section;
                lines.push(format!("**{section}**"));
                lines.push(renderer.facet(consumer, pos));
            }
        }
        let matched = glossary.or_else(|| glossary_for_tag(snapshot, path, found.tag, found.range));
        if let Some(reference) = matched {
            lines.push(String::new());
            lines.push(glossary_markdown(&reference));
        }
        return Some(hover_value(
            lines.join("\n"),
            snapshot.editor_range(path, &found.range.range()),
        ));
    }
    if let Some(reference) = glossary {
        return Some(hover_value(
            glossary_markdown(&reference),
            Some(reference.range),
        ));
    }
    let found = component_occurrences(snapshot, file)
        .into_iter()
        .find(|i| at(&i.range))?;
    Some(hover_value(
        renderer.component(found.component).join("\n"),
        snapshot.editor_range(path, &found.range.range()),
    ))
}

fn hover_value(markdown: String, range: Option<EditorRange>) -> Value {
    let mut map = Map::new();
    map.insert(
        "contents".into(),
        json!({"kind": "markdown", "value": markdown}),
    );
    if let Some(range) = range {
        map.insert("range".into(), lsp_range(&range));
    }
    Value::Object(map)
}

/// The Facets of `consumer` that concern the Tag named `name`: those that
/// introduce it, reference it, or sit under its group heading when the
/// consumer defines it. In document order.
fn component_facets_for(snapshot: &Snapshot, consumer: usize, name: &str) -> Vec<FacetPos> {
    let resolved = &snapshot.resolved;
    let item = &resolved.components[consumer];
    let Some(tag) = item
        .accessible
        .iter()
        .find(|t| t.name == name && t.status == AccessStatus::Resolved)
        .and_then(|t| t.tag)
    else {
        return Vec::new();
    };
    let local = (tag.component == consumer).then(|| &item.tags[tag.tag]);
    let introduced: Vec<FacetPos> = local
        .iter()
        .flat_map(|t| t.introductions.iter())
        .filter(|i| i.valid)
        .filter_map(|i| i.facet)
        .collect();
    let referenced = |pos: FacetPos| {
        item.references
            .iter()
            .any(|r| r.tag == Some(tag) && r.facet == pos)
    };
    let mut found = Vec::new();
    for (section_index, section) in resolved.declaration(item).sections.iter().enumerate() {
        for (unit, facet) in section.units.iter().enumerate() {
            let pos = FacetPos {
                section: section_index,
                unit,
            };
            let grouped = local.is_some() && facet.group.as_ref().is_some_and(|g| g.name == name);
            if introduced.contains(&pos) || referenced(pos) || grouped {
                found.push(pos);
            }
        }
    }
    found
}

/// The glossary entry of the file's context that names the Tag, by term or
/// alias without regard to case, shown at the Tag's own range.
fn glossary_for_tag<'a>(
    snapshot: &'a Snapshot,
    path: &str,
    tag: TagRef,
    range: Span,
) -> Option<GlossaryReference<'a>> {
    let relative = snapshot.relative_path(path)?;
    let name = &snapshot.resolved.components[tag.component].tags[tag.tag].name;
    let context = snapshot
        .glossary
        .resolved_contexts
        .iter()
        .find(|c| normalize_path(&c.file_path) == relative)?;
    let lowered = name.to_lowercase();
    let term = context.entries.iter().find(|t| {
        std::iter::once(&t.term)
            .chain(&t.aliases)
            .any(|s| s.to_lowercase() == lowered)
    })?;
    Some(GlossaryReference {
        term,
        matched_spelling: name,
        range: snapshot.editor_range(path, &range.range())?,
    })
}
