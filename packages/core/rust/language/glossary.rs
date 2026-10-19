//! Workspace glossary (`.sigil/glossary.json`): strict validation, the
//! per-source context overlap check, and term recognition in facet prose.
use super::{
    diagnostics::{Location, diagnostic},
    parse::{Document, Facet, Section, line_index_at},
    path::{glob_matches, normalize_path},
    resolve::ResolvedWorkspace,
    text::capture_source,
    workspace::Workspace,
};
use crate::types::{Diagnostic, Range};
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::LazyLock;

/// Where a glossary term is declared: the workspace, or one bounded context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GlossaryScope {
    Workspace,
    Context(String),
}

/// One reviewed term: a canonical spelling, its definition and its aliases.
#[derive(Debug, Clone)]
pub struct GlossaryTerm {
    pub term: String,
    pub definition: String,
    pub aliases: Vec<String>,
    /// False hides the term from agent-facing context only.
    pub agent_context: bool,
    pub scope: GlossaryScope,
    /// Where the canonical spelling is written in the glossary file.
    pub declaration_range: Range,
}

#[derive(Debug, Clone)]
pub struct Context {
    pub id: String,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub terms: Vec<GlossaryTerm>,
}

#[derive(Debug, Clone)]
pub struct Glossary {
    pub file_path: String,
    pub terms: Vec<GlossaryTerm>,
    pub contexts: Vec<Context>,
}

pub struct GlossaryParse {
    pub glossary: Option<Glossary>,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn parse_glossary(bytes: &[u8], file_path: &str) -> GlossaryParse {
    let captured = capture_source(file_path, bytes);
    let Some(source) = captured.source.filter(|_| captured.diagnostics.is_empty()) else {
        return GlossaryParse {
            glossary: None,
            diagnostics: captured
                .diagnostics
                .into_iter()
                .map(|d| {
                    diagnostic(
                        "SIGIL_GLOSSARY_PARSE",
                        d.message,
                        Location::at(file_path, d.range),
                    )
                })
                .collect(),
        };
    };
    let value: Value = match serde_json::from_str(&source.text) {
        Ok(value) => value,
        Err(error) => {
            return GlossaryParse {
                glossary: None,
                diagnostics: vec![diagnostic(
                    "SIGIL_GLOSSARY_PARSE",
                    format!("Unable to parse .sigil/glossary.json JSON: {error}"),
                    Location::at(file_path, None),
                )],
            };
        }
    };
    let mut messages = Vec::new();
    match value.as_object() {
        None => messages.push("Glossary must be a JSON object.".to_owned()),
        Some(object) => {
            reject_unknown(
                object,
                &["schemaVersion", "terms", "contexts"],
                "glossary",
                &mut messages,
            );
            if object.get("schemaVersion").and_then(Value::as_i64) != Some(1) {
                messages.push("schemaVersion must equal 1.".into());
            }
            validate_terms(object.get("terms"), "terms", &mut messages);
            validate_contexts(object.get("contexts"), &mut messages);
        }
    }
    if !messages.is_empty() {
        return GlossaryParse {
            glossary: None,
            diagnostics: messages
                .into_iter()
                .map(|m| {
                    let code = if m.contains(" collides with ") {
                        "SIGIL_GLOSSARY_TERM_COLLISION"
                    } else {
                        "SIGIL_GLOSSARY_INVALID"
                    };
                    diagnostic(code, m, Location::at(file_path, None))
                })
                .collect(),
        };
    }
    let mut ranges = TermRangeFinder::new(&source.text);
    let terms = terms_of(&value["terms"], &GlossaryScope::Workspace, &mut ranges);
    let contexts = value["contexts"]
        .as_array()
        .expect("validated contexts")
        .iter()
        .map(|c| {
            let strings = |key: &str| -> Vec<String> {
                c[key]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            };
            let id = c["id"].as_str().unwrap_or_default().to_owned();
            let scope = GlossaryScope::Context(id.clone());
            Context {
                terms: terms_of(&c["terms"], &scope, &mut ranges),
                id,
                include: strings("include"),
                exclude: strings("exclude"),
            }
        })
        .collect();
    GlossaryParse {
        glossary: Some(Glossary {
            file_path: file_path.to_owned(),
            terms,
            contexts,
        }),
        diagnostics: Vec::new(),
    }
}

/// A source matching more than one bounded context is invalid.
pub fn context_overlap(glossary: &Glossary, file_path: &str) -> Option<Diagnostic> {
    let normalized = normalize_path(file_path);
    let normalized = normalized.strip_prefix("./").unwrap_or(&normalized);
    let matches: Vec<&str> = glossary
        .contexts
        .iter()
        .filter(|c| {
            c.include.iter().any(|p| glob_matches(p, normalized))
                && !c.exclude.iter().any(|p| glob_matches(p, normalized))
        })
        .map(|c| c.id.as_str())
        .collect();
    (matches.len() > 1).then(|| {
        diagnostic(
            "SIGIL_GLOSSARY_CONTEXT_OVERLAP",
            format!(
                "Sigil source {normalized} matches multiple glossary contexts: {}.",
                matches.join(", ")
            ),
            Location::at(file_path, None),
        )
    })
}

/// JavaScript's `String.prototype.trim` whitespace set, which differs from Rust's.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

fn is_trimmed(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| !s.is_empty() && !s.starts_with(is_js_space) && !s.ends_with(is_js_space))
}

