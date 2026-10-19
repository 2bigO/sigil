//! Finding and reading the workspace a command works on.
//!
//! The core reports workspace-relative paths and its own wording for a missing
//! config. This module rebuilds the TypeScript messages that embed an absolute
//! path, and puts the pieces a command needs in one value.
use crate::{
    Context,
    display::{Display, is_absolute, path_text, resolve_target},
    model::WorkspaceMeta,
    output::runtime_error,
};
use sigil_core::{
    language::{
        config::Config,
        diagnostics::{Location, diagnostic, order_diagnostics},
        discovery::discover_workspace,
        fs::DiskFs,
        workspace::{CONFIG_PATH, Workspace},
    },
    types::{Diagnostic, RelatedLocation},
};
use std::path::{Path, PathBuf};

/// The code of the diagnostic for a workspace whose config is missing.
pub const CONFIG_NOT_FOUND: &str = "SIGIL_CONFIG_NOT_FOUND";

/// How a missing config is worded: the absolute workspace root, as the
/// TypeScript command line prints it. `display` is the session's display.
pub fn config_missing_message(display: &Display) -> String {
    format!(
        "Expected {CONFIG_PATH} directly inside workspace root {}.",
        display.absolute_root()
    )
}

/// The code of the diagnostics for a config nested inside a workspace.
const NESTED_CONFIG: &str = "SIGIL_NESTED_CONFIG";

/// The core's wording of a nested config that the workspace does not exclude.
const NESTED_NOT_EXCLUDED: &str =
    "Nested .sigil/config.json must be inside a subtree excluded by the workspace.";

/// The core's wording of a member that holds a config, up to the member path.
const MEMBER_PREFIX: &str = "Workspace member ";

/// Put `message` on every missing-config diagnostic of the list.
fn reword_missing_config(diagnostics: &mut [Diagnostic], message: &str) {
    for diagnostic in diagnostics
        .iter_mut()
        .filter(|d| d.code == CONFIG_NOT_FOUND)
    {
        diagnostic.message = message.to_owned();
    }
}

/// The directory that holds the nested config at `config_path`.
fn nested_root(config_path: &str) -> Option<&str> {
    config_path.strip_suffix(&format!("/{CONFIG_PATH}"))
}

/// Give the nested-config diagnostics of a workspace read by the core the
/// TypeScript wording, which names the workspace root and the member by their
/// absolute paths. `root` is the absolute workspace root.
fn reword_nested_config(diagnostics: &mut [Diagnostic], root: &str) {
    let root = root.trim_end_matches('/');
    for diagnostic in diagnostics.iter_mut().filter(|d| d.code == NESTED_CONFIG) {
        if diagnostic.message == NESTED_NOT_EXCLUDED {
            diagnostic.message = format!(
                "Nested {CONFIG_PATH} must be inside a subtree excluded by workspace {root}."
            );
        } else if let Some(member) = diagnostic
            .file_path
            .as_deref()
            .and_then(nested_root)
            .filter(|member| {
                diagnostic.message
                    == format!("{MEMBER_PREFIX}{member} must not contain its own {CONFIG_PATH}.")
            })
        {
            diagnostic.message =
                format!("{MEMBER_PREFIX}{root}/{member} must not contain its own {CONFIG_PATH}.");
        }
    }
}

/// The message of a parent-workspace conflict found by discovery. TypeScript
/// names both workspaces by absolute path; `parent` is the parent's config.
fn nested_in_parent_message(root: &Path, parent_config: &str) -> String {
    let parent = nested_root(parent_config).unwrap_or(parent_config);
    format!(
        "Workspace {} is nested inside parent workspace {parent} without being excluded by it.",
        path_text(root)
    )
}

/// Where the workspace is, found without reading its sources.
#[derive(Debug)]
pub struct Discovered {
    /// The absolute workspace root; the current directory when no config exists.
    pub root: PathBuf,
    pub display: Display,
    /// Diagnostics that stop a command before any workspace is read.
    pub diagnostics: Vec<Diagnostic>,
}

/// Find the workspace of `start`, or of the current directory when `None`.
/// With `explicit_root` the config must sit directly in that directory.
/// `controlling` is the path argument that decides how paths are shown (see
/// `Display::new`); it is usually `start`.
pub fn discover(
    ctx: &Context,
    start: Option<&str>,
    explicit_root: Option<&str>,
    controlling: Option<&str>,
) -> Discovered {
    let found = |root: PathBuf, diagnostics: Vec<Diagnostic>| Discovered {
        display: Display::new(&ctx.cwd, &root, explicit_root, controlling),
        root,
        diagnostics,
    };
    if let Some(explicit) = explicit_root {
        return found(resolve_target(&ctx.cwd, explicit), Vec::new());
    }
    let start = resolve_target(&ctx.cwd, start.unwrap_or("."));
    let discovery = discover_workspace(&start, None);
    let Some(root) = discovery.root else {
        let message = format!(
            "No ancestor {CONFIG_PATH} was found from {}.",
            path_text(&start)
        );
        let missing = diagnostic(CONFIG_NOT_FOUND, message, Location::at(CONFIG_PATH, None));
        return found(ctx.cwd.clone(), vec![missing]);
    };
    let diagnostics = discovery
        .diagnostics
        .into_iter()
        .map(|d| localize(d, &ctx.cwd, &root))
        .map(|mut d| {
            let parent = d.related.first().and_then(|r| r.file_path.clone());
            if let (NESTED_CONFIG, Some(parent)) = (d.code.as_str(), parent) {
                d.message = nested_in_parent_message(&root, &parent);
            }
            d
        })
        .collect();
    found(root, diagnostics)
}

