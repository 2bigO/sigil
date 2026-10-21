//! Markdown for components, Facets, Tags and glossary terms, shared by hover
//! and `sigil.renderDocument`. A port of the TypeScript `HoverMarkdownRenderer`
//! without implementation ownership.
use crate::{
    occurrences::{GlossaryReference, tag_definition},
    params,
    server::{Answer, RequestError},
    snapshot::Snapshot,
    uri::{file_uri_to_path, in_path_set, percent_encode},
};
use serde_json::Value;
use sigil_core::language::{
    glossary::GlossaryScope,
    parse::Span,
    resolve::{AccessStatus, FacetPos, TagRef},
};

pub(crate) const RENDER_DOCUMENT_COMMAND: &str = "sigil.renderDocument";

/// Renders from one snapshot. Components are indexes into
/// `snapshot.resolved.components`.
pub struct Renderer<'a> {
    snapshot: &'a Snapshot,
}

impl<'a> Renderer<'a> {
    pub fn new(snapshot: &'a Snapshot) -> Self {
        Self { snapshot }
    }

    /// The workspace-relative path of a source file.
    pub fn display_path(&self, path: &str) -> String {
        self.snapshot
            .relative_path(path)
            .unwrap_or_else(|| path.to_owned())
    }

    /// The component's name as a link to its declaration, or the plain
    /// escaped name when the declaration has no editor position.
    pub fn component_link(&self, component: usize) -> String {
        let resolved = &self.snapshot.resolved;
        let item = &resolved.components[component];
        let range = resolved.declaration(item).name_range;
        match self.target(&resolved.paths[item.file], range) {
            Some(target) => markdown_link(&item.name, &target),
            None => escape_markdown(&item.name),
        }
    }

    /// The Tag's name as a link to its definition, or the plain escaped name.
    pub fn tag_link(&self, tag: TagRef) -> String {
        let name = &self.snapshot.resolved.components[tag.component].tags[tag.tag].name;
        match tag_definition(self.snapshot, tag).and_then(|(path, range)| self.target(&path, range))
        {
            Some(target) => markdown_link(name, &target),
            None => escape_markdown(name),
        }
    }

    /// The component section: heading, source line, then each section with
    /// its Facets.
    pub fn component(&self, component: usize) -> Vec<String> {
        let resolved = &self.snapshot.resolved;
        let item = &resolved.components[component];
        let mut lines = vec![
            format!("### component {}", self.component_link(component)),
            String::new(),
            format!(
                "Source: `{}`",
                self.display_path(&resolved.paths[item.file])
            ),
        ];
        for (section_index, section) in resolved.declaration(item).sections.iter().enumerate() {
            lines.push(String::new());
            lines.push(format!("**{}**", capitalize(&section.name)));
            for unit in 0..section.units.len() {
                let pos = FacetPos {
                    section: section_index,
                    unit,
                };
                lines.push(self.facet(component, pos));
            }
        }
        lines
    }

    /// One Facet as a list item: resolved Tag references become links,
    /// authored link destinations become absolute `file:` URLs, and a literal
    /// block follows in a fence at least as long as its own.
    pub fn facet(&self, component: usize, pos: FacetPos) -> String {
        let resolved = &self.snapshot.resolved;
        let item = &resolved.components[component];
        let facet = resolved.facet(item, pos);
        let path = &resolved.paths[item.file];
        let Some(source) = self.snapshot.source(path) else {
            return String::new();
        };
        let text = source.text.as_str();
        let start = facet.prose_range.start;
        let mut prose = text
            .get(start..facet.prose_range.end)
            .unwrap_or("")
            .to_owned();
        let mut replacements: Vec<(Span, String)> = Vec::new();
        for reference in &item.references {
            if reference.facet == pos
                && reference.status == AccessStatus::Resolved
                && let Some(tag) = reference.tag
            {
                replacements.push((reference.range, self.tag_link(tag)));
            }
        }
        let base = self.snapshot.uri_of(path);
        for link in &facet.links {
            if let Some(href) = resolve_link(&link.destination, &base) {
                replacements.push((link.destination_range, format!("<{href}>")));
            }
        }
        replacements.sort_by(|a, b| b.0.start.cmp(&a.0.start));
        for (range, replacement) in replacements {
            let from = range.start.saturating_sub(start);
            let to = range.end.saturating_sub(start);
            if from <= to && prose.is_char_boundary(from) && prose.is_char_boundary(to) {
                prose.replace_range(from..to, &replacement);
            }
        }
        let mut lines = vec![format!("- {}", js_trim(&prose))];
        if let Some(payload) = &facet.payload {
            let fence = "`".repeat(payload.fence_length.max(3));
            let body = text
                .get(payload.body_range.start..payload.body_range.end)
                .unwrap_or("");
            let closing = if body.ends_with(['\r', '\n']) {
                ""
            } else {
                "\n"
            };
            lines.push(String::new());
            lines.push(format!(
                "{fence}{}\n{body}{closing}{fence}",
                payload.kind.as_deref().unwrap_or("")
            ));
        }
        lines.join("\n")
    }

