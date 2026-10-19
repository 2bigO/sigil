//! Editor positions for a source, with the byte-order mark of a disk file hidden.
//!
//! Editors strip a leading U+FEFF from the text they show, so a file read from
//! disk is counted without it: line 0 loses one UTF-16 unit, and an offset
//! inside the mark has no position. A buffer comes from the editor, which has
//! already stripped the mark, so it is counted as it is. Core's own positions
//! still count the mark.
use sigil_core::{
    language::{
        position::{EditorPosition, EditorRange},
        text::SourceText,
    },
    types::Range,
};

/// How many UTF-16 units the editor does not show on line 0.
fn hidden(source: &SourceText, from_disk: bool) -> u32 {
    u32::from(from_disk && source.text.starts_with('\u{feff}'))
}

/// The position of byte `offset`, or none when it is inside a character, a
/// line ending, or the hidden mark.
pub fn position_at(source: &SourceText, from_disk: bool, offset: usize) -> Option<EditorPosition> {
    let hidden = hidden(source, from_disk);
    let point = source.editor_position_at(offset)?;
    if point.line != 0 {
        return Some(point);
    }
    Some(EditorPosition {
        line: 0,
        character: point.character.checked_sub(hidden)?,
    })
}

/// The editor range of a byte range, or none when either end has no position.
pub fn range_of(source: &SourceText, from_disk: bool, range: &Range) -> Option<EditorRange> {
    Some(EditorRange {
        start: position_at(source, from_disk, range.start)?,
        end: position_at(source, from_disk, range.end)?,
    })
}

/// The byte offset of an editor position, or none when it names no character
/// boundary.
pub fn byte_at(source: &SourceText, from_disk: bool, position: EditorPosition) -> Option<usize> {
    let shift = if position.line == 0 {
        hidden(source, from_disk)
    } else {
        0
    };
    source.byte_at_editor_position(EditorPosition {
        line: position.line,
        character: position.character.checked_add(shift)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(text: &str) -> SourceText {
        SourceText::new(text.to_owned())
    }

    #[test]
    fn a_disk_mark_is_not_counted_on_line_zero() {
        let text = source("\u{feff}ab\ncd");
        let disk = position_at(&text, true, 3 + 1).unwrap();
        assert_eq!((disk.line, disk.character), (0, 1));
        let buffer = position_at(&text, false, 3 + 1).unwrap();
        assert_eq!((buffer.line, buffer.character), (0, 2));
        let later = position_at(&text, true, 3 + 3 + 1).unwrap();
        assert_eq!((later.line, later.character), (1, 1));
    }

    #[test]
    fn an_offset_inside_the_mark_has_no_position() {
        let text = source("\u{feff}ab");
        assert_eq!(position_at(&text, true, 0), None);
        assert_eq!(position_at(&text, true, 1), None);
        assert!(position_at(&text, true, 3).is_some());
        assert!(position_at(&text, false, 0).is_some());
    }

    #[test]
    fn a_source_without_a_mark_is_unchanged() {
        let text = source("ab");
        let point = position_at(&text, true, 1).unwrap();
        assert_eq!(point.character, 1);
    }

    #[test]
    fn byte_at_adds_the_mark_back_on_line_zero() {
        let text = source("\u{feff}ab");
        let at = |character| byte_at(&text, true, EditorPosition { line: 0, character });
        assert_eq!(at(0), Some(3));
        assert_eq!(at(1), Some(4));
        assert_eq!(at(3), None);
    }
}