fn reject_unknown(
    object: &Map<String, Value>,
    allowed: &[&str],
    owner: &str,
    messages: &mut Vec<String>,
) {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            messages.push(format!("{owner} contains unknown key {key:?}."));
        }
    }
}

fn validate_terms(value: Option<&Value>, owner: &str, messages: &mut Vec<String>) {
    let Some(items) = value.and_then(Value::as_array) else {
        messages.push(format!("{owner} must be an array."));
        return;
    };
    let mut spellings: HashMap<String, String> = HashMap::new();
    for (index, item) in items.iter().enumerate() {
        let entry = format!("{owner}[{index}]");
        let Some(object) = item.as_object() else {
            messages.push(format!("{entry} must be an object."));
            continue;
        };
        reject_unknown(
            object,
            &["term", "definition", "aliases", "agentContext"],
            &entry,
            messages,
        );
        for field in ["term", "definition"] {
            if !object.get(field).is_some_and(is_trimmed) {
                messages.push(format!(
                    "{entry}.{field} must be a trimmed non-empty string."
                ));
            }
        }
        if let Some(aliases) = object.get("aliases")
            && !aliases.as_array().is_some_and(|a| a.iter().all(is_trimmed))
        {
            messages.push(format!(
                "{entry}.aliases must be an array of trimmed non-empty strings."
            ));
        }
        if object.get("agentContext").is_some_and(|v| !v.is_boolean()) {
            messages.push(format!("{entry}.agentContext must be a boolean."));
        }
        let mut entry_spellings: Vec<&str> = object
            .get("term")
            .and_then(Value::as_str)
            .into_iter()
            .collect();
        if object.get("term").is_some_and(Value::is_string) {
            entry_spellings.extend(
                object
                    .get("aliases")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str),
            );
        } else {
            entry_spellings.clear();
        }
        for spelling in entry_spellings {
            if !is_trimmed(&Value::String(spelling.to_owned())) {
                continue;
            }
            let normalized = spelling.to_lowercase();
            if let Some(previous) = spellings.get(&normalized) {
                messages.push(format!(
                    "{entry} spelling {spelling:?} collides with {previous:?} in the same scope."
                ));
            } else {
                spellings.insert(normalized, spelling.to_owned());
            }
        }
    }
}

fn validate_contexts(value: Option<&Value>, messages: &mut Vec<String>) {
    let Some(items) = value.and_then(Value::as_array) else {
        messages.push("contexts must be an array.".into());
        return;
    };
    let mut ids = std::collections::HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let owner = format!("contexts[{index}]");
        let Some(object) = item.as_object() else {
            messages.push(format!("{owner} must be an object."));
            continue;
        };
        reject_unknown(
            object,
            &["id", "include", "exclude", "terms"],
            &owner,
            messages,
        );
        let id_ok = |s: &str| {
            let mut chars = s.chars();
            chars.next().is_some_and(|c| c.is_ascii_alphabetic())
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        };
        match object.get("id").and_then(Value::as_str) {
            Some(id) if id_ok(id) => {
                if !ids.insert(id.to_lowercase()) {
                    messages
                        .push("Glossary context ids must be unique without regard to case.".into());
                }
            }
            _ => messages.push(format!("{owner}.id must match [A-Za-z][A-Za-z0-9_-]*.")),
        }
        validate_globs(
            object.get("include"),
            &format!("{owner}.include"),
            true,
            messages,
        );
        validate_globs(
            object.get("exclude"),
            &format!("{owner}.exclude"),
            false,
            messages,
        );
        validate_terms(object.get("terms"), &format!("{owner}.terms"), messages);
    }
}

