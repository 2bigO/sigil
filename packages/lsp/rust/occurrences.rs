//! What a source file mentions: component names, Tag identities and glossary
//! terms, as byte or editor ranges, and where a Tag is defined.
use crate::snapshot::Snapshot;
use serde_json::{Value, json};
use sigil_core::language::{
    glossary::GlossaryTerm,
    parse::Span,
    position::{EditorPosition, EditorRange},
    resolve::{AccessStatus, ImportStatus, IntroductionKind, NameStatus, TagRef, TagStatus},
};

/// A component name written in a file: a declaration, or the provider name of
/// an import that found its provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ComponentOccurrence {
    /// Index into `resolved.components`.
    pub component: usize,
    pub range: Span,
}

/// A Tag identity written in a file: an introduction, a bare reference, or a
/// name in an import selection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagOccurrence {
    pub tag: TagRef,
    /// The components that consume the Tag here, by index, in workspace order.
    pub contexts: Vec<usize>,
    /// The section that holds the occurrence; none in an import selection.
    pub section: Option<String>,
    pub range: Span,
}

/// A glossary term found in a file, with its editor range.
#[derive(Debug, Clone)]
pub struct GlossaryReference<'a> {
    pub term: &'a GlossaryTerm,
    pub matched_spelling: &'a str,
    pub range: EditorRange,
}

/// The component occurrences of the file at `file`, an index into
/// `resolved.paths`: its resolved declarations, then the provider names of
/// its resolved imports.
pub fn component_occurrences(snapshot: &Snapshot, file: usize) -> Vec<ComponentOccurrence> {
    let resolved = &snapshot.resolved;
    let mut found: Vec<ComponentOccurrence> = resolved
        .components
        .iter()
        .enumerate()
        .filter(|(_, c)| c.file == file && c.identity_resolved)
        .map(|(index, c)| ComponentOccurrence {
            component: index,
            range: resolved.declaration(c).name_range,
        })
        .collect();
    for item in resolved
        .imports
        .iter()
        .filter(|i| i.file == file && i.status == ImportStatus::Resolved)
    {
        let Some(component) = item.provider else {
            continue;
        };
        if resolved.components[component].identity_resolved {
            found.push(ComponentOccurrence {
                component,
                range: resolved.documents[file].imports[item.declaration].provider_range,
            });
        }
    }
    found
}

/// The Tag occurrences of the file at `file`: for each of its resolved
/// components the valid, complete introductions and the resolved references,
/// then the resolved selections of its imports.
pub fn tag_occurrences(snapshot: &Snapshot, file: usize) -> Vec<TagOccurrence> {
    let resolved = &snapshot.resolved;
    let is_resolved = |tag: TagRef| {
        resolved.components[tag.component].tags[tag.tag].status == TagStatus::Resolved
    };
    let mut found = Vec::new();
    for (index, component) in resolved.components.iter().enumerate() {
        if component.file != file || !component.identity_resolved {
            continue;
        }
        for (tag_index, tag) in component.tags.iter().enumerate() {
            if tag.status != TagStatus::Resolved {
                continue;
            }
            for introduction in tag.introductions.iter().filter(|i| i.valid && i.complete) {
                found.push(TagOccurrence {
                    tag: TagRef {
                        component: index,
                        tag: tag_index,
                    },
                    contexts: vec![index],
                    section: Some(introduction.section.clone()),
                    range: introduction.name_range,
                });
            }
        }
        let declaration = resolved.declaration(component);
        for reference in &component.references {
            let Some(tag) = reference.tag.filter(|t| is_resolved(*t)) else {
                continue;
            };
            if reference.status == AccessStatus::Resolved {
                found.push(TagOccurrence {
                    tag,
                    contexts: vec![index],
                    section: Some(declaration.sections[reference.facet.section].name.clone()),
                    range: reference.range,
                });
            }
        }
    }
    for item in resolved.imports.iter().filter(|i| i.file == file) {
        for selection in &item.names {
            let Some(tag) = selection.tag.filter(|t| is_resolved(*t)) else {
                continue;
            };
            if selection.status != NameStatus::Resolved {
                continue;
            }
            let mut contexts: Vec<usize> = selection.uses.iter().map(|u| u.component).collect();
            contexts.sort_unstable();
            contexts.dedup();
            found.push(TagOccurrence {
                tag,
                contexts,
                section: None,
                range: selection.range,
            });
        }
    }
    found
}

/// The glossary terms found in `path` (absolute or workspace-relative), in the
/// order the projection lists them. A term whose range has no editor position
/// is left out.
pub fn glossary_references<'a>(snapshot: &'a Snapshot, path: &str) -> Vec<GlossaryReference<'a>> {
    let Some(relative) = snapshot.relative_path(path) else {
        return Vec::new();
    };
    snapshot
        .glossary
        .occurrences
        .iter()
        .filter(|o| snapshot.relative_path(&o.file_path).as_deref() == Some(relative.as_str()))
        .filter_map(|o| {
            Some(GlossaryReference {
                term: &o.term,
                matched_spelling: &o.matched_spelling,
                range: snapshot.editor_range(&relative, &o.range)?,
            })
        })
        .collect()
}

/// Where a Tag is defined: the file and byte range of its inline definition,
/// else of its earliest valid group heading. None when no introduction is
/// valid and complete.
pub fn tag_definition(snapshot: &Snapshot, tag: TagRef) -> Option<(String, Span)> {
    let resolved = &snapshot.resolved;
    let owner = &resolved.components[tag.component];
    let valid = owner.tags[tag.tag]
        .introductions
        .iter()
        .filter(|i| i.valid && i.complete);
    let chosen = valid
        .clone()
        .find(|i| i.kind == IntroductionKind::Inline)
        .or_else(|| valid.min_by_key(|i| i.range.start))?;
    Some((resolved.paths[owner.file].clone(), chosen.name_range))
}

/// An LSP `Location` of a byte range in a file, or none when the file was not
/// read or an end of the range has no editor position.
pub fn location(snapshot: &Snapshot, path: &str, range: Span) -> Option<Value> {
    let found = snapshot.editor_range(path, &range.range())?;
    Some(json!({"uri": snapshot.uri_of(path), "range": lsp_range(&found)}))
}

/// An editor range as the LSP `Range` object.
pub fn lsp_range(range: &EditorRange) -> Value {
    json!({
        "start": {"line": range.start.line, "character": range.start.character},
        "end": {"line": range.end.line, "character": range.end.character},
    })
}

/// Whether the half-open range holds the position.
pub fn contains(range: &EditorRange, position: EditorPosition) -> bool {
    range.start <= position && position < range.end
}

/// Whether two half-open ranges share any position.
pub fn overlaps(a: &EditorRange, b: &EditorRange) -> bool {
    a.start < b.end && b.start < a.end
}
