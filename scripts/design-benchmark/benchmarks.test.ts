import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const withSplit = read("./benchmarks/slotted-with-split/requirement.md");
const withoutSplit = read("./benchmarks/slotted-without-split/requirement.md");
const list = JSON.parse(read("./benchmarks/slotted/requirements.json")) as {
  benchmark: string;
  requirements: { id: string; label: string }[];
};

const MODULES = [
  "Identity",
  "Rooms",
  "Availability",
  "Booking",
  "Calendar",
  "SharedKernel",
];
const COMPONENTS = ["Slotted", ...MODULES];
const SPLIT_HEADING = "\n## Module split\n";

function splitSection(text: string): string {
  const at = text.indexOf(SPLIT_HEADING);
  if (at < 0) throw new Error("The with-split file has no module split");
  return text.slice(at);
}

describe("slotted-without-split (AE1)", () => {
  test("names no module", () => {
    for (const name of MODULES) {
      expect(withoutSplit).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  test("has no src/ path", () => {
    expect(withoutSplit).not.toContain("src/");
  });

  test("has no heading that equals a module name", () => {
    const headings = withoutSplit.split("\n")
      .filter((line) => /^#+ /.test(line))
      .map((line) => line.replace(/^#+ /, "").trim().toLowerCase());
    for (const name of COMPONENTS) {
      expect(headings).not.toContain(name.toLowerCase());
    }
  });
});

describe("slotted-with-split (AE1)", () => {
  const split = splitSection(withSplit);

  test("names all seven components", () => {
    for (const name of COMPONENTS) {
      expect(split).toMatch(new RegExp(`\\*\\*${name}\\*\\*`));
    }
  });

  test("states each allowed dependency", () => {
    for (
      const rule of [
        "Booking may depend on Availability and Rooms.",
        "Availability may depend on Rooms.",
        "Rooms may depend on Identity.",
        "Calendar may depend on Booking, Availability, and Rooms.",
        "Identity depends on no other module.",
        "Booking and Availability may use Identity's signed-in user.",
        "Any module may use SharedKernel.",
        "Slotted may use SharedKernel's domain error.",
        "there are no cycles.",
      ]
    ) {
      expect(split).toContain(rule);
    }
  });

  test("is the without-split text plus the split section and nothing else", () => {
    expect(withSplit.slice(0, withSplit.indexOf(SPLIT_HEADING))).toBe(
      withoutSplit,
    );
    expect(split.indexOf("\n## ", 1)).toBe(-1);
  });
});

describe("the shared requirement list (KTD14)", () => {
  const expected = [
    ...Array.from({ length: 28 }, (_, i) => `R${i + 1}`),
    ...Array.from({ length: 13 }, (_, i) => `AE${i + 1}`),
  ];

  test("lists exactly R1–R28 and AE1–AE13, each with a label", () => {
    expect(list.benchmark).toBe("slotted");
    expect(list.requirements.map((entry) => entry.id)).toEqual(expected);
    for (const entry of list.requirements) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
    }
  });

  test("every ID appears in both requirement files", () => {
    for (const id of expected) {
      const pattern = new RegExp(`(?<![A-Z0-9])${id}\\.`);
      expect({ id, found: pattern.test(withoutSplit) }).toEqual({
        id,
        found: true,
      });
      expect({ id, found: pattern.test(withSplit) }).toEqual({
        id,
        found: true,
      });
    }
  });
});

test("--help lists every command", () => {
  const result = spawnSync(process.execPath, ["run", "main.ts", "--help"], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  for (const command of ["run", "measure", "reread", "report"]) {
    expect(result.stdout).toMatch(new RegExp(`^  ${command} `, "m"));
  }
});
