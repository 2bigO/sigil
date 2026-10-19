//! The `glossary` command: the workspace glossary, the terms in force for each
//! source, and where each term occurs.
use crate::{
    Context,
    args::{Format, GlossaryRequest},
    display::Display,
    model::{self, DiagnosticView, LocationView, WorkspaceMeta},
    output::{Markdown, Output, diagnostic_lines, lines_text, render},
    session::Session,
};
use serde::Serialize;
use sigil_core::{
    language::{
        glossary::{
            Context as GlossaryContext, GlossaryOccurrence, GlossaryScope, GlossaryTerm,
            ResolvedGlossaryContext, glossary_projection,
        },
        resolve::ResolvedWorkspace,
        workspace::{GLOSSARY_PATH, Workspace},
    },
    types::{Diagnostic, Range},
};

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ScopeView {
    Workspace,
    Context { id: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TermView {
    term: String,
    definition: String,
    aliases: Vec<String>,
    agent_context: bool,
    scope: ScopeView,
    declaration_range: Range,
}

#[derive(Serialize)]
struct ContextView {
    id: String,
    include: Vec<String>,
    exclude: Vec<String>,
    terms: Vec<TermView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedContextView {
    file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_id: Option<String>,
    entries: Vec<TermView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OccurrenceView {
    term: TermView,
    matched_spelling: String,
    file_path: String,
    owner_kind: String,
    owner_name: String,
    section_name: String,
    range: Range,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_location: Option<LocationView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryOutput {
    command: &'static str,
    #[serde(flatten)]
    meta: WorkspaceMeta,
    glossary_path: Option<String>,
    schema_version: Option<u32>,
    terms: Vec<TermView>,
    contexts: Vec<ContextView>,
    resolved_contexts: Vec<ResolvedContextView>,
    occurrences: Vec<OccurrenceView>,
    diagnostics: Vec<DiagnosticView>,
}

fn term_view(term: &GlossaryTerm) -> TermView {
    TermView {
        term: term.term.clone(),
        definition: term.definition.clone(),
        aliases: term.aliases.clone(),
        agent_context: term.agent_context,
        scope: match &term.scope {
            GlossaryScope::Workspace => ScopeView::Workspace,
            GlossaryScope::Context(id) => ScopeView::Context { id: id.clone() },
        },
        declaration_range: term.declaration_range.clone(),
    }
}

fn terms_view(terms: &[GlossaryTerm]) -> Vec<TermView> {
    terms.iter().map(term_view).collect()
}

fn context_view(context: &GlossaryContext) -> ContextView {
    ContextView {
        id: context.id.clone(),
        include: context.include.clone(),
        exclude: context.exclude.clone(),
        terms: terms_view(&context.terms),
    }
}

/// The TypeScript command line leaves these paths workspace-relative in every
/// display mode, so they are not passed through `Display`.
fn resolved_view(resolved: &ResolvedGlossaryContext) -> ResolvedContextView {
    ResolvedContextView {
        file_path: resolved.file_path.clone(),
        context_id: resolved.context_id.clone(),
        entries: terms_view(&resolved.entries),
    }
}

fn occurrence_view(
    occurrence: &GlossaryOccurrence,
    display: &Display,
    workspace: &Workspace,
) -> OccurrenceView {
    OccurrenceView {
        term: term_view(&occurrence.term),
        matched_spelling: occurrence.matched_spelling.clone(),
        file_path: display.path(&occurrence.file_path),
        owner_kind: occurrence.owner_kind.clone(),
        owner_name: occurrence.owner_name.clone(),
        section_name: occurrence.section_name.clone(),
        range: occurrence.range.clone(),
        source_location: model::source_location(
            workspace,
            &occurrence.file_path,
            occurrence.range.start,
        ),
    }
}

/// The workspace's full ordered diagnostics, as `check` starts from them. When
/// discovery stopped before any workspace was read, only its own.
fn diagnostics_of(session: &Session, resolved: Option<&ResolvedWorkspace>) -> Vec<Diagnostic> {
    let Some(resolved) = resolved else {
        return session.diagnostics.clone();
    };
    let mut all = resolved.diagnostics.clone();
    // The session words a missing config with the absolute workspace root.
    for diagnostic in &mut all {
        if let Some(worded) = session
            .diagnostics
            .iter()
            .find(|d| d.code == "SIGIL_CONFIG_NOT_FOUND" && d.code == diagnostic.code)
        {
            diagnostic.message = worded.message.clone();
        }
    }
    all
}

pub fn run(request: &GlossaryRequest, ctx: &Context) -> Output {
    let session = Session::open(ctx, request.path.as_deref(), request.global.root.as_deref())?;
    let display = &session.display;
    let resolved = session.workspace.as_ref().map(ResolvedWorkspace::from);
    let diagnostics = diagnostics_of(&session, resolved.as_ref());
    let mut output = GlossaryOutput {
        command: "glossary",
        meta: session.meta(),
        glossary_path: None,
        schema_version: None,
        terms: Vec::new(),
        contexts: Vec::new(),
        resolved_contexts: Vec::new(),
        occurrences: Vec::new(),
        diagnostics: model::views(&diagnostics, display),
    };
    if let (Some(workspace), Some(resolved)) = (&session.workspace, &resolved) {
        let projection = glossary_projection(workspace, resolved);
        // A glossary file that exists but is invalid still has a path.
        let file_exists = workspace
            .context
            .iter()
            .any(|file| file.path == GLOSSARY_PATH && file.bytes.is_some());
        output.glossary_path = projection
            .glossary_path
            .clone()
            .or_else(|| file_exists.then(|| GLOSSARY_PATH.to_owned()))
            .map(|path| display.path(&path));
        output.schema_version = projection.schema_version;
        output.terms = terms_view(&projection.terms);
        output.contexts = projection.contexts.iter().map(context_view).collect();
        output.resolved_contexts = projection
            .resolved_contexts
            .iter()
            .map(resolved_view)
            .collect();
        output.occurrences = projection
            .occurrences
            .iter()
            .map(|occurrence| occurrence_view(occurrence, display, workspace))
            .collect();
    }
    let facts = [
        ("Workspace root", output.meta.workspace_root.clone()),
        (
            "Glossary",
            output
                .glossary_path
                .clone()
                .unwrap_or_else(|| "absent".to_owned()),
        ),
        (
            "Schema version",
            output
                .schema_version
                .map_or_else(|| "none".to_owned(), |version| version.to_string()),
        ),
        ("Terms", output.terms.len().to_string()),
        ("Contexts", output.contexts.len().to_string()),
        ("Occurrences", output.occurrences.len().to_string()),
    ];
    let occurrence_lines: Vec<String> = output
        .occurrences
        .iter()
        .map(|occurrence| {
            let at = match occurrence.source_location {
                Some(at) => format!(":{}:{}", at.line, at.column),
                None => format!(":byte-{}", occurrence.range.start),
            };
            let context = match &occurrence.term.scope {
                ScopeView::Context { id } => format!(" [{id}]"),
                ScopeView::Workspace => String::new(),
            };
            format!(
                "{}{at} {} -> {}{context}",
                occurrence.file_path, occurrence.matched_spelling, occurrence.term.term
            )
        })
        .collect();
    let text = || {
        let mut lines: Vec<String> = facts
            .iter()
            .map(|(label, value)| format!("{label}: {value}"))
            .collect();
        lines.extend(occurrence_lines.iter().cloned());
        lines.extend(diagnostic_lines(&output.diagnostics, false));
        lines_text(&lines)
    };
    let markdown = || {
        Markdown::new("Sigil glossary")
            .facts(&facts)
            .list("Occurrences", &occurrence_lines)
            .diagnostics(&output.diagnostics, false)
            .finish()
    };
    render(
        &request.global,
        Format::Text,
        model::exit_code(&output.diagnostics),
        &output,
        text,
        markdown,
    )
}
