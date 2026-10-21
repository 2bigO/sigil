import assert from "node:assert/strict";
import test from "node:test";
import { nativeLocationRange, sourceDigest } from "../../src/coordinates.ts";

function byteRange(
  bytes: Buffer,
  visible: string,
  start: number,
  end: number,
) {
  return nativeLocationRange(
    {
      side: "design",
      source: "a.sigil",
      coordinate_system: "utf8-bytes",
      source_digest: sourceDigest(bytes),
      range: { start, end },
    },
    bytes,
    visible,
  );
}

/** What the editor shows between two positions of its normalized text. */
function selected(
  visible: string,
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  },
): string {
  const lines = visible.split("\n");
  assert.equal(range.start.line, range.end.line);
  return lines[range.start.line].slice(
    range.start.character,
    range.end.character,
  );
}

test("native byte ranges select the same visible Unicode text under every line ending", () => {
  for (const ending of ["\n", "\r\n", "\r"]) {
    for (const bom of ["", "﻿"]) {
      const raw =
        `${bom}component Café {${ending}😀 *café results* 空${ending}}`;
      const bytes = Buffer.from(raw);
      const visible = raw.replace(/^﻿/, "").replace(/\r\n|\r/g, "\n");
      for (const needle of ["Café", "café results", "空", "😀"]) {
        const start = Buffer.byteLength(raw.slice(0, raw.indexOf(needle)));
        const mapped = byteRange(
          bytes,
          visible,
          start,
          start + Buffer.byteLength(needle),
        )!;
        assert.equal(selected(visible, mapped), needle, JSON.stringify(raw));
      }
    }
  }
});

test("the columns of a range count UTF-16 units after a multibyte and an astral character", () => {
  const raw = "é空😀x";
  const bytes = Buffer.from(raw);
  const start = Buffer.byteLength("é空😀");
  assert.deepEqual(byteRange(bytes, raw, start, start + 1), {
    start: { line: 0, character: 4 },
    end: { line: 0, character: 5 },
  });
});

test("a hidden disk BOM shifts the first line only and cannot be selected", () => {
  const raw = "﻿ab\ncd";
  const bytes = Buffer.from(raw);
  const visible = "ab\ncd";
  const bom = 3;
  assert.deepEqual(byteRange(bytes, visible, bom, bom + 2), {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 2 },
  });
  assert.deepEqual(byteRange(bytes, visible, bom + 3, bom + 5), {
    start: { line: 1, character: 0 },
    end: { line: 1, character: 2 },
  });
  assert.throws(() => byteRange(bytes, visible, 0, bom + 1), /Invalid source/);
  assert.throws(() => byteRange(bytes, visible, 1, bom + 1), /Invalid source/);
});

test("a range that splits a code point or ends past the text has no position", () => {
  const bytes = Buffer.from("😀 example");
  assert.throws(
    () => byteRange(bytes, bytes.toString(), 1, 4),
    /Invalid source range/,
  );
  assert.throws(
    () => byteRange(bytes, bytes.toString(), 0, bytes.length + 1),
    /Invalid source range/,
  );
});

test("a range cannot sit inside a CRLF line ending", () => {
  const bytes = Buffer.from("ab\r\ncd");
  assert.throws(
    () => byteRange(bytes, "ab\ncd", 3, 4),
    /Invalid source range/,
  );
});

test("location projection rejects stale bytes, dirty text and invalid UTF-8", () => {
  const bytes = Buffer.from("😀 example");
  const location = {
    side: "design",
    source: "a.sigil",
    coordinate_system: "utf8-bytes",
    source_digest: sourceDigest(bytes),
    range: { start: 0, end: 4 },
  } as const;
  assert.throws(
    () => nativeLocationRange(location, Buffer.from("changed"), "changed"),
    /Stale/,
  );
  assert.throws(
    () => nativeLocationRange(location, bytes, "😀 edited"),
    /does not match/,
  );
  const invalid = new Uint8Array([0xff]);
  assert.throws(
    () =>
      nativeLocationRange(
        { ...location, source_digest: sourceDigest(invalid) },
        invalid,
        "�",
      ),
    /does not match/,
  );
});

test("an unpaired surrogate in the editor text does not match", () => {
  const bytes = Buffer.from("ab");
  assert.throws(
    () =>
      nativeLocationRange(
        {
          side: "design",
          source: "a.sigil",
          coordinate_system: "utf8-bytes",
          source_digest: sourceDigest(bytes),
          range: { start: 0, end: 1 },
        },
        bytes,
        "a\ud800",
      ),
    /does not match/,
  );
});

test("a location with no range maps to nothing", () => {
  const bytes = Buffer.from("ab");
  assert.equal(
    nativeLocationRange(
      {
        side: "design",
        source: "a.sigil",
        coordinate_system: "utf8-bytes",
        source_digest: sourceDigest(bytes),
      },
      bytes,
      "ab",
    ),
    undefined,
  );
});

test("implementation coordinates remain explicitly one-based UTF-16 lines", () => {
  const bytes = Buffer.from("😀 value\r\nnext");
  const range = nativeLocationRange(
    {
      side: "implementation",
      source: "a.ts",
      coordinate_system: "utf16-lines",
      source_digest: sourceDigest(bytes),
      implementation_range: {
        start: { line: 1, column: 4 },
        end: { line: 1, column: 9 },
      },
    },
    bytes,
    "😀 value\nnext",
  );
  assert.deepEqual(range, {
    start: { line: 0, character: 3 },
    end: { line: 0, character: 8 },
  });
});

test("an implementation range and the equal byte range agree", () => {
  const raw = "﻿éé value\nnext";
  const bytes = Buffer.from(raw);
  const visible = raw.slice(1);
  const byBytes = byteRange(
    bytes,
    visible,
    3 + Buffer.byteLength("éé "),
    3 + Buffer.byteLength("éé value"),
  );
  const byLines = nativeLocationRange(
    {
      side: "implementation",
      source: "a.ts",
      coordinate_system: "utf16-lines",
      source_digest: sourceDigest(bytes),
      implementation_range: {
        start: { line: 1, column: 4 + 1 },
        end: { line: 1, column: 9 + 1 },
      },
    },
    bytes,
    visible,
  );
  assert.deepEqual(byLines, byBytes);
});
