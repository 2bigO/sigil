//! The `version` command: the CLI, core and workspace language versions.
use crate::{
    CLI_VERSION, Context,
    args::{Format, VersionRequest},
    model::{self, DiagnosticView, WorkspaceMeta},
    output::{Markdown, Output, diagnostic_lines, lines_text, render},
    session::Session,
};
use serde::Serialize;
use sigil_core::{
    language::{CORE_VERSION, diagnostics::order_diagnostics, parse::parse_document},
    types::Diagnostic,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionOutput {
    command: &'static str,
    cli_version: &'static str,
    core_version: &'static str,
    #[serde(flatten)]
    meta: WorkspaceMeta,
    diagnostics: Vec<DiagnosticView>,
}

/// What `version` reports: the workspace's own diagnostics plus what reading
/// each source finds (parsing, structure, line width), and no resolution.
///
/// The core keeps the capture diagnostics of a source in the workspace and
/// repeats them in the parsed document; they are reported once.
fn diagnostics_of(session: &Session) -> Vec<Diagnostic> {
    let Some(workspace) = &session.workspace else {
        return session.diagnostics.clone();
    };
    let mut all = session.diagnostics.clone();
    for source in &workspace.sources {
        let mut captured: Vec<_> = source
            .capture
            .diagnostics
            .iter()
            .filter_map(|d| serde_json::to_value(d).ok())
            .collect();
        for found in parse_document(&source.path, &source.capture).diagnostics {
            let value = serde_json::to_value(&found).ok();
            match captured.iter().position(|c| Some(c) == value.as_ref()) {
                Some(index) => {
                    captured.swap_remove(index);
                }
                None => all.push(found),
            }
        }
    }
    order_diagnostics(all)
}

pub fn run(request: &VersionRequest, ctx: &Context) -> Output {
    let session = Session::open(ctx, request.path.as_deref(), request.global.root.as_deref())?;
    let output = VersionOutput {
        command: "version",
        cli_version: CLI_VERSION,
        core_version: CORE_VERSION,
        meta: session.meta(),
        diagnostics: model::views(&diagnostics_of(&session), &session.display),
    };
    let facts = [
        ("CLI", output.cli_version.to_owned()),
        ("Core", output.core_version.to_owned()),
        ("Workspace", output.meta.workspace_root.clone()),
        (
            "Workspace name",
            output
                .meta
                .workspace_name
                .clone()
                .unwrap_or_else(|| "unresolved".to_owned()),
        ),
        (
            "Configured Sigil",
            output
                .meta
                .sigil_version
                .clone()
                .unwrap_or_else(|| "unresolved".to_owned()),
        ),
    ];
    let text = || {
        let mut lines: Vec<String> = facts
            .iter()
            .map(|(label, value)| format!("{label}: {value}"))
            .collect();
        lines.extend(diagnostic_lines(&output.diagnostics, false));
        lines_text(&lines)
    };
    let markdown = || {
        Markdown::new("Sigil version")
            .facts(&facts)
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
