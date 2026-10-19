//! The `fmt` command: select files, check that every one can be formatted and
//! that the whole workspace stays valid with the new text, and only then write.
use crate::{
    Context,
    args::{FmtRequest, Format},
    display::{Display, fmt_controlling_path},
    model::{DiagnosticView, WorkspaceMeta, exit_code, views},
    output::{Output, diagnostic_lines, fail, lines_text, render},
    selection,
    session::Session,
};
use serde::Serialize;
use sigil_core::{
    language::{
        diagnostics::order_diagnostics,
        format::format_document,
        fs::{DiskFs, Overlay},
        resolve::ResolvedWorkspace,
        workspace::{CONFIG_PATH, Workspace},
    },
    types::{Diagnostic, Severity},
};
use std::{fs, path::Path};

const LINE_TOO_LONG: &str = "SIGIL_LINE_TOO_LONG";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Formatted,
    Unchanged,
    Noncanonical,
    Failed,
}

impl Status {
    fn text(self) -> &'static str {
        match self {
            Self::Formatted => "formatted",
            Self::Unchanged => "unchanged",
            Self::Noncanonical => "noncanonical",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileResult {
    file_path: String,
    status: Status,
}

#[derive(Debug, Serialize)]
struct FmtOutput {
    command: &'static str,
    #[serde(flatten)]
    meta: WorkspaceMeta,
    check: bool,
    files: Vec<FileResult>,
    diagnostics: Vec<DiagnosticView>,
}

/// What the batch did, before it is shown.
struct Batch {
    /// Selected paths with their status, in workspace order.
    files: Vec<(String, Status)>,
    diagnostics: Vec<Diagnostic>,
}

fn has_blocking_error(diagnostics: &[Diagnostic]) -> bool {
    diagnostics
        .iter()
        .any(|d| matches!(d.severity, Severity::Error) && d.code != LINE_TOO_LONG)
}

fn all_failed(selected: Vec<String>, diagnostics: Vec<Diagnostic>) -> Batch {
    Batch {
        files: selected
            .into_iter()
            .map(|path| (path, Status::Failed))
            .collect(),
        diagnostics,
    }
}

/// Steps 1 to 4 of the batch protocol over an already loaded workspace.
fn run_batch(
    root: &Path,
    workspace: &Workspace,
    extra: Vec<Diagnostic>,
    selected: Vec<String>,
    check: bool,
) -> Result<Batch, (u8, String)> {
    let resolved = ResolvedWorkspace::from(workspace);
    let mut before = resolved.diagnostics;
    before.extend(extra);
    if has_blocking_error(&before) {
        return Ok(all_failed(selected, order_diagnostics(before)));
    }

    let prepared: Vec<_> = selected
        .iter()
        .map(|path| (path, format_document(workspace, path)))
        .collect();
    let mut diagnostics = order_diagnostics(
        prepared
            .iter()
            .flat_map(|(_, result)| result.diagnostics.iter().cloned())
            .collect(),
    );
    let every_formatted = prepared
        .iter()
        .all(|(_, result)| result.formatted_source.is_some());
    if every_formatted {
        let disk = DiskFs::new(root);
        let mut overlay = Overlay::new(&disk);
        for (path, result) in &prepared {
            if result.changed
                && let Some(source) = &result.formatted_source
            {
                overlay.set(path, source.clone());
            }
        }
        let reloaded = Workspace::load_with(&overlay).map_err(|error| (3, format!("{error}\n")))?;
        diagnostics = ResolvedWorkspace::from(&reloaded).diagnostics;
    }
    if diagnostics
        .iter()
        .any(|d| matches!(d.severity, Severity::Error))
        || !every_formatted
    {
        return Ok(all_failed(selected, diagnostics));
    }

    let mut files = Vec::new();
    for (path, result) in &prepared {
        let status = if !result.changed {
            Status::Unchanged
        } else if check {
            Status::Noncanonical
        } else {
            Status::Formatted
        };
        if status == Status::Formatted
            && let Some(source) = &result.formatted_source
        {
            fs::write(root.join(path), source)
                .map_err(|error| (3, format!("{}: {error}\n", root.join(path).display())))?;
        }
        files.push(((*path).clone(), status));
    }
    Ok(Batch { files, diagnostics })
}

fn show(
    request: &FmtRequest,
    session_meta: WorkspaceMeta,
    display: &Display,
    batch: Batch,
) -> Output {
    let diagnostics = views(&batch.diagnostics, display);
    let files: Vec<FileResult> = batch
        .files
        .into_iter()
        .map(|(path, status)| FileResult {
            file_path: display.path(&path),
            status,
        })
        .collect();
    let difference = request.check && files.iter().any(|f| f.status == Status::Noncanonical);
    let failed = files.iter().any(|f| f.status == Status::Failed);
    let exit = if difference || failed {
        1
    } else {
        exit_code(&diagnostics)
    };
    let mut lines: Vec<String> = files
        .iter()
        .map(|f| format!("{} {}", f.status.text(), f.file_path))
        .collect();
    lines.extend(diagnostic_lines(&diagnostics, false));
    let model = FmtOutput {
        command: "fmt",
        meta: session_meta,
        check: request.check,
        files,
        diagnostics,
    };
    // `fmt` offers json and text only; markdown is refused before this point.
    render(
        &request.global,
        Format::Text,
        exit,
        &model,
        || lines_text(&lines),
        || lines_text(&lines),
    )
}

pub fn run(request: &FmtRequest, ctx: &Context) -> Output {
    let targets = selection::targets(&ctx.cwd, &request.paths);
    let session = Session::open_controlled(
        ctx,
        Some(&targets[0]),
        request.global.root.as_deref(),
        fmt_controlling_path(&request.paths),
    )?;

    // A config that discovery refused (a nested workspace) still has sources.
    let mut extra: Vec<Diagnostic> = Vec::new();
    let loaded;
    let workspace = match &session.workspace {
        Some(workspace) => workspace,
        None if !session
            .diagnostics
            .iter()
            .any(|d| d.code == "SIGIL_CONFIG_NOT_FOUND")
            && session.root.join(CONFIG_PATH).is_file() =>
        {
            loaded = Workspace::load_with(&DiskFs::new(&session.root))
                .map_err(|error| (3, format!("{error}\n")))?;
            extra = session.diagnostics.clone();
            &loaded
        }
        None => return fail(3, format!("No Sigil source matched {}.", targets[0])),
    };

    let sources: Vec<String> = workspace.sources.iter().map(|s| s.path.clone()).collect();
    let selected = match selection::select(
        &targets,
        session.display.absolute_root(),
        &sources,
        request.global.root.is_some(),
    ) {
        Ok(selected) => selected,
        Err(message) => return fail(3, message),
    };

    let batch = run_batch(&session.root, workspace, extra, selected, request.check)?;
    show(request, session.meta(), &session.display, batch)
}
