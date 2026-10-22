import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { REPO_ROOT } from "./records.ts";
import {
  parseWriterHandback,
  REVIEWER_CHILD,
  reviewEvidenceCommand,
  WRITABLE,
  WRITER_CHILDREN,
  WRITER_SHELL,
  WRITER_SKILLS,
  writerPrompt,
} from "./writer.ts";

const PROMPT = writerPrompt({
  spawnInstruction: "SPAWN-INSTRUCTION",
  model: "writer-model",
  effort: "high",
});

test("the writer prompt says no human is available and the requirement file is the only evidence", () => {
  expect(PROMPT).toContain("No human is available");
  expect(PROMPT).toContain(
    "`requirement.md` is the user's intent and the only evidence",
  );
  // The two sigil-write instructions it overrides, by their own words.
  expect(PROMPT).toContain("retrieve accessible missing evidence yourself");
  expect(PROMPT).toContain("ask the human");
  expect(PROMPT).toContain("preserve an undecided policy for the human");
});

test("the writer prompt names the staged layout, the tools and the children", () => {
  for (
    const part of [
      "skills/sigil-write/SKILL.md",
      "`design` is the workspace root",
      "--root design",
      "`run` is the run directory",
      "`store` is that preparation's private store",
      "--store store",
      "`bin/`",
      "Write nothing outside `design`, `run` and `store`",
      "including the system temp directory",
      "SPAWN-INSTRUCTION",
      '"interpreter" child',
      '"reviewer" child',
      "model writer-model at reasoning effort high",
      "There is no reference design or answer key",
      "`Hand-back: STATE, review REVIEW`",
    ]
  ) {
    expect({ part, found: PROMPT.includes(part) }).toEqual({
      part,
      found: true,
    });
  }
  expect(WRITABLE).toEqual(["design", "run", "store"]);
});

test("the sigil-write wording the prompt overrides is still in the skill", async () => {
  const skill = await readFile(
    join(REPO_ROOT, "skills", "sigil-write", "SKILL.md"),
    "utf8",
  );
  const loop = await readFile(
    join(REPO_ROOT, "skills", "sigil-write", "references", "writing-loop.md"),
    "utf8",
  );
  expect(skill).toContain("Retrieve accessible missing evidence yourself");
  expect(skill).toContain("ask the human");
  expect(skill).toContain(
    "Preserve\nconsequential undecided policy for the human",
  );
  // The prompt puts this temporary storage and the run directory in run/.
  expect(loop).toContain("in temporary storage outside authored Sigil");
  const compute = await readFile(
    join(
      REPO_ROOT,
      "skills",
      "sigil-compute-design",
      "references",
      "computed-evaluation.md",
    ),
    "utf8",
  );
  expect(compute).toContain("unique run directory outside the design");
});

test("the hand-back line gives the state and whether a review was delegated", () => {
  expect(parseWriterHandback("All done.\nHand-back: written, review delegated"))
    .toEqual({ state: "written", review: "delegated" });
  expect(parseWriterHandback("**Hand-back:** written, review none")).toEqual({
    state: "written",
    review: "none",
  });
  expect(
    parseWriterHandback(
      "Hand-back: written, review delegated\nlater\n- Hand-back: failed, review none",
    ),
  ).toEqual({ state: "failed", review: "none" });
  expect(parseWriterHandback("Hand-back: written")).toBeNull();
  expect(parseWriterHandback("Hand-back: done, review delegated")).toBeNull();
  expect(parseWriterHandback("no hand-back here")).toBeNull();
});

test("the writer stages every skill sigil-write needs, and its children differ in what they may write", async () => {
  const compatibility = JSON.parse(
    await readFile(
      join(REPO_ROOT, "skills", "sigil-write", "compatibility.json"),
      "utf8",
    ),
  ) as { requiredSkills: string[] };
  for (const name of ["sigil-write", ...compatibility.requiredSkills]) {
    expect(WRITER_SKILLS as readonly string[]).toContain(name);
  }
  // sigil-compute-design's readings load sigil-egglog beside it.
  expect(WRITER_SKILLS as readonly string[]).toContain("sigil-egglog");
  expect(WRITER_CHILDREN.map((child) => child.name)).toEqual([
    "interpreter",
    "reviewer",
  ]);
  expect(WRITER_CHILDREN[0]!.claudeTools).toContain("Write");
  expect(REVIEWER_CHILD.claudeTools).not.toContain("Write");
  expect(REVIEWER_CHILD.piTools).not.toContain("write");
  expect(WRITER_SHELL as readonly string[]).toContain("sigil");
  expect(WRITER_SHELL as readonly string[]).toContain("sigilc");
});

test("the reviewer can verify exact evidence with scoped Bash and no write tools", () => {
  expect(REVIEWER_CHILD.claudeTools).toContain("Bash");
  expect(REVIEWER_CHILD.claudeHooks).toEqual({
    PreToolUse: [{
      matcher: "Bash",
      hooks: [{
        type: "command",
        command: `${reviewEvidenceCommand()} --guard`,
      }],
    }],
  });
  expect(REVIEWER_CHILD.piTools).toContain("review_evidence");
  expect(REVIEWER_CHILD.piTools).not.toContain("bash");
  expect(REVIEWER_CHILD.prompt).toContain("SHA-256");
  expect(REVIEWER_CHILD.prompt).toContain("UTF-8 byte");
});
