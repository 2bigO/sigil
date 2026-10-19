//! The `parse` command: one source document with a source range for each part.
//!
//! The workspace is found from the file's path and only its config is read, so
//! a `.sigil` file that the include and exclude patterns leave out parses too.
//! The file itself is read through the core's filesystem and parsed by the
//! core's parser. JSON is the default format.
use crate::{
    Context,
    args::{Format, ParseRequest},
    display::{Display, path_text, resolve_target},
    model::{DiagnosticView, LocationView, WorkspaceMeta, exit_code, view, views},
    output::{Markdown, Output, diagnostic_lines, fail, lines_text, render},
    session::{CONFIG_NOT_FOUND, Discovered, config_missing_message, discover},
};
use serde::Serialize;
use sigil_core::{
    language::{
        config::parse_config,
        diagnostics::{Location, diagnostic, order_diagnostics},
        fs::{DiskFs, SourceFs},
        parse::{
            Component, Document, Facet, Group, Import, InvalidRegion, InvalidRegionKind, Payload,
            Section, Span, parse_document,
        },
        text::{SourceText, capture_source},
        workspace::CONFIG_PATH,
    },
    types::Diagnostic,
};
use std::path::Path;

/// The JSON of `parse`. The workspace facts follow `command`, as in every command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParseOutput {
    command: &'static str,
    #[serde(flatten)]
    meta: WorkspaceMeta,
    /// Null when the workspace config stopped the command before the file was read.
    document: Option<DocumentView>,
    diagnostics: Vec<DiagnosticView>,
}

