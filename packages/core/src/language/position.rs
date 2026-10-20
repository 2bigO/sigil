//! Positions over one captured source: UTF-8 byte offsets (the language's source
//! range), UTF-16 editor positions, and the line and column of the cli's text
//! output. An offset inside a character, or inside a line ending, has none.
use super::{text::SourceText, workspace::Workspace};
use crate::types::{Diagnostic, Range};

/// A line from 0 and a column in UTF-16 units from 0, as editors count.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct EditorPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorRange {
    pub start: EditorPosition,
    pub end: EditorPosition,
}

/// A line and a column in Unicode characters, both from 1, as the cli prints.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SourceLocation {
    pub line: u32,
    pub column: u32,
}

impl SourceText {
    /// The index of the line that holds `offset` before its line ending, when
    /// `offset` is a character boundary.
    fn line_index_of(&self, offset: usize) -> Option<usize> {
        if offset > self.text.len() || !self.text.is_char_boundary(offset) {
            return None;
        }
        let index = self
            .lines
            .partition_point(|line| line.start <= offset)
            .checked_sub(1)?;
        (offset <= self.lines[index].content_end).then_some(index)
    }

    fn line_content(&self, index: usize) -> &str {
        let line = &self.lines[index];
        &self.text[line.start..line.content_end]
    }

    pub fn editor_position_at(&self, offset: usize) -> Option<EditorPosition> {
        let index = self.line_index_of(offset)?;
        let start = self.lines[index].start;
        Some(EditorPosition {
            line: index as u32,
            character: self.text[start..offset].encode_utf16().count() as u32,
        })
    }

    pub fn byte_at_editor_position(&self, position: EditorPosition) -> Option<usize> {
        let index = position.line as usize;
        if index >= self.lines.len() {
            return None;
        }
        let start = self.lines[index].start;
        let mut units = 0u32;
        let mut offset = start;
        for character in self.line_content(index).chars() {
            if units == position.character {
                return Some(offset);
            }
            units += character.len_utf16() as u32;
            offset += character.len_utf8();
        }
        (units == position.character).then_some(offset)
    }

    pub fn editor_range(&self, range: &Range) -> Option<EditorRange> {
        Some(EditorRange {
            start: self.editor_position_at(range.start)?,
            end: self.editor_position_at(range.end)?,
        })
    }

    pub fn location_at_byte(&self, offset: usize) -> Option<SourceLocation> {
        let index = self.line_index_of(offset)?;
        let start = self.lines[index].start;
        Some(SourceLocation {
            line: index as u32 + 1,
            column: self.text[start..offset].chars().count() as u32 + 1,
        })
    }

    pub fn byte_at_location(&self, location: SourceLocation) -> Option<usize> {
        let index = (location.line as usize).checked_sub(1)?;
        let column = (location.column as usize).checked_sub(1)?;
        if index >= self.lines.len() {
            return None;
        }
        let content = self.line_content(index);
        let start = self.lines[index].start;
        let mut chars = content.char_indices();
        match chars.nth(column) {
            Some((offset, _)) => Some(start + offset),
            None => (column == content.chars().count()).then_some(start + content.len()),
        }
    }
}

impl Workspace {
    /// The editor range of a diagnostic's source range, from the line table of
    /// the source it names. None when it has no range, no readable source, or a
    /// range that is not on character boundaries.
    pub fn editor_range(&self, diagnostic: &Diagnostic) -> Option<EditorRange> {
        let path = diagnostic.file_path.as_deref()?;
        let range = diagnostic.range.as_ref()?;
        self.sources
            .iter()
            .find(|file| file.path == path)?
            .capture
            .source
            .as_ref()?
            .editor_range(range)
    }
}
