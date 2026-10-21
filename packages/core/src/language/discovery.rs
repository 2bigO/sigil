//! Finding the workspace root from a target path or an explicit root.
use super::{
    config::{excludes_subtree, parse_config},
    diagnostics::{Location, diagnostic},
    text::capture_source,
    workspace::CONFIG_PATH,
};
use crate::types::Diagnostic;
use std::path::{Component, Path, PathBuf};

/// The root workspace discovery chose, with the diagnostics that stop it.
#[derive(Debug)]
pub struct Discovery {
    /// The chosen workspace root, absent when no config was found.
    pub root: Option<PathBuf>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Find the workspace for `start`. With an explicit root the config must sit
/// directly in it and no ancestor is searched. Otherwise the nearest ancestor
/// directory holding a config wins, and every further ancestor workspace must
/// exclude the chosen one.
pub fn discover_workspace(start: &Path, explicit_root: Option<&Path>) -> Discovery {
    if let Some(root) = explicit_root {
        return Discovery {
            root: Some(root.to_path_buf()),
            diagnostics: Vec::new(),
        };
    }
    let start = std::path::absolute(start).unwrap_or_else(|_| start.to_path_buf());
    let start = lexically_normal(&start);
    let candidates: Vec<PathBuf> = start
        .ancestors()
        .filter(|dir| dir.join(CONFIG_PATH).is_file())
        .map(Path::to_path_buf)
        .collect();
    let Some(root) = candidates.first().cloned() else {
        return Discovery {
            root: None,
            diagnostics: vec![diagnostic(
                "SIGIL_CONFIG_NOT_FOUND",
                format!(
                    "No ancestor {CONFIG_PATH} was found from {}.",
                    shown(&start)
                ),
                Location::at(CONFIG_PATH, None),
            )],
        };
    };
    for parent in &candidates[1..] {
        let config_path = parent.join(CONFIG_PATH);
        let parsed = std::fs::read(&config_path)
            .ok()
            .and_then(|bytes| capture_source(CONFIG_PATH, &bytes).source)
            .map(|source| parse_config(&source.text, &shown(&config_path)));
        let Some(parsed) = parsed else {
            return Discovery {
                root: Some(root),
                diagnostics: vec![diagnostic(
                    "SIGIL_CONFIG_PARSE",
                    format!("Unable to read {}.", shown(&config_path)),
                    Location::at(&shown(&config_path), None),
                )],
            };
        };
        let Some(config) = parsed.config else {
            return Discovery {
                root: Some(root),
                diagnostics: parsed.diagnostics,
            };
        };
        let relative = root
            .strip_prefix(parent)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        if !excludes_subtree(&relative, &config) {
            return Discovery {
                root: Some(root.clone()),
                diagnostics: vec![diagnostic(
                    "SIGIL_NESTED_CONFIG",
                    format!(
                        "Workspace {} is nested inside parent workspace {} without being excluded by it.",
                        shown(&root),
                        shown(parent)
                    ),
                    Location::at(&shown(&root.join(CONFIG_PATH)), None)
                        .with_related(&shown(&config_path)),
                )],
            };
        }
    }
    Discovery {
        root: Some(root),
        diagnostics: Vec::new(),
    }
}

/// A path as the user would type it: relative to the current directory when it
/// is inside it, absolute otherwise, always with `/` separators.
fn shown(path: &Path) -> String {
    let relative = std::env::current_dir()
        .ok()
        .and_then(|cwd| path.strip_prefix(cwd).ok().map(Path::to_path_buf));
    let text = relative.as_deref().unwrap_or(path).to_string_lossy();
    let text = text.replace('\\', "/");
    if text.is_empty() {
        ".".to_owned()
    } else {
        text
    }
}

/// A path with its `.` and `..` components resolved by text, so that walking
/// up from it visits real parents. A `..` at the root stays at the root.
fn lexically_normal(path: &Path) -> PathBuf {
    let mut normal = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                let climbs = matches!(normal.components().next_back(), Some(Component::Normal(_)));
                if climbs {
                    normal.pop();
                } else if !normal.has_root() {
                    normal.push("..");
                }
            }
            other => normal.push(other.as_os_str()),
        }
    }
    normal
}
