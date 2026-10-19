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

/// Put `message` on every missing-config diagnostic of the list.
fn reword_missing_config(diagnostics: &mut [Diagnostic], message: &str) {
    for diagnostic in diagnostics
        .iter_mut()
        .filter(|d| d.code == CONFIG_NOT_FOUND)
    {
        diagnostic.message = message.to_owned();
    }
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

    /// Give a missing-config diagnostic of `diagnostics`, resolved from this
    /// session's workspace, the wording the session itself reported.
    pub fn reword_missing_config(&self, diagnostics: &mut [Diagnostic]) {
        if let Some(worded) = self.diagnostics.iter().find(|d| d.code == CONFIG_NOT_FOUND) {
            reword_missing_config(diagnostics, &worded.message);
        }
    }
}