fn validate_globs(value: Option<&Value>, owner: &str, non_empty: bool, messages: &mut Vec<String>) {
    let items = value.and_then(Value::as_array);
    if !items.is_some_and(|i| (!non_empty || !i.is_empty()) && i.iter().all(is_trimmed)) {
        messages.push(format!(
            "{owner} must be {} array of trimmed non-empty strings.",
            if non_empty { "a non-empty" } else { "an" }
        ));
        return;
    }
    let patterns: Vec<&str> = items
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let relative = |p: &str| {
        let b = p.as_bytes();
        !p.starts_with('/')
            && !(b.len() >= 3
                && b[0].is_ascii_alphabetic()
                && b[1] == b':'
                && (b[2] == b'/' || b[2] == b'\\'))
            && !p.contains('\\')
            && !p.split('/').any(|s| s == "..")
    };
    if !patterns.iter().all(|p| relative(p)) {
        messages.push(format!(
            "{owner} patterns must be workspace-relative POSIX globs."
        ));
    }
    let unique: std::collections::HashSet<&&str> = patterns.iter().collect();
    if unique.len() != patterns.len() {
        messages.push(format!("{owner} patterns must be unique."));
    }
}

fn terms_of(
    value: &Value,
    scope: &GlossaryScope,
    ranges: &mut TermRangeFinder,
) -> Vec<GlossaryTerm> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .map(|entry| {
            let term = entry["term"].as_str().unwrap_or_default().to_owned();
            GlossaryTerm {
                definition: entry["definition"].as_str().unwrap_or_default().to_owned(),
                aliases: entry["aliases"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect(),
                agent_context: entry["agentContext"].as_bool().unwrap_or(true),
                scope: scope.clone(),
                declaration_range: ranges.take(&term),
                term,
            }
        })
        .collect()
}

/// Finds where each `"term": "..."` value is written, in file order, so that a
/// term's declaration range names its own spelling even when several terms are
/// alike.
struct TermRangeFinder {
    matches: Vec<(String, Range, bool)>,
}

impl TermRangeFinder {
    fn new(text: &str) -> Self {
        static TERM: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r#""term"\s*:\s*("(?:\\.|[^"\\])*")"#).expect("term pattern")
        });
        let matches = TERM
            .captures_iter(text)
            .filter_map(|capture| {
                let quoted = capture.get(1)?;
                let value: String = serde_json::from_str(quoted.as_str()).ok()?;
                Some((
                    value,
                    Range {
                        start: quoted.start() + 1,
                        end: quoted.end() - 1,
                    },
                    false,
                ))
            })
            .collect();
        Self { matches }
    }

    fn take(&mut self, value: &str) -> Range {
        match self
            .matches
            .iter_mut()
            .find(|(v, _, used)| !used && v == value)
        {
            Some((_, range, used)) => {
                *used = true;
                range.clone()
            }
            None => Range { start: 0, end: 0 },
        }
    }
}

/// The terms in force for one source: workspace terms, with each term or alias
/// that its context redefines removed, then the context's own terms.
#[derive(Debug, Clone)]
pub struct ResolvedGlossaryContext {
    pub file_path: String,
    pub context_id: Option<String>,
    pub entries: Vec<GlossaryTerm>,
}

