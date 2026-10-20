import { createHash } from "node:crypto";
import type { NativeLocation } from "./compilation.ts";

type Position = { line: number; character: number };
export type EditorRange = { start: Position; end: Position };

interface Line {
  /** UTF-16 offset of the first character of the line. */
  start: number;
  /** UTF-16 offset where its content ends, before any line ending. */
  contentEnd: number;
}

/**
 * Decoded source text with the maps between UTF-8 byte offsets and UTF-16
 * positions. A line ends at LF, CRLF or a lone CR, as in the editor. A byte
 * offset inside a code point, or inside a line ending, has no position.
 */
class TextIndex {
  readonly lines: Line[] = [];
  readonly #byteToUtf16 = new Map<number, number>([[0, 0]]);
  readonly #utf16ToByte = new Map<number, number>([[0, 0]]);

  constructor(readonly text: string) {
    let byte = 0;
    let utf16 = 0;
    for (const character of text) {
      const point = character.codePointAt(0)!;
      byte += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
      utf16 += character.length;
      this.#byteToUtf16.set(byte, utf16);
      this.#utf16ToByte.set(utf16, byte);
    }
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const character = text[i];
      if (character !== "\r" && character !== "\n") continue;
      this.lines.push({ start, contentEnd: i });
      if (character === "\r" && text[i + 1] === "\n") i++;
      start = i + 1;
    }
    this.lines.push({ start, contentEnd: text.length });
  }

  utf16PositionAtByte(offset: number): Position | undefined {
    const utf16 = this.#byteToUtf16.get(offset);
    if (utf16 === undefined) return undefined;
    let low = 0;
    let high = this.lines.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.lines[middle].start <= utf16) low = middle;
      else high = middle - 1;
    }
    const line = this.lines[low];
    return utf16 <= line.contentEnd
      ? { line: low, character: utf16 - line.start }
      : undefined;
  }

  byteOffsetAtUtf16Position(position: Position): number | undefined {
    const line = this.lines[position.line];
    if (
      !line || !Number.isInteger(position.character) ||
      position.character < 0 ||
      position.character > line.contentEnd - line.start
    ) return undefined;
    return this.#utf16ToByte.get(line.start + position.character);
  }
}

/** The text of valid UTF-8 bytes with any BOM kept, or undefined. */
function decodeSource(bytes: Uint8Array): string | undefined {
  try {
    return noLoneSurrogate(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    );
  } catch {
    return undefined;
  }
}

function noLoneSurrogate(text: string): string | undefined {
  return /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
      .test(text)
    ? undefined
    : text;
}

export function sourceDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Verify both the captured bytes and the editor's only permitted normalizations:
 * a hidden disk BOM and line endings the editor normalizes.
 */
export function nativeLocationRange(
  location: NativeLocation,
  bytes: Uint8Array,
  visibleText: string,
): EditorRange | undefined {
  if (!location.range && !location.implementation_range) return undefined;
  if (
    !location.source_digest || sourceDigest(bytes) !== location.source_digest
  ) {
    throw new Error(`Stale source: ${location.source}; compile again.`);
  }
  const rawText = decodeSource(bytes);
  const visible = noLoneSurrogate(visibleText);
  const normalize = (text: string) => text.replace(/\r\n|\r/g, "\n");
  if (
    rawText === undefined || visible === undefined ||
    normalize(rawText.replace(/^\uFEFF/, "")) !== normalize(visible)
  ) {
    throw new Error(
      `Source does not match the editor: ${location.source}; compile again.`,
    );
  }
  const raw = new TextIndex(rawText);
  const shown = new TextIndex(visible);
  // VS Code hides a disk BOM in its text model, so the first line shifts by it.
  const hiddenBom = rawText.startsWith("\uFEFF") ? 1 : 0;
  function editorPosition(offset: number): Position | undefined {
    const point = raw.utf16PositionAtByte(offset);
    if (!point || (point.line === 0 && point.character < hiddenBom)) {
      return undefined;
    }
    return {
      line: point.line,
      character: point.character - (point.line === 0 ? hiddenBom : 0),
    };
  }
  function implementationPoint(
    point: { line: number; column: number },
  ): Position | undefined {
    const offset = raw.byteOffsetAtUtf16Position({
      line: point.line - 1,
      character: point.column - 1,
    });
    return offset === undefined ? undefined : editorPosition(offset);
  }
  const range = location.coordinate_system === "utf8-bytes" && location.range
    ? {
      start: editorPosition(location.range.start),
      end: editorPosition(location.range.end),
    }
    : location.implementation_range
    ? {
      start: implementationPoint(location.implementation_range.start),
      end: implementationPoint(location.implementation_range.end),
    }
    : undefined;
  if (
    !range?.start || !range.end ||
    shown.byteOffsetAtUtf16Position(range.start) === undefined ||
    shown.byteOffsetAtUtf16Position(range.end) === undefined
  ) {
    throw new Error(`Invalid source range: ${location.source}.`);
  }
  return { start: range.start, end: range.end };
}
