//! Semantic tokens: component names, Tag identities and glossary terms.
use crate::{
    occurrences::{component_occurrences, glossary_references, overlaps, tag_occurrences},
    params,
    position::range_of,
    server::Answer,
    snapshot::Snapshot,
    uri::file_uri_to_path,
};
use serde_json::{Value, json};
use sigil_core::language::{parse::Span, position::EditorRange};
use std::collections::HashMap;

const COMPONENT: u32 = 0;
const TAG: u32 = 1;
const TERM: u32 = 2;
/// The token types by number: `COMPONENT`, `TAG`, `TERM`.
pub const LEGEND: [&str; 3] = ["type", "tag", "term"];

/// The answer to `textDocument/semanticTokens/full`: the encoded tokens of the
/// document, or none when the file is not a document of the workspace.
pub(crate) fn semantic_tokens(snapshot: &Snapshot, params: &Value) -> Answer {
    let given = params::semantic_tokens(params)?;
    let path = file_uri_to_path(&given.uri)?;
    Ok(json!({"data": encode(&tokens_of(snapshot, &path))}))
}

type Token = (EditorRange, u32);

/// The tokens of a file in position order, one per range, single-line only.
fn tokens_of(snapshot: &Snapshot, path: &str) -> Vec<Token> {
    let Some(file) = snapshot.file_index(path) else {
        return Vec::new();
    };
    let Some((source, from_disk)) = snapshot.reading(path) else {
        return Vec::new();
    };
    let convert = |span: Span| range_of(source, from_disk, &span.range());
    let structured: Vec<Token> = component_occurrences(snapshot, file)
        .iter()
        .filter_map(|i| Some((convert(i.range)?, COMPONENT)))
        .chain(
            tag_occurrences(snapshot, file)
                .iter()
                .filter_map(|i| Some((convert(i.range)?, TAG))),
        )
        .collect();
    let glossary: Vec<Token> = glossary_references(snapshot, path)
        .into_iter()
        .map(|g| (g.range, TERM))
        .collect();
    merge(structured, glossary)
}

/// The structured tokens, then the glossary tokens that overlap none of them,
/// one per range in position order. A range that comes up again keeps its
/// first place and takes the later type.
fn merge(structured: Vec<Token>, glossary: Vec<Token>) -> Vec<Token> {
    let free = glossary
        .into_iter()
        .filter(|(g, _)| !structured.iter().any(|(range, _)| overlaps(range, g)))
        .collect::<Vec<_>>();
    let mut places: HashMap<[u32; 4], usize> = HashMap::new();
    let mut unique: Vec<Token> = Vec::new();
    for (range, kind) in structured.into_iter().chain(free) {
        let key = [
            range.start.line,
            range.start.character,
            range.end.line,
            range.end.character,
        ];
        match places.get(&key) {
            Some(&place) => unique[place].1 = kind,
            None => {
                places.insert(key, unique.len());
                unique.push((range, kind));
            }
        }
    }
    unique.sort_by_key(|(range, _)| range.start);
    unique
}

fn encode(tokens: &[Token]) -> Vec<u32> {
    let (mut line, mut character) = (0, 0);
    let mut data = Vec::new();
    for (range, kind) in tokens {
        if range.start.line != range.end.line {
            continue;
        }
        let delta = range.start.line - line;
        data.extend([
            delta,
            if delta == 0 {
                range.start.character - character
            } else {
                range.start.character
            },
            range.end.character - range.start.character,
            *kind,
            0,
        ]);
        line = range.start.line;
        character = range.start.character;
    }
    data
}

#[cfg(test)]
mod tests {
    use super::*;
    use sigil_core::language::position::EditorPosition;

    fn token(from: (u32, u32), to: (u32, u32), kind: u32) -> Token {
        let point = |(line, character)| EditorPosition { line, character };
        (
            EditorRange {
                start: point(from),
                end: point(to),
            },
            kind,
        )
    }

    #[test]
    fn a_range_seen_twice_keeps_its_place_and_takes_the_later_type() {
        let merged = merge(
            vec![
                token((2, 0), (2, 4), COMPONENT),
                token((1, 0), (1, 4), COMPONENT),
                token((2, 0), (2, 4), TAG),
            ],
            Vec::new(),
        );
        assert_eq!(
            merged,
            [token((1, 0), (1, 4), COMPONENT), token((2, 0), (2, 4), TAG)]
        );
    }

    #[test]
    fn a_glossary_range_that_overlaps_a_structured_one_is_dropped() {
        let merged = merge(
            vec![token((0, 5), (0, 10), TAG)],
            vec![
                token((0, 0), (0, 5), TERM),
                token((0, 4), (0, 6), TERM),
                token((0, 9), (0, 12), TERM),
                token((0, 10), (0, 14), TERM),
                token((1, 0), (1, 3), TERM),
            ],
        );
        assert_eq!(
            merged,
            [
                token((0, 0), (0, 5), TERM),
                token((0, 5), (0, 10), TAG),
                token((0, 10), (0, 14), TERM),
                token((1, 0), (1, 3), TERM),
            ]
        );
    }

    #[test]
    fn tokens_are_deltas_and_a_range_over_two_lines_is_skipped() {
        let data = encode(&[
            token((0, 10), (0, 18), COMPONENT),
            token((1, 2), (3, 4), TAG),
            token((5, 7), (5, 19), TAG),
            token((5, 25), (5, 29), TERM),
        ]);
        // The skipped range does not move the previous position.
        assert_eq!(data, [0, 10, 8, 0, 0, 5, 7, 12, 1, 0, 0, 18, 4, 2, 0]);
    }
}