    /// The uri and start position of a byte range, when the file was read.
    fn target(&self, path: &str, range: Span) -> Option<LinkTarget> {
        let start = self.snapshot.editor_range(path, &range.range())?.start;
        Some(LinkTarget {
            uri: self.snapshot.uri_of(path),
            line: u64::from(start.line),
            column: u64::from(start.character),
        })
    }
}

/// Where a link points: a file URI and a zero-based line and column.
struct LinkTarget {
    uri: String,
    line: u64,
    column: u64,
}

/// The Markdown of every component declared in the file at `path`, joined by
/// a horizontal rule; empty for a file with none or one that is not part of
/// the workspace.
pub fn render_document(snapshot: &Snapshot, path: &str) -> String {
    let Some(file) = snapshot.file_index(path) else {
        return String::new();
    };
    let renderer = Renderer::new(snapshot);
    snapshot
        .resolved
        .components
        .iter()
        .enumerate()
        .filter(|(_, component)| component.file == file)
        .map(|(index, _)| renderer.component(index).join("\n"))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n")
}

/// The answer to `workspace/executeCommand`: only `sigil.renderDocument`,
/// with the document's URI as its first argument.
pub(crate) fn execute_command(snapshot: &Snapshot, params: &Value) -> Answer {
    let given = params::execute_command(params)?;
    if given.command != RENDER_DOCUMENT_COMMAND {
        return Err(RequestError::InvalidParams(format!(
            "Unknown command: {}",
            given.command
        )));
    }
    let Some(Value::String(uri)) = given.arguments.as_ref().and_then(|a| a.first()) else {
        return Err(RequestError::InvalidParams(format!(
            "{RENDER_DOCUMENT_COMMAND} requires a document URI argument."
        )));
    };
    let path = file_uri_to_path(uri)?;
    Ok(Value::String(render_document(snapshot, &path)))
}

/// A glossary term with its definition, scope, and the alias that matched
/// when it is not the canonical spelling.
pub fn glossary_markdown(reference: &GlossaryReference) -> String {
    let term = reference.term;
    let mut lines = vec![
        format!("### term {}", term.term),
        String::new(),
        term.definition.clone(),
        String::new(),
        match &term.scope {
            GlossaryScope::Context(id) => format!("Bounded context: `{id}`"),
            GlossaryScope::Workspace => "Scope: workspace".to_owned(),
        },
    ];
    if reference.matched_spelling != term.term {
        lines.push(String::new());
        lines.push(format!("Matched alias: `{}`", reference.matched_spelling));
    }
    lines.join("\n")
}

/// `[label](uri#L<line>,<column>)` with one-based line and column.
fn markdown_link(label: &str, target: &LinkTarget) -> String {
    format!(
        "[{}]({}#L{},{})",
        escape_markdown(label),
        target.uri,
        target.line + 1,
        target.column + 1
    )
}

