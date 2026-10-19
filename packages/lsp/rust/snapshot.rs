//! One reading of a workspace: everything an answer or a published diagnostic
//! is made from, so a request never sees two readings.
use crate::{position, uri::path_to_file_uri};
use sigil_core::{
    language::{
        diagnostics::{Location, diagnostic, order_diagnostics},
        discovery::discover_workspace,
        fs::{Overlay, SourceFs},
        glossary::{GlossaryProjection, glossary_projection},
        path::normalize_path,
        position::{EditorPosition, EditorRange},
        resolve::ResolvedWorkspace,
        text::{SourceText, capture_source},
        untagged::untagged_facet_diagnostics,
        workspace::{CONFIG_PATH, Workspace},
    },
    types::{Diagnostic, Range, RelatedLocation},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    path::Path,
};

/// A workspace read once: loaded, resolved, with its glossary and diagnostics.
#[derive(Debug)]
pub struct Snapshot {
    root: String,
    pub workspace: Workspace,
    pub resolved: ResolvedWorkspace,
    pub glossary: GlossaryProjection,
    /// Every diagnostic of the reading, in canonical order. A path is
    /// workspace-relative, or absolute when it lies outside the root.
    pub diagnostics: Vec<Diagnostic>,
    /// The config, local override and glossary that were read, by relative path.
    context_sources: BTreeMap<String, SourceText>,
    /// Relative paths that an open buffer replaced.
    overlaid: BTreeSet<String>,
}

impl Snapshot {
    /// Discover the workspace of `start` on the disk, then read it with the
    /// open `buffers` (absolute path to text) laid over what `base` reads. A
    /// buffer outside the root is not part of the workspace. Without a
    /// config above `start`, the workspace is `start` itself and holds only
    /// the diagnostic that says so.
    pub fn load(
        start: &Path,
        buffers: &BTreeMap<String, String>,
        base: &dyn Fn(&Path) -> Box<dyn SourceFs>,
    ) -> io::Result<Self> {
        let discovery = discover_workspace(start, None);
        let start_text = path_text(&std::path::absolute(start).unwrap_or(start.to_path_buf()));
        let found = discovery.root.is_some();
        let root_path = discovery
            .root
            .unwrap_or_else(|| std::path::absolute(start).unwrap_or(start.to_path_buf()));
        let root = path_text(&root_path);
        let disk = base(&root_path);
        let mut overlay = Overlay::new(disk.as_ref());
        let mut overlaid = BTreeSet::new();
        for (path, text) in buffers {
            if let Some(relative) = relative_to(&root, path) {
                overlay.set(&relative, text.as_str());
                overlaid.insert(normalize_path(&relative));
            }
        }
        let workspace = Workspace::load_with(&overlay)?;
        let resolved = ResolvedWorkspace::from(&workspace);
        let glossary = glossary_projection(&workspace, &resolved);
        let mut all = resolved.diagnostics.clone();
        all.extend(untagged_facet_diagnostics(&resolved));
        if found {
            all.extend(
                discovery
                    .diagnostics
                    .into_iter()
                    .map(|d| localize(d, &root)),
            );
        } else {
            // The core words a missing config without the path it looked from,
            // and discovery shows it relative to the process directory.
            all.retain(|d| d.code != "SIGIL_CONFIG_NOT_FOUND");
            all.push(diagnostic(
                "SIGIL_CONFIG_NOT_FOUND",
                format!("No ancestor {CONFIG_PATH} was found from {start_text}."),
                Location::at(CONFIG_PATH, None),
            ));
        }
        let context_sources = workspace
            .context
            .iter()
            .filter_map(|file| {
                let bytes = file.bytes.as_ref()?;
                let source = capture_source(file.path, bytes).source?;
                Some((file.path.to_owned(), source))
            })
            .collect();
        Ok(Self {
            root,
            workspace,
            resolved,
            glossary,
            diagnostics: order_diagnostics(all),
            context_sources,
            overlaid,
        })
    }

    /// The absolute workspace root, `/`-separated with no trailing slash.
    pub fn root(&self) -> &str {
        &self.root
    }

    /// The absolute form of a workspace-relative path; an absolute path stays.
    pub fn absolute_path(&self, path: &str) -> String {
        if is_absolute(path) {
            normalize_path(path)
        } else {
            normalize_path(&format!("{}/{path}", self.root))
        }
    }

