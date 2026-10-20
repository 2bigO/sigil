//! The pieces of command output that every command shares, declared in the
//! key order of the TypeScript output so the compact JSON bytes match.
use crate::display::Display;
use serde::Serialize;
use sigil_core::{
    language::{
        config::Config,
        position::SourceLocation,
        workspace::{CONFIG_PATH, Workspace},
    },
    types::{Diagnostic, Range, RelatedLocation, Severity, Stage},
};

/// A line and a column in Unicode characters, both from 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct LocationView {
    pub line: u32,
    pub column: u32,
}

impl From<SourceLocation> for LocationView {
    fn from(location: SourceLocation) -> Self {
        Self {
            line: location.line,
            column: location.column,
        }
    }
}

/// The workspace facts that follow `command` in every command's JSON.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMeta {
    pub workspace_root: String,
    pub config_path: Option<String>,
    pub sigil_version: Option<String>,
    pub workspace_name: Option<String>,
}

impl WorkspaceMeta {
    /// The facts of a workspace shown by `display`; the config path is present
    /// only when the config was found, the rest only when it is valid.
    pub fn new(display: &Display, config_found: bool, config: Option<&Config>) -> Self {
        Self {
            workspace_root: display.root().to_owned(),
            config_path: config_found.then(|| display.path(CONFIG_PATH)),
            sigil_version: config.map(|config| config.sigil_version.clone()),
            workspace_name: config.map(|config| config.workspace_name.clone()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// A diagnostic as the command line prints it. `source_location` is only set
/// by commands that show locations.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticView {
    pub code: String,
    pub stage: Stage,
    pub severity: Severity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
    pub related: Vec<RelatedView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_location: Option<LocationView>,
}

/// How many diagnostics there are of each severity.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Counts {
    pub error: usize,
    pub warning: usize,
    pub info: usize,
}

fn severity_text(severity: &Severity) -> &'static str {
    match severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
        Severity::Info => "info",
    }
}

fn related_view(related: &RelatedLocation, display: &Display) -> RelatedView {
    RelatedView {
        file_path: related.file_path.as_deref().map(|path| display.path(path)),
        range: related.range.clone(),
        message: related.message.clone(),
    }
}

/// One diagnostic with its paths shown by `display`.
pub fn view(
    diagnostic: &Diagnostic,
    display: &Display,
    source_location: Option<LocationView>,
) -> DiagnosticView {
    DiagnosticView {
        code: diagnostic.code.clone(),
        stage: diagnostic.stage.clone(),
        severity: diagnostic.severity.clone(),
        message: diagnostic.message.clone(),
        file_path: diagnostic
            .file_path
            .as_deref()
            .map(|path| display.path(path)),
        range: diagnostic.range.clone(),
        related: diagnostic
            .related
            .iter()
            .map(|related| related_view(related, display))
            .collect(),
        source_location,
    }
}

/// Diagnostics without source locations, as `version`, `fmt` and `init` show them.
pub fn views(diagnostics: &[Diagnostic], display: &Display) -> Vec<DiagnosticView> {
    diagnostics
        .iter()
        .map(|diagnostic| view(diagnostic, display, None))
        .collect()
}

/// The character location of `byte` in the source `file_path` of `workspace`.
/// None when the workspace has no readable source there or `byte` is not on a
/// character boundary.
pub fn source_location(
    workspace: &Workspace,
    file_path: &str,
    byte: usize,
) -> Option<LocationView> {
    workspace
        .sources
        .iter()
        .find(|file| file.path == file_path)?
        .capture
        .source
        .as_ref()?
        .location_at_byte(byte)
        .map(LocationView::from)
}

/// Diagnostics with the line and column of each range start.
pub fn views_with_locations(
    diagnostics: &[Diagnostic],
    display: &Display,
    workspace: &Workspace,
) -> Vec<DiagnosticView> {
    diagnostics
        .iter()
        .map(|diagnostic| {
            let location = diagnostic
                .file_path
                .as_deref()
                .zip(diagnostic.range.as_ref())
                .and_then(|(path, range)| source_location(workspace, path, range.start));
            view(diagnostic, display, location)
        })
        .collect()
}

pub fn counts(diagnostics: &[DiagnosticView]) -> Counts {
    let mut counts = Counts::default();
    for diagnostic in diagnostics {
        match diagnostic.severity {
            Severity::Error => counts.error += 1,
            Severity::Warning => counts.warning += 1,
            Severity::Info => counts.info += 1,
        }
    }
    counts
}

/// 1 when any diagnostic is an error, else 0.
pub fn exit_code(diagnostics: &[DiagnosticView]) -> u8 {
    u8::from(
        diagnostics
            .iter()
            .any(|diagnostic| matches!(diagnostic.severity, Severity::Error)),
    )
}

/// `<severity> <code>: <message>`, with ` <file>[:<line>:<column>]` after the
/// code when `with_location` is set and the diagnostic has a file.
pub fn diagnostic_line(diagnostic: &DiagnosticView, with_location: bool) -> String {
    let location = match (&diagnostic.file_path, with_location) {
        (Some(path), true) => match diagnostic.source_location {
            Some(at) => format!(" {path}:{}:{}", at.line, at.column),
            None => format!(" {path}"),
        },
        _ => String::new(),
    };
    format!(
        "{} {}{location}: {}",
        severity_text(&diagnostic.severity),
        diagnostic.code,
        diagnostic.message
    )
}
