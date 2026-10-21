//! A config-only read of the tool settings: no source is listed or parsed.
use super::{
    config::{config_text, merge_tools, parse_local_tools, read_config_bytes},
    diagnostics::{Location, diagnostic},
    fs::SourceFs,
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
    let bytes = fs
        .read(CONFIG_PATH)
        .map_err(|e| unreadable(CONFIG_PATH, e))?
        .ok_or_else(|| not_found(CONFIG_PATH))?;
    let read = read_config_bytes(CONFIG_PATH, &bytes);
    let Some(config) = read.config else {
        return Err(read.diagnostics);
    };
    let local = match fs
        .read(LOCAL_CONFIG_PATH)
        .map_err(|e| unreadable(LOCAL_CONFIG_PATH, e))?
    {
        None => None,
        Some(bytes) => {
            let (tools, diagnostics) = parse_local_tools(
                &config_text(LOCAL_CONFIG_PATH, &bytes).map_err(|e| e.diagnostics)?,
                LOCAL_CONFIG_PATH,
            );
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
