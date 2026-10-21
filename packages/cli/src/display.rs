//! How paths are shown to the user.
//!
//! The core returns workspace-relative paths. The TypeScript command line
//! showed the workspace root and every path under it relative to the current
//! directory, unless the user named the workspace with an absolute path, in
//! which case it showed absolute paths. `Display` keeps that rule in one place.
//! Messages that embed an absolute path are never rewritten.
pub use sigil_core::language::path::is_absolute;
use sigil_core::language::path::normalize_path;
use std::path::{Component, Path, PathBuf};

/// A path with `/` separators and no trailing separator (the root stays `/`).
pub fn normalize(path: &str) -> String {
    let text = path.replace('\\', "/");
    let trimmed = text.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn drive(path: &str) -> Option<&str> {
    let bytes = path.as_bytes();
    (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':').then(|| &path[..2])
}

/// `path` written relative to the directory `root`; both are absolute and
/// normalized. Paths on another drive stay absolute.
pub fn relative_from(root: &str, path: &str) -> String {
    if root == path {
        return ".".to_owned();
    }
    if drive(root) != drive(path) {
        return path.to_owned();
    }
    let root_parts: Vec<&str> = root.split('/').filter(|p| !p.is_empty()).collect();
    let path_parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    let common = root_parts
        .iter()
        .zip(&path_parts)
        .take_while(|(a, b)| a == b)
        .count();
    let mut parts: Vec<&str> = vec![".."; root_parts.len() - common];
    parts.extend(&path_parts[common..]);
    if parts.is_empty() {
        ".".to_owned()
    } else {
        parts.join("/")
    }
}

/// The absolute location of `target`, taken from `cwd` when it is relative,
/// with `.` and `..` resolved by text. A `..` at the root stays at the root.
pub fn resolve_target(cwd: &Path, target: &str) -> PathBuf {
    let joined = if is_absolute(target) {
        PathBuf::from(target)
    } else {
        cwd.join(target)
    };
    let mut normal = PathBuf::new();
    for component in joined.components() {
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
    if normal.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        normal
    }
}

/// A path as text with `/` separators, as the output shows it.
pub fn path_text(path: &Path) -> String {
    normalize_path(&path.to_string_lossy())
}

/// The path the user named for fmt: the first absolute one, else the first.
pub fn fmt_controlling_path(paths: &[String]) -> Option<&str> {
    paths
        .iter()
        .find(|path| is_absolute(path))
        .or_else(|| paths.first())
        .map(String::as_str)
}

/// Shows workspace-relative paths as the user expects to read them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Display {
    absolute_root: String,
    shown_root: String,
    absolute: bool,
}

impl Display {
    /// `root` is the absolute workspace root and `cwd` the current directory.
    /// `explicit_root` is the `--root` value and `controlling` the path argument
    /// that decides the mode: when the first of them that is present is
    /// absolute, every path is shown absolute. Otherwise the root is shown
    /// relative to `cwd`, and `.` when it is `cwd`.
    pub fn new(
        cwd: &Path,
        root: &Path,
        explicit_root: Option<&str>,
        controlling: Option<&str>,
    ) -> Self {
        let root = normalize(&path_text(root));
        let supplied = explicit_root.or(controlling);
        let absolute = supplied.is_some_and(is_absolute) || !is_absolute(&root);
        let shown_root = if absolute {
            root.clone()
        } else {
            relative_from(&normalize(&path_text(cwd)), &root)
        };
        Self {
            absolute_root: root,
            shown_root,
            absolute,
        }
    }

    /// Whether paths are shown absolute.
    pub fn is_absolute(&self) -> bool {
        self.absolute
    }

    /// The workspace root as shown.
    pub fn root(&self) -> &str {
        &self.shown_root
    }

    /// The absolute workspace root, `/`-separated.
    pub fn absolute_root(&self) -> &str {
        &self.absolute_root
    }

    /// A workspace-relative path as shown. The root itself is `.` or empty.
    /// A path that is already absolute stays as it is.
    pub fn path(&self, workspace_path: &str) -> String {
        if is_absolute(workspace_path) {
            return workspace_path.to_owned();
        }
        if workspace_path.is_empty() || workspace_path == "." {
            return self.shown_root.clone();
        }
        match self.shown_root.as_str() {
            "." => workspace_path.to_owned(),
            "/" => format!("/{workspace_path}"),
            root => format!("{root}/{workspace_path}"),
        }
    }
}