/// A source range: byte offsets plus the line and column, in Unicode
/// characters from 1, of both ends.
#[derive(Debug, Clone, Copy, Serialize)]
struct RangeView {
    start: usize,
    end: usize,
    from: LocationView,
    to: LocationView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentView {
    file_path: String,
    valid: bool,
    complete: bool,
    imports: Vec<ImportView>,
    components: Vec<ComponentView>,
    invalid_regions: Vec<InvalidRegionView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportView {
    path: String,
    provider: String,
    selections: Vec<SelectionView>,
    valid: bool,
    complete: bool,
    range: RangeView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectionView {
    name: String,
    valid: bool,
    range: RangeView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComponentView {
    name: String,
    valid: bool,
    complete: bool,
    range: RangeView,
    sections: Vec<SectionView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SectionView {
    name: String,
    known: bool,
    valid: bool,
    complete: bool,
    range: RangeView,
    /// The Facets that sit directly in the section, outside any group.
    facets: Vec<FacetView>,
    groups: Vec<GroupView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupView {
    name: String,
    valid: bool,
    complete: bool,
    range: RangeView,
    facets: Vec<FacetView>,
    groups: Vec<GroupView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FacetView {
    valid: bool,
    complete: bool,
    range: RangeView,
    prose_range: RangeView,
    /// The inline Tags the Facet defines.
    tags: Vec<TagView>,
    links: Vec<LinkView>,
    payload: Option<PayloadView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TagView {
    name: String,
    valid: bool,
    range: RangeView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkView {
    label: String,
    destination: String,
    image: bool,
    range: RangeView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PayloadView {
    /// The notation named after the opening fence, when there is one.
    notation: Option<String>,
    valid: bool,
    complete: bool,
    range: RangeView,
    body_range: RangeView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InvalidRegionView {
    kind: &'static str,
    range: RangeView,
    payload: Option<PayloadView>,
}

/// Converts byte offsets of one source to the line and column of its characters.
struct Locator<'a> {
    source: &'a SourceText,
}

impl Locator<'_> {
    /// The character location of `byte`. An offset inside a character moves back
    /// to its start, and one inside a line ending to the end of the line's text.
    fn location(&self, byte: usize) -> LocationView {
        let text = &self.source.text;
        let mut byte = byte.min(text.len());
        while !text.is_char_boundary(byte) {
            byte -= 1;
        }
        let index = self
            .source
            .lines
            .partition_point(|line| line.start <= byte)
            .saturating_sub(1);
        let line = &self.source.lines[index];
        let byte = byte.min(line.content_end);
        LocationView {
            line: index as u32 + 1,
            column: text[line.start..byte].chars().count() as u32 + 1,
        }
    }

    fn range(&self, span: Span) -> RangeView {
        RangeView {
            start: span.start,
            end: span.end,
            from: self.location(span.start),
            to: self.location(span.end),
        }
    }

    fn import(&self, import: &Import) -> ImportView {
        ImportView {
            path: import.path.clone(),
            provider: import.provider.clone(),
            selections: import
                .selections
                .iter()
                .map(|selection| SelectionView {
                    name: selection.name.clone(),
                    valid: selection.valid,
                    range: self.range(selection.range),
                })
                .collect(),
            valid: import.valid,
            complete: import.complete,
            range: self.range(import.range),
        }
    }

    fn component(&self, component: &Component) -> ComponentView {
        ComponentView {
            name: component.name.clone(),
            valid: component.valid,
            complete: component.complete,
            range: self.range(component.range),
            sections: component
                .sections
                .iter()
                .map(|section| self.section(section))
                .collect(),
        }
    }

    fn section(&self, section: &Section) -> SectionView {
        SectionView {
            name: section.name.clone(),
            known: section.known,
            valid: section.valid,
            complete: section.complete,
            range: self.range(section.range),
            facets: section
                .units
                .iter()
                .filter(|facet| facet.group.is_none())
                .map(|facet| self.facet(facet))
                .collect(),
            groups: section
                .groups
                .iter()
                .map(|group| self.group(group, &section.units))
                .collect(),
        }
    }

    fn group(&self, group: &Group, units: &[Facet]) -> GroupView {
        GroupView {
            name: group.name.clone(),
            valid: group.valid,
            complete: group.complete,
            range: self.range(group.range),
            facets: group
                .units
                .iter()
                .filter_map(|index| units.get(*index))
                .map(|facet| self.facet(facet))
                .collect(),
            groups: group
                .groups
                .iter()
                .map(|inner| self.group(inner, units))
                .collect(),
        }
    }

    fn facet(&self, facet: &Facet) -> FacetView {
        FacetView {
            valid: facet.valid,
            complete: facet.complete,
            range: self.range(facet.range),
            prose_range: self.range(facet.prose_range),
            tags: facet
                .definitions
                .iter()
                .map(|tag| TagView {
                    name: tag.name.clone(),
                    valid: tag.valid,
                    range: self.range(tag.range),
                })
                .collect(),
            links: facet
                .links
                .iter()
                .map(|link| LinkView {
                    label: link.label.clone(),
                    destination: link.destination.clone(),
                    image: link.image,
                    range: self.range(link.range),
                })
                .collect(),
            payload: facet.payload.as_ref().map(|payload| self.payload(payload)),
        }
    }

    fn payload(&self, payload: &Payload) -> PayloadView {
        PayloadView {
            notation: payload.kind.clone(),
            valid: payload.valid,
            complete: payload.complete,
            range: self.range(payload.range),
            body_range: self.range(payload.body_range),
        }
    }

    fn invalid_region(&self, region: &InvalidRegion) -> InvalidRegionView {
        InvalidRegionView {
            kind: match region.kind {
                InvalidRegionKind::Structure => "structure",
                InvalidRegionKind::DetachedPayload => "detachedPayload",
            },
            range: self.range(region.range),
            payload: region.payload.as_ref().map(|payload| self.payload(payload)),
        }
    }

    fn document(&self, document: &Document, display: &Display) -> DocumentView {
        DocumentView {
            file_path: display.path(&document.file_path),
            valid: document.valid,
            complete: document.complete,
            imports: document
                .imports
                .iter()
                .map(|import| self.import(import))
                .collect(),
            components: document
                .components
                .iter()
                .map(|component| self.component(component))
                .collect(),
            invalid_regions: document
                .invalid_regions
                .iter()
                .map(|region| self.invalid_region(region))
                .collect(),
        }
    }
}

pub fn run(request: &ParseRequest, ctx: &Context) -> Output {
    let file = &request.file;
    let root_arg = request.global.root.as_deref();
    let found = discover(ctx, Some(file), root_arg, Some(file));
    let Discovered {
        root,
        display,
        diagnostics,
    } = found;

    let config = if diagnostics.is_empty() {
        match read_config(&root, &display) {
            Ok(config) => config,
            Err(error) => return fail(3, error),
        }
    } else {
        ConfigState {
            found: false,
            config: None,
            diagnostics,
        }
    };
    let meta = WorkspaceMeta::new(&display, config.found, config.config.as_ref());
    if config.config.is_none() {
        return finish(request, meta, None, views(&config.diagnostics, &display));
    }

    let absolute = resolve_target(&ctx.cwd, file);
    let (document_path, bytes) = match read_file(&absolute) {
        Ok(read) => read,
        Err(message) => return fail(3, message),
    };
    let document_path = match absolute.strip_prefix(&root) {
        Ok(inside) => path_text(inside),
        Err(_) => document_path,
    };
    let capture = capture_source(&document_path, &bytes);
    let document = parse_document(&document_path, &capture);

    let mut views_list = views(&config.diagnostics, &display);
    views_list.extend(document.diagnostics.iter().map(|diagnostic| {
        let location = document.source.as_ref().and_then(|source| {
            diagnostic
                .range
                .as_ref()
                .and_then(|range| source.location_at_byte(range.start))
        });
        view(diagnostic, &display, location.map(LocationView::from))
    }));
    let document_view = document.source.as_ref().map_or_else(
        || empty_document(&document, &display),
        |source| Locator { source }.document(&document, &display),
    );
    finish(request, meta, Some(document_view), views_list)
}

/// A document whose text could not be read has no parts.
fn empty_document(document: &Document, display: &Display) -> DocumentView {
    DocumentView {
        file_path: display.path(&document.file_path),
        valid: document.valid,
        complete: document.complete,
        imports: Vec::new(),
        components: Vec::new(),
        invalid_regions: Vec::new(),
    }
}

struct ConfigState {
    found: bool,
    config: Option<sigil_core::language::config::Config>,
    diagnostics: Vec<Diagnostic>,
}

/// Read and check the workspace config only, as far as `parse` needs it.
fn read_config(root: &Path, display: &Display) -> Result<ConfigState, String> {
    let fs = DiskFs::new(root);
    let bytes = fs
        .read(CONFIG_PATH)
        .map_err(|error| format!("{error}: readfile '{}'", display.path(CONFIG_PATH)))?;
    let Some(bytes) = bytes else {
        let missing = diagnostic(
            CONFIG_NOT_FOUND,
            config_missing_message(display),
            Location::at(CONFIG_PATH, None),
        );
        return Ok(ConfigState {
            found: false,
            config: None,
            diagnostics: vec![missing],
        });
    };
    let capture = capture_source(CONFIG_PATH, &bytes);
    let text = capture
        .source
        .filter(|_| capture.diagnostics.is_empty())
        .map(|source| source.text);
    let Some(text) = text else {
        let diagnostics = capture
            .diagnostics
            .into_iter()
            .map(|d| {
                diagnostic(
                    "SIGIL_CONFIG_PARSE",
                    d.message,
                    Location::at(CONFIG_PATH, d.range),
                )
            })
            .collect();
        return Ok(ConfigState {
            found: true,
            config: None,
            diagnostics: order_diagnostics(diagnostics),
        });
    };
    let parsed = parse_config(&text, CONFIG_PATH);
    Ok(ConfigState {
        found: true,
        config: parsed.config,
        diagnostics: order_diagnostics(parsed.diagnostics),
    })
}

/// The path text and bytes of `file`, read through the core's filesystem rooted
/// at the file's own directory, so the file need not be in the workspace.
fn read_file(file: &Path) -> Result<(String, Vec<u8>), String> {
    let shown = path_text(file);
    let (Some(parent), Some(name)) = (file.parent(), file.file_name()) else {
        return Err(format!("Not a file: readfile '{shown}'"));
    };
    let name = name.to_string_lossy();
    let read = DiskFs::new(if parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        parent
    })
    .read(&name);
    match read {
        Ok(Some(bytes)) => Ok((shown, bytes)),
        Ok(None) => Err(format!(
            "No such file or directory (os error 2): readfile '{shown}'"
        )),
        Err(error) => Err(format!("{error}: readfile '{shown}'")),
    }
}

fn finish(
    request: &ParseRequest,
    meta: WorkspaceMeta,
    document: Option<DocumentView>,
    diagnostics: Vec<DiagnosticView>,
) -> Output {
    let exit = exit_code(&diagnostics);
    let outline = document.as_ref().map(outline);
    let model = ParseOutput {
        command: "parse",
        meta,
        document,
        diagnostics,
    };
    let text = || {
        let mut lines = Vec::new();
        if let Some(outline) = &outline {
            lines.push(format!(
                "document {} {}, {}",
                outline.path, outline.validity, outline.completeness
            ));
            lines.extend(outline.entries.iter().map(Entry::text));
        }
        lines.extend(diagnostic_lines(&model.diagnostics, true));
        lines_text(&lines)
    };
    let markdown = || {
        let title = outline
            .as_ref()
            .map_or_else(|| "Parse".to_owned(), |o| format!("Parse {}", o.path));
        let mut md = Markdown::new(&title);
        if let Some(outline) = &outline {
            md = md
                .facts(&[
                    ("Document", outline.path.clone()),
                    ("Validity", outline.validity.to_owned()),
                    ("Completeness", outline.completeness.to_owned()),
                ])
                .list("Imports", &outline.markdown_group(Top::Imports))
                .list("Components", &outline.markdown_group(Top::Components))
                .list(
                    "Invalid regions",
                    &outline.markdown_group(Top::InvalidRegions),
                );
        }
        md.diagnostics(&model.diagnostics, true).finish()
    };
    render(&request.global, Format::Json, exit, &model, text, markdown)
}

/// Which top-level kind of part an outline entry belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Top {
    Imports,
    Components,
    InvalidRegions,
}

/// One part of the document as one outline line.
struct Entry {
    group: Top,
    depth: usize,
    kind: &'static str,
    name: String,
    range: RangeView,
    flags: Vec<&'static str>,
}

impl Entry {
    fn range_text(&self) -> String {
        let RangeView {
            start,
            end,
            from,
            to,
        } = self.range;
        format!(
            "{start}..{end} {}:{}-{}:{}",
            from.line, from.column, to.line, to.column
        )
    }

    fn label(&self) -> String {
        let mut label = self.kind.to_owned();
        if !self.name.is_empty() {
            label.push(' ');
            label.push_str(&self.name);
        }
        label
    }

    fn flag_text(&self) -> String {
        self.flags.iter().map(|flag| format!(" {flag}")).collect()
    }

    /// `  kind name 12..40 2:1-4:2 invalid`, indented by depth.
    fn text(&self) -> String {
        format!(
            "{}{} {}{}",
            "  ".repeat(self.depth + 1),
            self.label(),
            self.range_text(),
            self.flag_text()
        )
    }
}

struct Outline {
    path: String,
    validity: &'static str,
    completeness: &'static str,
    entries: Vec<Entry>,
}

impl Outline {
    /// The markdown list items of one kind of part: each top-level part is an
    /// item and its nested parts are a nested list inside it.
    fn markdown_group(&self, group: Top) -> Vec<String> {
        let mut items: Vec<String> = Vec::new();
        for entry in self.entries.iter().filter(|entry| entry.group == group) {
            let line = format!(
                "{}: `{}`{}",
                entry.label(),
                entry.range_text(),
                entry.flag_text()
            );
            if entry.depth == 0 {
                items.push(line);
            } else if let Some(last) = items.last_mut() {
                last.push_str(&format!("\n{}- {line}", "  ".repeat(entry.depth - 1)));
            }
        }
        items
    }
}

fn flags(valid: bool, complete: bool) -> Vec<&'static str> {
    let mut flags = Vec::new();
    if !valid {
        flags.push("invalid");
    }
    if !complete {
        flags.push("incomplete");
    }
    flags
}

fn outline(document: &DocumentView) -> Outline {
    let mut entries = Vec::new();
    for import in &document.imports {
        entries.push(Entry {
            group: Top::Imports,
            depth: 0,
            kind: "import",
            name: format!(
                "{} from {} {{ {} }}",
                import.path,
                import.provider,
                import
                    .selections
                    .iter()
                    .map(|selection| selection.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            range: import.range,
            flags: flags(import.valid, import.complete),
        });
    }
    for component in &document.components {
        entries.push(Entry {
            group: Top::Components,
            depth: 0,
            kind: "component",
            name: component.name.clone(),
            range: component.range,
            flags: flags(component.valid, component.complete),
        });
        for section in &component.sections {
            entries.push(Entry {
                group: Top::Components,
                depth: 1,
                kind: "section",
                name: section.name.clone(),
                range: section.range,
                flags: {
                    let mut flags = flags(section.valid, section.complete);
                    if !section.known {
                        flags.push("unknown");
                    }
                    flags
                },
            });
            push_children(&mut entries, &section.facets, &section.groups, 2);
        }
    }
    for region in &document.invalid_regions {
        entries.push(Entry {
            group: Top::InvalidRegions,
            depth: 0,
            kind: "invalid",
            name: region.kind.to_owned(),
            range: region.range,
            flags: Vec::new(),
        });
        if let Some(payload) = &region.payload {
            push_payload(&mut entries, payload, 1, Top::InvalidRegions);
        }
    }
    Outline {
        path: document.file_path.clone(),
        validity: if document.valid { "valid" } else { "invalid" },
        completeness: if document.complete {
            "complete"
        } else {
            "incomplete"
        },
        entries,
    }
}

enum Child<'a> {
    Facet(&'a FacetView),
    Group(&'a GroupView),
}

/// The facets and groups of one parent, in source order, each with its own parts.
fn push_children(
    entries: &mut Vec<Entry>,
    facets: &[FacetView],
    groups: &[GroupView],
    depth: usize,
) {
    let mut children: Vec<(usize, Child)> = facets
        .iter()
        .map(|facet| (facet.range.start, Child::Facet(facet)))
        .chain(
            groups
                .iter()
                .map(|group| (group.range.start, Child::Group(group))),
        )
        .collect();
    children.sort_by_key(|(start, _)| *start);
    for (_, child) in children {
        push_child(entries, child, depth);
    }
}

fn push_child(entries: &mut Vec<Entry>, child: Child, depth: usize) {
    match child {
        Child::Facet(facet) => {
            entries.push(Entry {
                group: Top::Components,
                depth,
                kind: "facet",
                name: String::new(),
                range: facet.range,
                flags: flags(facet.valid, facet.complete),
            });
            for tag in &facet.tags {
                entries.push(Entry {
                    group: Top::Components,
                    depth: depth + 1,
                    kind: "tag",
                    name: tag.name.clone(),
                    range: tag.range,
                    flags: flags(tag.valid, true),
                });
            }
            if let Some(payload) = &facet.payload {
                push_payload(entries, payload, depth + 1, Top::Components);
            }
        }
        Child::Group(group) => {
            entries.push(Entry {
                group: Top::Components,
                depth,
                kind: "group",
                name: group.name.clone(),
                range: group.range,
                flags: flags(group.valid, group.complete),
            });
            push_children(entries, &group.facets, &group.groups, depth + 1);
        }
    }
}

fn push_payload(entries: &mut Vec<Entry>, payload: &PayloadView, depth: usize, group: Top) {
    entries.push(Entry {
        group,
        depth,
        kind: "payload",
        name: payload.notation.clone().unwrap_or_default(),
        range: payload.range,
        flags: flags(payload.valid, payload.complete),
    });
}
