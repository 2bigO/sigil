/**
 * What the writer stage asks of `sigil-write`: the staged layout, the prompt,
 * the two children it may start and the hand-back it must end with.
 * `stages.ts` stages the directory and launches the host.
 */
import type { ChildAgentDefinition } from "../agent-runner/hosts.ts";
import type { PromptContext } from "../agent-runner/launch.ts";
import { INTERPRETER_CHILD } from "../slotted-benchmark/agents.ts";

/** Every skill the writer gets, staged side by side under `skills/`. */
export const WRITER_SKILLS = [
  "sigil-write",
  "sigil-understand",
  "sigil-evaluate",
  "sigil-compute-design",
  "sigil-egglog",
] as const;

/** Where each part of the writer's staging directory lives, relative to it. */
export const WRITER_LAYOUT = {
  requirement: "requirement.md",
  skills: "skills",
  bin: "bin",
  design: "design",
  run: "run",
  store: "store",
} as const;

/** The directories the writer may write in; anything else makes it invalid. */
export const WRITABLE = [
  WRITER_LAYOUT.design,
  WRITER_LAYOUT.run,
  WRITER_LAYOUT.store,
] as const;

/** Shell programs the writer may run on Claude Code. */
export const WRITER_SHELL = [
  "sigil",
  "sigilc",
  "mkdir",
  "cp",
  "mv",
  "ls",
  "cat",
  "test",
  "cmp",
  "diff",
  "shasum",
  "sha256sum",
  "wc",
  "head",
  "tail",
] as const;

/** The read-only child for the delegated `sigil-evaluate` review. */
export const REVIEWER_CHILD: ChildAgentDefinition = {
  name: "reviewer",
  description: "Fresh read-only design reviewer",
  prompt:
    "You are a fresh, read-only Sigil design reviewer. Load the sigil-evaluate skill from the path your task names and review exactly the captured inputs it names. Read only those files and the skills beside sigil-evaluate. Write nothing: return your whole review report as your final message.",
  claudeTools: ["Read", "Glob", "Grep"],
  piTools: ["read", "grep", "find", "ls"],
};

/**
 * The writer's children: an interpreter for each claims reading of its review
 * preparation, and the reviewer.
 */
export const WRITER_CHILDREN: readonly ChildAgentDefinition[] = [
  INTERPRETER_CHILD,
  REVIEWER_CHILD,
];

const WRITER_STATES = ["written", "failed"] as const;
export type WriterState = typeof WRITER_STATES[number];
export type ReviewMark = "delegated" | "none";

export interface WriterHandback {
  readonly state: WriterState;
  readonly review: ReviewMark;
}

/**
 * The writer prompt. It names the staged layout and overrides the two parts of
 * `sigil-write` that assume a person or a wider workspace: asking the human,
 * and retrieving missing evidence. The skill's own loop, including its
 * delegated review, is otherwise left to the skill.
 */
export function writerPrompt(context: PromptContext): string {
  const { requirement, design, run, store } = WRITER_LAYOUT;
  const effort = context.effort
    ? `reasoning effort ${context.effort}`
    : "the host's default reasoning effort";
  return [
    `Use the sigil-write skill to author a new Sigil design for the requirement in \`${requirement}\`, end to end, including its delegated review.`,
    "",
    "Read skills/sigil-write/SKILL.md first and follow it. Use only the staged skills: sigil-write, sigil-understand, sigil-evaluate, sigil-compute-design and sigil-egglog sit beside each other under skills/, and the links between them resolve there. Do not use a copy of any of these skills installed elsewhere on this machine.",
    "",
    "This is an unattended run. No human is available, now or later, and nobody can answer a question before you finish.",
    "",
    `- \`${requirement}\` is the user's intent and the only evidence there is. Where the skill says to retrieve accessible missing evidence yourself, do not look for more: nothing else on this machine is evidence for this design. Name the missing evidence in your final message instead.`,
    "- Where the skill says to ask the human, preserve an undecided policy for the human, or return a question, do not wait for an answer. Keep the affected promises as the requirement states them, list the question in your final message, and carry on with every other part of the work.",
    "",
    "Where everything goes, relative to this directory:",
    "",
    `- \`${design}\` is the workspace root. Its \`.sigil/config.json\` is already there. Author every design file directly in \`${design}\`, and pass \`--root ${design}\` to every sigil and sigilc command.`,
    `- \`${run}\` is the run directory that the review preparation of sigil-compute-design keeps outside the design workspace. Keep every temporary file there: preparations, seeds, answer files, review captures, the review request and the reviewer's report.`,
    `- \`${store}\` is that preparation's private store. Pass \`--store ${store}\` to every sigilc command.`,
    "- `sigil` and `sigilc` on PATH are the staged copies in `bin/`. Use them for check, fmt and the claims loop. A copy found elsewhere on this machine is a different version and must not be used.",
    `- Write nothing outside \`${design}\`, \`${run}\` and \`${store}\`, including the system temp directory. Never change \`${requirement}\`, \`skills/\` or \`bin/\`.`,
    "",
    `Every child is fresh and inherits none of your conversation. ${context.spawnInstruction} Start an "interpreter" child for each claims reading the review preparation asks for, and a "reviewer" child for each delegated sigil-evaluate review. The reviewer is read-only: it returns its report as its final message, and you keep that report under \`${run}\`. Children run with model ${context.model} at ${effort}; the host is already set to that, so do not pass a model or effort override when starting a child.`,
    "",
    "Do not read anything outside this directory except the tools on PATH. There is no reference design or answer key to look for.",
    "",
    "Your final message must give what the skill returns on exit, and must end with exactly one line of the form `Hand-back: STATE, review REVIEW`, where STATE is `written` when a draft is in the workspace or `failed` when you stopped without one, and REVIEW is `delegated` when at least one fresh reviewer child returned a report on a draft of this design or `none` otherwise.",
    "",
  ].join("\n");
}

/** Read the writer's last hand-back line; null when it gave none. */
export function parseWriterHandback(text: string): WriterHandback | null {
  let found: WriterHandback | null = null;
  for (
    const match of text.matchAll(
      /^[\s*_`>-]*Hand-back:\s*[*_`]*\s*([A-Za-z]+)\s*[*_`]*\s*,\s*review\s+[*_`]*([A-Za-z]+)/gim,
    )
  ) {
    const state = match[1].toLowerCase();
    const review = match[2].toLowerCase();
    found = (WRITER_STATES as readonly string[]).includes(state) &&
        (review === "delegated" || review === "none")
      ? { state: state as WriterState, review }
      : null;
  }
  return found;
}
