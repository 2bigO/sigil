//! The `version` command: the CLI, core and workspace language versions.
use crate::{
    CLI_VERSION, Context,
    args::{Format, VersionRequest},
    model::{self, DiagnosticView, WorkspaceMeta},
    output::{Markdown, Output, diagnostic_lines, lines_text, render},
    session::Session,
};
use serde::Serialize;
use sigil_core::language::CORE_VERSION;

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

pub fn run(request: &VersionRequest, ctx: &Context) -> Output {
    let session = Session::open(ctx, request.path.as_deref(), request.global.root.as_deref())?;
    let output = VersionOutput {
        command: "version",
        cli_version: CLI_VERSION,
        core_version: CORE_VERSION,
        meta: session.meta(),
        diagnostics: model::views(&session.diagnostics, &session.display),
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