/// Backslash-escape the characters that Markdown reads as markup in a label.
pub fn escape_markdown(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '\\' | '`' | '*' | '_' | '[' | ']') {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

fn capitalize(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// `String.prototype.trim`: White_Space and the byte-order mark, but not U+0085.
fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
}

/// An authored link destination resolved against the `file:` URI of the file
/// that holds it, as `new URL(destination, base).href` does, with `(`, `)`
/// and `>` then percent-encoded. None when the destination is not a URL.
///
/// This is RFC 3986 resolution with the WHATWG encoding of paths, queries
/// and fragments. It follows the WHATWG parser for relative references, for
/// `file:` and for `http`, `https`, `ftp`, `ws` and `wss` destinations. It may
/// differ for: internationalized or malformed hosts (kept lowercase, not
/// punycoded; IPv4 numbers and IPv6 are not normalized), Windows drive
/// letters in `file:` URLs, percent-encoded hosts, and non-special schemes
/// with an authority (`ssh://host/x`), which are kept as written.
pub fn resolve_link(destination: &str, base: &str) -> Option<String> {
    let href = resolve(destination, base)?;
    Some(
        href.replace('(', "%28")
            .replace(')', "%29")
            .replace('>', "%3E"),
    )
}

fn resolve(destination: &str, base: &str) -> Option<String> {
    let trimmed = destination.trim_matches(|c: char| c <= ' ');
    let input: String = trimmed
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect();
    if let Some((scheme, rest)) = split_scheme(&input) {
        return match scheme.as_str() {
            "file" => resolve_file(rest, base),
            "http" | "https" | "ftp" | "ws" | "wss" => resolve_special(&scheme, rest),
            _ => Some(opaque(&scheme, rest)),
        };
    }
    resolve_file(&input, base)
}

/// The lowercase scheme and the text after its colon.
fn split_scheme(input: &str) -> Option<(String, &str)> {
    let colon = input.find(':')?;
    let scheme = &input[..colon];
    let mut chars = scheme.chars();
    let valid = chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    valid.then(|| (scheme.to_ascii_lowercase(), &input[colon + 1..]))
}

/// A non-special URL: its path is kept, with the fragment encoded.
fn opaque(scheme: &str, rest: &str) -> String {
    let (before, fragment) = split_fragment(rest);
    let mut out = format!(
        "{scheme}:{}",
        percent_encode(before, |b| !(0x20..=0x7e).contains(&b))
    );
    push_query_and_fragment(&mut out, None, fragment);
    out
}

/// `http`-like URLs: authority required, empty path is `/`.
fn resolve_special(scheme: &str, rest: &str) -> Option<String> {
    let rest = rest.trim_start_matches(['/', '\\']);
    let end = rest.find(['/', '\\', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    let (userinfo, hostport) = match authority.rfind('@') {
        Some(at) => (Some(&authority[..at]), &authority[at + 1..]),
        None => (None, authority),
    };
    let (host, port) = match hostport.rfind(':') {
        Some(colon) if !hostport[colon..].contains(']') => {
            (&hostport[..colon], Some(&hostport[colon + 1..]))
        }
        _ => (hostport, None),
    };
    if host.is_empty() || host.contains([' ', '<', '>', '^', '|', '%']) {
        return None;
    }
    let default = match scheme {
        "http" | "ws" => "80",
        "https" | "wss" => "443",
        "ftp" => "21",
        _ => "",
    };
    let port = match port {
        None | Some("") => None,
        Some(digits) => {
            let value: u32 = digits
                .chars()
                .all(|c| c.is_ascii_digit())
                .then(|| digits.parse().ok())
                .flatten()
                .filter(|v| *v <= 65535)?;
            (value.to_string() != default).then(|| value.to_string())
        }
    };
    let mut out = format!("{scheme}://");
    if let Some(userinfo) = userinfo {
        out.push_str(userinfo);
        out.push('@');
    }
    out.push_str(&host.to_lowercase());
    if let Some(port) = port {
        out.push(':');
        out.push_str(&port);
    }
    let (path, query, fragment) = split_reference(tail);
    out.push_str(&if path.is_empty() {
        "/".to_owned()
    } else {
        join_path(Vec::new(), path)
    });
    push_query_and_fragment(&mut out, query, fragment);
    Some(out)
}

/// A `file:` URL, or a relative reference against the base `file:` URI.
fn resolve_file(reference: &str, base: &str) -> Option<String> {
    let slashes = |c: char| c == '/' || c == '\\';
    let after_scheme = base.strip_prefix("file://")?;
    let path_at = after_scheme.find('/').unwrap_or(after_scheme.len());
    let (base_host, base_path) = after_scheme.split_at(path_at);
    let base_path = base_path.split(['?', '#']).next().unwrap_or("");
    if reference.starts_with(['/', '\\']) && reference[1..].starts_with(slashes) {
        let rest = &reference[2..];
        let end = rest.find(['/', '\\', '?', '#']).unwrap_or(rest.len());
        let host = rest[..end].to_lowercase();
        let host = if host == "localhost" { "" } else { &host };
        let (path, query, fragment) = split_reference(&rest[end..]);
        let mut out = format!("file://{host}{}", join_path(Vec::new(), path));
        push_query_and_fragment(&mut out, query, fragment);
        return Some(out);
    }
    let (path, query, fragment) = split_reference(reference);
    let mut out = format!("file://{base_host}");
    if path.is_empty() {
        // An empty path leaves a query only when the reference starts with `?`.
        out.push_str(base_path);
        push_query_and_fragment(&mut out, query, fragment);
        return Some(out);
    }
    let directory = if path.starts_with(slashes) {
        Vec::new()
    } else {
        let mut segments: Vec<String> = base_path.split('/').skip(1).map(str::to_owned).collect();
        segments.pop();
        segments
    };
    out.push_str(&join_path(directory, path));
    push_query_and_fragment(&mut out, query, fragment);
    Some(out)
}

fn split_fragment(text: &str) -> (&str, Option<&str>) {
    match text.find('#') {
        Some(at) => (&text[..at], Some(&text[at + 1..])),
        None => (text, None),
    }
}

/// The path, query and fragment of a reference.
fn split_reference(text: &str) -> (&str, Option<&str>, Option<&str>) {
    let (before, fragment) = split_fragment(text);
    match before.find('?') {
        Some(at) => (&before[..at], Some(&before[at + 1..]), fragment),
        None => (before, None, fragment),
    }
}

fn push_query_and_fragment(out: &mut String, query: Option<&str>, fragment: Option<&str>) {
    if let Some(query) = query {
        out.push('?');
        out.push_str(&percent_encode(query, in_query_set));
    }
    if let Some(fragment) = fragment {
        out.push('#');
        out.push_str(&percent_encode(fragment, in_fragment_set));
    }
}

/// Append the segments of `path` to the already-encoded `directory` segments,
/// handling `.` and `..`, and write the result with a leading slash.
fn join_path(mut segments: Vec<String>, path: &str) -> String {
    let path = path.replace('\\', "/");
    let parts: Vec<&str> = path.split('/').collect();
    let skip = usize::from(path.starts_with('/'));
    for (index, part) in parts.iter().enumerate().skip(skip) {
        let last = index + 1 == parts.len();
        let lower = part.to_ascii_lowercase();
        if matches!(lower.as_str(), ".." | ".%2e" | "%2e." | "%2e%2e") {
            segments.pop();
            if last {
                segments.push(String::new());
            }
        } else if matches!(lower.as_str(), "." | "%2e") {
            if last {
                segments.push(String::new());
            }
        } else {
            segments.push(percent_encode(part, in_path_set));
        }
    }
    format!("/{}", segments.join("/"))
}

fn in_fragment_set(byte: u8) -> bool {
    byte <= b' ' || byte > 0x7e || matches!(byte, b'"' | b'<' | b'>' | b'`')
}

fn in_query_set(byte: u8) -> bool {
    byte <= b' ' || byte > 0x7e || matches!(byte, b'"' | b'#' | b'<' | b'>' | b'\'')
}
