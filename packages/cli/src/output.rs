//! What a command returns, and how it is turned into text.
use crate::{
    args::{Format, Global},
    model::{DiagnosticView, diagnostic_line},
};
use serde::Serialize;

/// `Ok((exit status, standard output))` or `Err((exit status, standard error))`.
/// Both texts are written as they are, so a message ends with its own newline.
pub type Output = Result<(u8, String), (u8, String)>;

/// A successful run that prints `stdout` and exits with `code`.
pub fn ok(code: u8, stdout: impl Into<String>) -> Output {
    Ok((code, stdout.into()))
}

/// The exit status of a run that could not read or write the disk.
pub const RUNTIME_FAILURE: u8 = 3;

/// One line on standard error with its newline, for a failed run that exits
/// with `RUNTIME_FAILURE`.
pub fn runtime_error(message: impl std::fmt::Display) -> (u8, String) {
    (RUNTIME_FAILURE, format!("{message}\n"))
}

/// A failed run that prints one line on standard error and exits with `code`.
pub fn fail(code: u8, message: impl std::fmt::Display) -> Output {
    Err((code, format!("{message}\n")))
}

/// The model as JSON followed by a newline: compact, or indented by two spaces.
pub fn json_string<T: Serialize>(model: &T, pretty: bool) -> Result<String, serde_json::Error> {
    let mut text = if pretty {
        serde_json::to_string_pretty(model)?
    } else {
        serde_json::to_string(model)?
    };
    text.push('\n');
    Ok(text)
}

/// Print `model` in the requested format with `exit` as the exit status.
/// `--quiet` prints nothing and keeps the exit status. The text and markdown
/// renderers run only when their format is chosen.
pub fn render<T: Serialize>(
    global: &Global,
    default: Format,
    exit: u8,
    model: &T,
    text: impl FnOnce() -> String,
    markdown: impl FnOnce() -> String,
) -> Output {
    if global.quiet {
        return ok(exit, "");
    }
    let stdout = match global.format_or(default) {
        Format::Json => json_string(model, global.pretty).map_err(runtime_error)?,
        Format::Text => text(),
        Format::Markdown => markdown(),
    };
    ok(exit, stdout)
}

/// The text lines of a diagnostic list, one `diagnostic_line` each.
pub fn diagnostic_lines(diagnostics: &[DiagnosticView], with_location: bool) -> Vec<String> {
    diagnostics
        .iter()
        .map(|diagnostic| diagnostic_line(diagnostic, with_location))
        .collect()
}

/// Lines joined by newlines with a final newline, or nothing for no lines.
pub fn lines_text(lines: &[String]) -> String {
    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

/// A small markdown document: a heading, a facts list, and sections.
///
/// ```text
/// # Title
///
/// - Label: value
///
/// ## Diagnostics
///
/// - error CODE: message
/// ```
pub struct Markdown {
    text: String,
}

impl Markdown {
    pub fn new(title: &str) -> Self {
        Self {
            text: format!("# {title}\n"),
        }
    }

    /// A list of `- label: value` lines.
    pub fn facts(mut self, facts: &[(&str, String)]) -> Self {
        self.text.push('\n');
        for (label, value) in facts {
            self.text.push_str(&format!("- {label}: {value}\n"));
        }
        self
    }

    /// A second-level heading with a bulleted list, or `None.` when empty.
    pub fn list(mut self, heading: &str, items: &[String]) -> Self {
        self.text.push_str(&format!("\n## {heading}\n\n"));
        if items.is_empty() {
            self.text.push_str("None.\n");
        }
        for item in items {
            let mut lines = item.lines();
            self.text
                .push_str(&format!("- {}\n", lines.next().unwrap_or("")));
            for line in lines {
                self.text.push_str(&format!("  {line}\n"));
            }
        }
        self
    }

    /// The `Diagnostics` section, one list item per diagnostic.
    pub fn diagnostics(self, diagnostics: &[DiagnosticView], with_location: bool) -> Self {
        self.list("Diagnostics", &diagnostic_lines(diagnostics, with_location))
    }

    pub fn finish(self) -> String {
        self.text
    }
}
