//! A config-only read of the tool settings: no source is listed or parsed.
use super::{
    config::{merge_tools, parse_config, parse_local_tools},
    diagnostics::{Location, diagnostic},
    fs::SourceFs,
    text::capture_source,
    workspace::{CONFIG_PATH, LOCAL_CONFIG_PATH},
};
use crate::types::Diagnostic;
use serde_json::{Map, Value};

/// The settings of every tool, by layer. Core checks only that each tool's
/// value is an object; the tool that owns a namespace interprets it.
#[derive(Debug, Clone)]
pub struct ToolSettings {
    /// The `tools` of the workspace config.
    pub shared: Map<String, Value>,
    /// The `tools` of the local override, when it exists.
    pub local: Option<Map<String, Value>>,
    /// The shared settings with the local override merged in.
    pub merged: Map<String, Value>,
}

/// Read the workspace config and the local override. Any config error is
/// returned as its diagnostics, with no partial settings.
pub fn read_tool_settings(fs: &dyn SourceFs) -> Result<ToolSettings, Vec<Diagnostic>> {
    let not_found = |path: &str| {
        vec![diagnostic(
            "SIGIL_CONFIG_NOT_FOUND",
            format!("Expected {path} directly inside workspace root."),
            Location::at(path, None),
        )]
    };
    let unreadable = |path: &str, error: std::io::Error| {
        vec![diagnostic(
            "SIGIL_CONFIG_PARSE",
            format!("Unable to read {path}: {error}"),
            Location::at(path, None),
        )]
    };
    let text_of = |path: &str, bytes: &[u8]| -> Result<String, Vec<Diagnostic>> {
        let capture = capture_source(path, bytes);
        match capture.source.filter(|_| capture.diagnostics.is_empty()) {
            Some(source) => Ok(source.text),
            None => Err(capture
                .diagnostics
                .into_iter()
                .map(|d| diagnostic("SIGIL_CONFIG_PARSE", d.message, Location::at(path, d.range)))
                .collect()),
        }
    };

    let bytes = fs
        .read(CONFIG_PATH)
        .map_err(|e| unreadable(CONFIG_PATH, e))?
        .ok_or_else(|| not_found(CONFIG_PATH))?;
    let parsed = parse_config(&text_of(CONFIG_PATH, &bytes)?, CONFIG_PATH);
    let Some(config) = parsed.config else {
        return Err(parsed.diagnostics);
    };
    let local = match fs
        .read(LOCAL_CONFIG_PATH)
        .map_err(|e| unreadable(LOCAL_CONFIG_PATH, e))?
    {
        None => None,
        Some(bytes) => {
            let (tools, diagnostics) =
                parse_local_tools(&text_of(LOCAL_CONFIG_PATH, &bytes)?, LOCAL_CONFIG_PATH);
            match tools {
                Some(tools) => Some(tools),
                None => return Err(diagnostics),
            }
        }
    };
    let merged = match &local {
        Some(local) => merge_tools(&config.tools, local),
        None => config.tools.clone(),
    };
    Ok(ToolSettings {
        shared: config.tools,
        local,
        merged,
    })
}
