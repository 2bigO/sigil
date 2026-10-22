import { describe, expect, test } from "bun:test";
import {
  type CoverageContext,
  CoverageError,
  type CoverageFile,
  measureCoverage,
} from "./coverage.ts";
import { coverageFile } from "./testing.ts";

const list = {
  benchmark: "slotted",
  requirements: [
    { id: "R1", label: "first" },
    { id: "R22", label: "timezone lock" },
    { id: "AE1", label: "example" },
  ],
};
const ids = list.requirements.map((entry) => entry.id);
const context: CoverageContext = {
  benchmark: "slotted-with-split",
  list,
  listName: "slotted",
  listDigest: "list-digest",
  requirementFileDigest: "file-digest",
  facets: new Map([
    ["facet:aa", "Booking constraints 3"],
    ["facet:bb", "Rooms state 1"],
  ]),
};
const digests = {
  list: "list-digest",
  files: { "slotted-with-split": "file-digest" },
};

function rejection(file: CoverageFile): string {
  try {
    measureCoverage(file, "d", context);
  } catch (cause) {
    expect(cause).toBeInstanceOf(CoverageError);
    return (cause as Error).message;
  }
  throw new Error("the coverage file was accepted");
}

describe("measureCoverage", () => {
  test("rejects coverage taken by a different reader", () => {
    const file = coverageFile(ids, digests);
    expect(() =>
      measureCoverage(file, "d", {
        ...context,
        expectedReader: { ...file.reader, model: "new-reader" },
      })
    ).toThrow(/reader-model.*new-reader/);
  });

  test("counts answered, none and not-read in list order, with labels from the tree", () => {
    const file = coverageFile(ids, digests, {
      R22: [{ id: "facet:aa", label: "stale label" }],
    });
    const notRead = {
      ...file,
      entries: [
        ...file.entries.filter((entry) => entry.id !== "AE1"),
        {
          id: "AE1",
          verdict: "not-read" as const,
          facets: [],
          note: "timed out",
        },
      ].reverse(),
    };
    const measures = measureCoverage(notRead, "digest", context);
    expect(measures.answered).toBe(1);
    expect(measures.none).toBe(1);
    expect(measures.notRead).toBe(1);
    expect(measures.entries.map((entry) => entry.id)).toEqual(ids);
    expect(measures.entries[1]!.facets).toEqual([
      { id: "facet:aa", label: "Booking constraints 3" },
    ]);
    expect(measures.digest).toBe("digest");
  });

  test("rejects a cited Facet id that is not in the design's tree, naming it", () => {
    const message = rejection(coverageFile(ids, digests, {
      R1: [{ id: "facet:missing", label: "x" }],
    }));
    expect(message).toContain("facet:missing");
    expect(message).toContain("R1");
  });

  test("rejects a recorded requirement-list digest that differs, naming both", () => {
    const message = rejection(
      coverageFile(ids, { ...digests, list: "old-list-digest" }),
    );
    expect(message).toContain("old-list-digest");
    expect(message).toContain("list-digest");
  });

  test("rejects a recorded requirement-file digest that differs, naming both", () => {
    const message = rejection(
      coverageFile(ids, {
        ...digests,
        files: { "slotted-with-split": "old-file" },
      }),
    );
    expect(message).toContain("old-file");
    expect(message).toContain("file-digest");
  });

  test("rejects a reading not taken against this benchmark's requirement file", () => {
    expect(
      rejection(
        coverageFile(ids, {
          ...digests,
          files: { "slotted-without-split": "file-digest" },
        }),
      ),
    ).toContain("slotted-with-split");
  });

  test("rejects a missing, unknown or repeated requirement ID", () => {
    expect(rejection(coverageFile(["R1", "R22"], digests))).toContain("AE1");
    expect(rejection(coverageFile([...ids, "R99"], digests))).toContain("R99");
    expect(rejection(coverageFile([...ids, "R1"], digests))).toContain(
      "R1 twice",
    );
  });

  test("rejects an answer without Facets and Facets without an answer", () => {
    const base = coverageFile(ids, digests);
    expect(
      rejection({
        ...base,
        entries: base.entries.map((entry) =>
          entry.id === "R1" ? { ...entry, verdict: "answered" } : entry
        ),
      }),
    ).toContain("R1");
    expect(
      rejection({
        ...base,
        entries: base.entries.map((entry) =>
          entry.id === "R1"
            ? { ...entry, facets: [{ id: "facet:aa", label: "x" }] }
            : entry
        ),
      }),
    ).toContain("R1");
  });
});