/// The glossary terms that apply to `file_path`. A source that matches more
/// than one bounded context has the plain workspace terms and a diagnostic.
pub fn resolve_glossary_for_file(
    glossary: &Glossary,
    file_path: &str,
) -> (ResolvedGlossaryContext, Option<Diagnostic>) {
    let normalized = normalize_path(file_path);
    let normalized = normalized
        .strip_prefix("./")
        .unwrap_or(&normalized)
        .to_owned();
    let matches: Vec<&Context> = glossary
        .contexts
        .iter()
        .filter(|c| {
            c.include.iter().any(|p| glob_matches(p, &normalized))
                && !c.exclude.iter().any(|p| glob_matches(p, &normalized))
        })
        .collect();
    if matches.len() > 1 {
        return (
            ResolvedGlossaryContext {
                file_path: normalized.clone(),
                context_id: None,
                entries: glossary.terms.clone(),
            },
            context_overlap(glossary, file_path),
        );
    }
    let matched = matches.first();
    let entries = match matched {
        Some(context) => merge_effective_terms(&glossary.terms, &context.terms),
        None => glossary.terms.clone(),
    };
    (
        ResolvedGlossaryContext {
            file_path: normalized,
            context_id: matched.map(|c| c.id.clone()),
            entries,
        },
        None,
    )
}

fn merge_effective_terms(
    workspace: &[GlossaryTerm],
    contextual: &[GlossaryTerm],
) -> Vec<GlossaryTerm> {
    let redefined: Vec<String> = contextual
        .iter()
        .flat_map(|t| std::iter::once(&t.term).chain(&t.aliases))
        .map(|s| s.to_lowercase())
        .collect();
    let mut entries: Vec<GlossaryTerm> = workspace
        .iter()
        .filter(|t| !redefined.contains(&t.term.to_lowercase()))
        .map(|t| GlossaryTerm {
            aliases: t
                .aliases
                .iter()
                .filter(|a| !redefined.contains(&a.to_lowercase()))
                .cloned()
                .collect(),
            ..t.clone()
        })
        .collect();
    entries.extend(contextual.iter().cloned());
    entries
}

/// A glossary term found in facet prose.
#[derive(Debug, Clone)]
pub struct GlossaryOccurrence {
    pub term: GlossaryTerm,
    pub matched_spelling: String,
    pub file_path: String,
    pub owner_name: String,
    pub section_name: String,
    pub range: Range,
}

/// Find every term of `context` in the prose of `document`, matching without
/// regard to case at word boundaries and preferring the longest spelling. Text
/// in backticks, URLs and embedded content is never matched.
pub fn glossary_occurrences(
    context: &ResolvedGlossaryContext,
    document: &Document,
) -> Vec<GlossaryOccurrence> {
    let Some(source) = document.source.as_ref() else {
        return Vec::new();
    };
    if context.entries.is_empty() {
        return Vec::new();
    }
    let mut spellings: Vec<(&str, &GlossaryTerm)> = context
        .entries
        .iter()
        .flat_map(|t| {
            std::iter::once(t.term.as_str())
                .chain(t.aliases.iter().map(String::as_str))
                .map(move |s| (s, t))
        })
        .collect();
    spellings.sort_by(|(a, _), (b, _)| {
        b.encode_utf16()
            .count()
            .cmp(&a.encode_utf16().count())
            .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
            .then_with(|| a.cmp(b))
    });
    let spellings: Vec<Spelling> = spellings
        .into_iter()
        .map(|(spelling, term)| Spelling {
            folded: spelling.chars().map(fold).collect(),
            term,
        })
        .collect();
    let mut units: Vec<(&str, &Section, &Facet)> = document
        .components
        .iter()
        .flat_map(|c| {
            c.sections
                .iter()
                .flat_map(move |s| s.units.iter().map(move |f| (c.name.as_str(), s, f)))
        })
        .collect();
    units.sort_by_key(|(_, _, facet)| facet.range.start);

    let mut occurrences = Vec::new();
    for (owner, section, facet) in units {
        let mut line = line_index_at(source, facet.prose_range.start).unwrap_or(0);
        while line < source.lines.len() && source.lines[line].start < facet.prose_range.end {
            let physical = &source.lines[line];
            let content = &source.text[physical.start..physical.content_end];
            let text = content.trim();
            let start = physical.start + content.find(text).unwrap_or(0);
            occurrences.extend(match_line(
                text,
                start,
                &spellings,
                OccurrenceContext {
                    file_path: &document.file_path,
                    owner,
                    section: &section.name,
                },
            ));
            line += 1;
        }
    }
    occurrences
}

/// One spelling of a term, folded for matching without regard to case.
struct Spelling<'a> {
    folded: Vec<char>,
    term: &'a GlossaryTerm,
}

