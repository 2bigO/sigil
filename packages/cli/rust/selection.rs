//! Which files `fmt` selects.
//!
//! Targets are absolute paths. A `.sigil` target selects exactly that file, a
//! directory selects the workspace sources under it, and the workspace root
//! selects every source. Each target must belong to the workspace that the
//! first target chose. The result follows workspace source order, not
//! argument order.
use crate::display::{path_text, resolve_target};
use sigil_core::language::discovery::discover_workspace;
use std::path::{Path, PathBuf};

/// The absolute, de-duplicated targets in argument order; the current
/// directory when none was named.
pub fn targets(cwd: &Path, paths: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let named: Vec<&str> = if paths.is_empty() {
        vec!["."]
    } else {
        paths.iter().map(String::as_str).collect()
    };
    for path in named {
        let target = path_text(&resolve_target(cwd, path));
        if !seen.contains(&target) {
            seen.push(target);
        }
    }
    seen
}

fn text_of(path: &Path) -> String {
    path_text(path)
}

/// The workspace sources the targets select, in workspace order.
///
/// `root` is the absolute workspace root and `sources` its source paths
/// (workspace-relative, in workspace order). `explicit_root` says whether the
/// user named the root. A message is returned as `Err` for the exit 3 cases.
pub fn select(
    targets: &[String],
    root: &str,
    sources: &[String],
    explicit_root: bool,
) -> Result<Vec<String>, String> {
    let root = root.trim_end_matches('/');
    let absolute = |source: &String| format!("{root}/{source}");
    let mut selected = vec![false; sources.len()];
    for target in targets {
        let prefix = format!("{}/", target.trim_end_matches('/'));
        let is_file = target.ends_with(".sigil");
        let mut matched = false;
        for (index, source) in sources.iter().enumerate() {
            let full = absolute(source);
            let hit = if is_file {
                full == *target
            } else {
                full.starts_with(&prefix) || target == root
            };
            if hit {
                selected[index] = true;
                matched = true;
            }
        }
        if !matched {
            return Err(format!("No Sigil source matched {target}."));
        }
        // An explicit root keeps directory selection from its ancestors.
        if explicit_root && root.starts_with(&prefix) {
            continue;
        }
        let discovery = discover_workspace(&PathBuf::from(target), None);
        let same = discovery
            .root
            .as_deref()
            .is_some_and(|found| text_of(found).trim_end_matches('/') == root);
        if !same {
            return Err(format!(
                "Formatting target {target} belongs to a different workspace than {root}."
            ));
        }
    }
    Ok(sources
        .iter()
        .zip(selected)
        .filter(|(_, chosen)| *chosen)
        .map(|(source, _)| source.clone())
        .collect())
}