    /// The `file:` URI of a workspace-relative or absolute path.
    pub fn uri_of(&self, path: &str) -> String {
        path_to_file_uri(&self.absolute_path(path))
    }

    /// The workspace-relative form of an absolute path, when it lies under the
    /// root; a relative path is normalized and kept.
    pub fn relative_path(&self, path: &str) -> Option<String> {
        if is_absolute(path) {
            relative_to(&self.root, path).map(|p| normalize_path(&p))
        } else {
            Some(normalize_path(path))
        }
    }

    /// The index of a source file in `resolved.paths` and `resolved.documents`.
    pub fn file_index(&self, path: &str) -> Option<usize> {
        let relative = self.relative_path(path)?;
        self.resolved
            .paths
            .iter()
            .position(|p| normalize_path(p) == relative)
    }

    /// The parsed document of a source file, by absolute or relative path.
    pub fn document(&self, path: &str) -> Option<&sigil_core::language::parse::Document> {
        Some(&self.resolved.documents[self.file_index(path)?])
    }

    /// The captured text of a source file, or of the config, local override or
    /// glossary that was read. None when the path was not read or was not
    /// valid UTF-8.
    pub fn source(&self, path: &str) -> Option<&SourceText> {
        let relative = self.relative_path(path)?;
        match self.file_index(&relative) {
            Some(index) => self.resolved.documents[index].source.as_ref(),
            None => self.context_sources.get(&relative),
        }
    }

    /// Whether the path was read from the disk rather than from an open buffer.
    pub fn from_disk(&self, path: &str) -> bool {
        self.relative_path(path)
            .is_none_or(|relative| !self.overlaid.contains(&relative))
    }

    /// The editor range of a byte range in a read file, with a disk byte-order
    /// mark hidden. None when the file was not read or an end has no position.
    pub fn editor_range(&self, path: &str, range: &Range) -> Option<EditorRange> {
        position::range_of(self.source(path)?, self.from_disk(path), range)
    }

    /// The byte offset of an editor position in a read file.
    pub fn byte_at(&self, path: &str, position: EditorPosition) -> Option<usize> {
        position::byte_at(self.source(path)?, self.from_disk(path), position)
    }
}

fn is_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with('/')
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'/' || bytes[2] == b'\\'))
}

fn path_text(path: &Path) -> String {
    let text = normalize_path(&path.to_string_lossy());
    match text.len() {
        1 => text,
        _ => text.trim_end_matches('/').to_owned(),
    }
}

/// `path` below `root`, or none when it is the root itself or elsewhere.
fn relative_to(root: &str, path: &str) -> Option<String> {
    let path = normalize_path(path);
    let prefix = format!("{}/", root.trim_end_matches('/'));
    path.strip_prefix(&prefix)
        .filter(|rest| !rest.is_empty())
        .map(str::to_owned)
}

/// Discovery shows a path relative to the process directory. Make it
/// workspace-relative, or absolute when it lies elsewhere, and word the
/// nested-in-parent conflict with absolute paths, as the TypeScript server did.
fn localize(mut found: Diagnostic, root: &str) -> Diagnostic {
    let cwd = std::env::current_dir()
        .map(|dir| path_text(&dir))
        .unwrap_or_default();
    let relocate = |path: &str| -> String {
        let absolute = if is_absolute(path) {
            normalize_path(path)
        } else {
            normalize_path(&format!("{cwd}/{path}"))
        };
        relative_to(root, &absolute).unwrap_or(absolute)
    };
    let parent = found
        .related
        .first()
        .and_then(|related| related.file_path.as_deref())
        .map(|path| {
            let absolute = if is_absolute(path) {
                normalize_path(path)
            } else {
                normalize_path(&format!("{cwd}/{path}"))
            };
            absolute
                .strip_suffix(&format!("/{CONFIG_PATH}"))
                .unwrap_or(&absolute)
                .to_owned()
        });
    if let (SIGIL_NESTED_CONFIG, Some(parent)) = (found.code.as_str(), parent) {
        found.message = format!(
            "Workspace {root} is nested inside parent workspace {parent} without being excluded by it."
        );
    }
    found.file_path = found.file_path.as_deref().map(relocate);
    found.related = found
        .related
        .into_iter()
        .map(|related| RelatedLocation {
            file_path: related.file_path.as_deref().map(relocate),
            ..related
        })
        .collect();
    found
}

const SIGIL_NESTED_CONFIG: &str = "SIGIL_NESTED_CONFIG";