struct OccurrenceContext<'a> {
    file_path: &'a str,
    owner: &'a str,
    section: &'a str,
}

fn match_line(
    text: &str,
    start: usize,
    spellings: &[Spelling],
    context: OccurrenceContext,
) -> Vec<GlossaryOccurrence> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let lower: Vec<char> = chars.iter().map(|(_, c)| fold(*c)).collect();
    let excluded = excluded_columns(text, &chars);
    let byte_at = |index: usize| chars.get(index).map_or(text.len(), |(offset, _)| *offset);
    let mut occurrences = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if excluded[index] {
            index += 1;
            continue;
        }
        let found = spellings.iter().find(|spelling| {
            let end = index + spelling.folded.len();
            end <= chars.len()
                && lower[index..end] == spelling.folded[..]
                && !excluded[index..end].iter().any(|e| *e)
                && is_boundary(index.checked_sub(1).map(|i| chars[i].1))
                && is_boundary(chars.get(end).map(|(_, c)| *c))
        });
        let Some(Spelling { folded, term }) = found else {
            index += 1;
            continue;
        };
        let length = folded.len();
        occurrences.push(GlossaryOccurrence {
            term: (*term).clone(),
            matched_spelling: text[byte_at(index)..byte_at(index + length)].to_owned(),
            file_path: context.file_path.to_owned(),
            owner_name: context.owner.to_owned(),
            section_name: context.section.to_owned(),
            range: Range {
                start: start + byte_at(index),
                end: start + byte_at(index + length),
            },
        });
        index += length;
    }
    occurrences
}

/// A character compared without regard to case: its lowercase form when that
/// is one character, else itself.
fn fold(c: char) -> char {
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(one), None) => one,
        _ => c,
    }
}

fn excluded_columns(text: &str, chars: &[(usize, char)]) -> Vec<bool> {
    static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`[^`]*`").expect("code pattern"));
    static URL: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\bhttps?://[^\s)>\]]+").expect("url pattern"));
    let mut excluded = vec![false; chars.len()];
    for found in CODE.find_iter(text).chain(URL.find_iter(text)) {
        for (index, (offset, _)) in chars.iter().enumerate() {
            if *offset >= found.start() && *offset < found.end() {
                excluded[index] = true;
            }
        }
    }
    excluded
}

fn is_boundary(c: Option<char>) -> bool {
    static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[\p{L}\p{N}_]$").expect("word"));
    c.is_none_or(|c| !WORD.is_match(c.encode_utf8(&mut [0; 4])))
}

/// What the glossary found across a workspace.
#[derive(Debug)]
pub struct GlossaryProjection {
    pub glossary_path: Option<String>,
    pub terms: Vec<GlossaryTerm>,
    pub contexts: Vec<Context>,
    pub resolved_contexts: Vec<ResolvedGlossaryContext>,
    pub occurrences: Vec<GlossaryOccurrence>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Resolve each source's glossary terms and find their occurrences. A source
/// that matches several contexts gets no occurrences, only the diagnostic that
/// loading already reported.
pub fn glossary_projection(
    workspace: &Workspace,
    resolved: &ResolvedWorkspace,
) -> GlossaryProjection {
    let diagnostics: Vec<Diagnostic> = workspace
        .diagnostics
        .iter()
        .filter(|d| d.code.starts_with("SIGIL_GLOSSARY_"))
        .cloned()
        .collect();
    let Some(glossary) = &workspace.glossary else {
        return GlossaryProjection {
            glossary_path: None,
            terms: Vec::new(),
            contexts: Vec::new(),
            resolved_contexts: Vec::new(),
            occurrences: Vec::new(),
            diagnostics,
        };
    };
    let mut resolved_contexts = Vec::new();
    let mut occurrences = Vec::new();
    for (path, document) in resolved.paths.iter().zip(&resolved.documents) {
        let (context, overlap) = resolve_glossary_for_file(glossary, path);
        if overlap.is_none() {
            occurrences.extend(glossary_occurrences(&context, document));
        }
        resolved_contexts.push(context);
    }
    GlossaryProjection {
        glossary_path: Some(glossary.file_path.clone()),
        terms: glossary.terms.clone(),
        contexts: glossary.contexts.clone(),
        resolved_contexts,
        occurrences,
        diagnostics,
    }
}