/// Discovery shows a path relative to the current directory; commands show a
/// workspace-relative one.
fn localize(mut diagnostic: Diagnostic, cwd: &Path, root: &Path) -> Diagnostic {
    let relocate = |path: &str| -> String {
        let absolute = if is_absolute(path) {
            PathBuf::from(path)
        } else {
            cwd.join(path)
        };
        match absolute.strip_prefix(root) {
            Ok(inside) => path_text(inside),
            Err(_) => path_text(&absolute),
        }
    };
    diagnostic.file_path = diagnostic.file_path.as_deref().map(relocate);
    diagnostic.related = diagnostic
        .related
        .into_iter()
        .map(|related| RelatedLocation {
            file_path: related.file_path.as_deref().map(relocate),
            ..related
        })
        .collect();
    diagnostic
}

/// The TypeScript command line looks for the config of the start path itself
/// first, and a start path that is a file other than a `.sigil` source makes
/// that look fail with the operating system's error: a runtime failure. The
/// shown path is the one the look used.
fn check_start_path(ctx: &Context, start: Option<&str>) -> Result<(), (u8, String)> {
    let start = resolve_target(&ctx.cwd, start.unwrap_or("."));
    if path_text(&start).ends_with(".sigil") {
        return Ok(());
    }
    let config = start.join(CONFIG_PATH);
    match std::fs::metadata(&config) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(runtime_error(format!(
            "{error}: stat '{}'",
            path_text(&config)
        ))),
        _ => Ok(()),
    }
}

/// A workspace found and read, or the diagnostics that stopped it.
#[derive(Debug)]
pub struct Session {
    pub root: PathBuf,
    pub display: Display,
    /// None when discovery stopped before the workspace was read.
    pub workspace: Option<Workspace>,
    /// Discovery's and loading's diagnostics in canonical order.
    pub diagnostics: Vec<Diagnostic>,
    /// Whether the workspace config file was found.
    pub config_found: bool,
}

impl Session {
    /// Find and read the workspace, as `check`, `glossary` and `version` do.
    /// A failure to read the disk is a runtime failure (exit 3).
    pub fn open(
        ctx: &Context,
        start: Option<&str>,
        explicit_root: Option<&str>,
    ) -> Result<Self, (u8, String)> {
        Self::open_controlled(ctx, start, explicit_root, start)
    }

    /// Like `open`, with a separate `controlling` path for the display mode.
    pub fn open_controlled(
        ctx: &Context,
        start: Option<&str>,
        explicit_root: Option<&str>,
        controlling: Option<&str>,
    ) -> Result<Self, (u8, String)> {
        if explicit_root.is_none() {
            check_start_path(ctx, start)?;
        }
        let found = discover(ctx, start, explicit_root, controlling);
        let Discovered {
            root,
            display,
            diagnostics,
        } = found;
        if !diagnostics.is_empty() {
            return Ok(Self {
                root,
                display,
                workspace: None,
                diagnostics: order_diagnostics(diagnostics),
                config_found: false,
            });
        }
        let workspace = Workspace::load_with(&DiskFs::new(&root)).map_err(runtime_error)?;
        let mut diagnostics = workspace.diagnostics.clone();
        reword_missing_config(&mut diagnostics, &config_missing_message(&display));
        reword_nested_config(&mut diagnostics, display.absolute_root());
        let config_found = !diagnostics.iter().any(|d| d.code == CONFIG_NOT_FOUND);
        Ok(Self {
            root,
            display,
            workspace: Some(workspace),
            diagnostics,
            config_found,
        })
    }

    /// The valid workspace config, when there is one.
    pub fn config(&self) -> Option<&Config> {
        self.workspace.as_ref()?.config.as_ref()
    }

    /// The workspace facts that follow `command` in the JSON.
    pub fn meta(&self) -> WorkspaceMeta {
        WorkspaceMeta::new(&self.display, self.config_found, self.config())
    }

    /// Give the missing-config and nested-config diagnostics of `diagnostics`,
    /// resolved from this session's workspace, the wording the command line
    /// uses: the core words them without the absolute paths.
    pub fn reword(&self, diagnostics: &mut [Diagnostic]) {
        if let Some(worded) = self.diagnostics.iter().find(|d| d.code == CONFIG_NOT_FOUND) {
            reword_missing_config(diagnostics, &worded.message);
        }
        reword_nested_config(diagnostics, self.display.absolute_root());
    }
}
