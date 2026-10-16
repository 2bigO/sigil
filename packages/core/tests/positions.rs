//! Editor positions, character locations and byte offsets over one source.
//! Ported from the TS source-text tests (`tests/source_text_test.ts`).
use sigil_core::language::{
    position::{EditorPosition, EditorRange, SourceLocation},
    text::{SourceText, capture_source},
    workspace::Workspace,
};
use sigil_core::types::Range;
use std::fs;

fn editor(line: u32, character: u32) -> EditorPosition {
    EditorPosition { line, character }
}

fn location(line: u32, column: u32) -> SourceLocation {
    SourceLocation { line, column }
}

/// BOM, `a`, a supplementary character, `e` plus a combining mark, then CRLF, CR and LF.
fn mixed() -> SourceText {
    let text = "\u{feff}a😀e\u{301}\r\nb\rc\n";
    let capture = capture_source("unicode.sigil", text.as_bytes());
    assert!(capture.diagnostics.is_empty());
    capture.source.expect("valid UTF-8")
}

#[test]
fn a_byte_has_a_character_location_and_an_editor_position() {
    let source = mixed();
    // BOM is 3 bytes, `a` 1, the emoji 4: byte 8 follows the emoji.
    assert_eq!(source.location_at_byte(8), Some(location(1, 4)));
    assert_eq!(source.editor_position_at(8), Some(editor(0, 4)));
    assert_eq!(source.byte_at_location(location(1, 3)), Some(4));
    assert_eq!(source.byte_at_editor_position(editor(0, 4)), Some(8));
}

#[test]
fn an_offset_or_position_inside_a_character_has_no_counterpart() {
    let source = mixed();
    // Byte 5 is inside the emoji; UTF-16 index 3 is between its surrogates.
    assert_eq!(source.editor_position_at(5), None);
    assert_eq!(source.location_at_byte(5), None);
    assert_eq!(source.byte_at_editor_position(editor(0, 3)), None);
}

#[test]
fn the_emoji_example_counts_each_form_its_own_way() {
    let source = capture_source("a.sigil", "a😀b".as_bytes()).source.unwrap();
    // `b` starts at byte 5, UTF-16 unit 3 from 0, and character column 3 from 1.
    assert_eq!(source.editor_position_at(5), Some(editor(0, 3)));
    assert_eq!(source.location_at_byte(5), Some(location(1, 3)));
    assert_eq!(source.editor_position_at(2), None);
}

#[test]
fn line_endings_start_a_new_line_and_are_not_inside_a_line() {
    let source = mixed();
    // The CRLF starts at byte 11; its LF at byte 12 is not inside any line.
    assert_eq!(source.editor_position_at(11), Some(editor(0, 6)));
    assert_eq!(source.editor_position_at(12), None);
    assert_eq!(source.editor_position_at(13), Some(editor(1, 0)));
    // `b`, a lone CR, `c`, a lone LF and a final empty line.
    assert_eq!(source.editor_position_at(14), Some(editor(1, 1)));
    assert_eq!(source.editor_position_at(15), Some(editor(2, 0)));
    assert_eq!(source.editor_position_at(17), Some(editor(3, 0)));
}

#[test]
fn offsets_and_positions_past_the_end_have_no_counterpart() {
    let source = mixed();
    assert_eq!(source.editor_position_at(source.text.len() + 1), None);
    assert_eq!(source.byte_at_editor_position(editor(9, 0)), None);
    assert_eq!(source.byte_at_editor_position(editor(1, 2)), None);
    assert_eq!(source.byte_at_location(location(1, 0)), None);
    assert_eq!(source.byte_at_location(location(1, 99)), None);
}

#[test]
fn every_offset_with_a_counterpart_round_trips() {
    let source = mixed();
    for offset in 0..=source.text.len() {
        if let Some(position) = source.editor_position_at(offset) {
            assert_eq!(source.byte_at_editor_position(position), Some(offset));
        }
        if let Some(found) = source.location_at_byte(offset) {
            assert_eq!(source.byte_at_location(found), Some(offset));
        }
    }
}

#[test]
fn a_range_converts_to_an_editor_range() {
    let source = mixed();
    let range = Range { start: 4, end: 8 };
    assert_eq!(source.slice(&range), Some("😀"));
    assert_eq!(
        source.editor_range(&range),
        Some(EditorRange {
            start: editor(0, 2),
            end: editor(0, 4)
        })
    );
    assert_eq!(source.editor_range(&Range { start: 4, end: 5 }), None);
}

#[test]
fn a_diagnostic_of_a_workspace_has_an_editor_range() {
    let root = std::env::temp_dir().join(format!("sigil-core-positions-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join(".sigil")).unwrap();
    fs::write(
        root.join(".sigil/config.json"),
        r#"{"sigilVersion":"0.9.0","workspace":{"name":"p"},"files":{"include":["**/*.sigil"]}}"#,
    )
    .unwrap();
    // A NUL after an emoji is reported with a byte range.
    fs::write(root.join("a.sigil"), "😀\0x").unwrap();
    let workspace = Workspace::load(&root).unwrap();
    let diagnostic = workspace
        .diagnostics
        .iter()
        .find(|d| d.code == "SIGIL_INVALID_CHARACTER")
        .expect("a NUL diagnostic")
        .clone();
    assert_eq!(diagnostic.range, Some(Range { start: 4, end: 5 }));
    assert_eq!(
        workspace.editor_range(&diagnostic),
        Some(EditorRange {
            start: editor(0, 2),
            end: editor(0, 3)
        })
    );
    let _ = fs::remove_dir_all(&root);
}
