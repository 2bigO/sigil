/**
 * What the evaluation benchmark asks of an orchestrator: the prompt, the pass
 * layout, the child it may start and the states it may hand back. The shared
 * launcher (`scripts/agent-runner/launch.ts`) runs the host.
 */
import type { AgentName, AgentRunResult } from "../agent-runner/agents.ts";
import type { ChildAgentDefinition } from "../agent-runner/hosts.ts";
import { launchAgent } from "../agent-runner/launch.ts";

export type {
  AgentName,
  AgentRunResult,
  AgentStatus,
  ChildObservation,
  EffortVerification,
  ModelVerification,
} from "../agent-runner/agents.ts";

/** Shell programs the orchestrator may run on Claude Code; what the skill needs. */
export const ORCHESTRATOR_SHELL = [
  "sigilc",
  "mkdir",
  "cp",
  "mv",
  "ls",
  "cat",
  "test",
  "cmp",
] as const;

/** The one child every host is told to start: a fresh interpreter. */
export const INTERPRETER_CHILD: ChildAgentDefinition = {
  name: "interpreter",
  description: "Fresh interpreter child",
  prompt:
    "You are a fresh interpreter child. Do exactly the task you are handed: read only the files it names, write your answer to the file it names, and write nothing else.",
  claudeTools: ["Read", "Glob", "Grep", "Write"],
  piTools: ["read", "write", "grep", "find", "ls"],
};

/** Where each part of a pass lives, relative to the pass directory. */
export const PASS_LAYOUT = {
  skill: "skills/sigil-compute-design/SKILL.md",
  root: "root",
  store: "store",
  run: "run",
  bin: "bin",
} as const;

export interface AgentRunRequest {
  readonly action?: "design" | "implementation";
  readonly agent: AgentName;
  readonly requestedModel: string;
  /**
   * Reasoning effort for the orchestrator and every child (codex: low..xhigh).
   * Absent: each host's own default applies and no child effort is checked.
   */
  readonly reasoning?: string;
  /** The prepared pass directory. It is the orchestrator's working directory. */
  readonly passDir: string;
  /** The directory the pinned `sigilc` is put on PATH from. */
  readonly binDir: string;
  /** Attempt-specific retained directory outside the pass directory. */
  readonly evidenceDir: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Overrides PATH lookup, useful for a pinned executable or a fake host. */
  readonly executable?: string;
  /** Codex: the auth file copied into the scratch CODEX_HOME for the run. */
  readonly codexAuthPath?: string;
  /** Pi: the pi-subagents extension entry loaded with `-e`. */
  readonly piSubagentsEntry?: string;
}

export interface OrchestratorPromptInput {
  readonly action?: "design" | "implementation";
  /** How the host starts a child; from the host's launch settings. */
  readonly spawnInstruction: string;
  readonly model: string;
  readonly effort: string | null;
}

/** The states an orchestrator may hand back; `failed` means it stopped on a failure. */
export const HANDBACK_STATES = [
  "coherent",
  "loose",
  "disjoint",
  "incomplete",
  "failed",
  "closed",
  "converged",
  "drift",
] as const;
export type HandbackState = typeof HANDBACK_STATES[number];

/**
 * The orchestrator prompt. The child instructions (return nothing for context
 * rows, write the answer to a file) live in the sigil-compute-design skill's handoff,
 * not here: this names the staged skill, where everything is, and what the
 * benchmark requires.
 */
export function orchestratorPrompt(input: OrchestratorPromptInput): string {
  const effort = input.effort
    ? `reasoning effort ${input.effort}`
    : "the host's default reasoning effort";
  const { root, store, run } = PASS_LAYOUT;
  const alignment = input.action === "implementation";
  const skillName = alignment ? "sigil-compute-align" : "sigil-compute-design";
  const skill = `skills/${skillName}/SKILL.md`;
  return [
    alignment
      ? "Run the sigil-compute-align skill end to end on this workspace, including its composed full-design action first."
      : "Run the sigil-compute-design skill's full-design action on the Sigil design in this directory, end to end.",
    "",
    `Read ${skill} first, then the orchestration contract it names, ${
      alignment
        ? "skills/sigil-compute-align/references/computed-alignment.md"
        : "skills/sigil-compute-design/references/computed-evaluation.md"
    }. Use only these staged copies: ${
      alignment ? "skills/sigil-compute-align, " : ""
    } skills/sigil-compute-design, skills/sigil-understand and skills/sigil-egglog sit beside each other here, and the reading children load the last two from there. Do not use a copy of any of these skills installed elsewhere on this machine.`,
    "",
    `- The workspace root is \`${root}\`. Pass \`--root ${root}\` to every sigilc command. The workspace has no stored readings, so the seed the skill takes from its store is empty.`,
    `- The private store is \`${store}\`, not a directory inside \`${run}\`: this replaces the contract's default location. It starts empty. Pass \`--store ${store}\` to every sigilc command, including the final check.`,
    `- Keep the run directory, preparations, seeds and every answer file under \`${run}\`. A child writes its answer to a file under \`${run}\` named \`<source>-answer-<round>.egg\`, which is plain egglog text with one claim row per line — never JSON. The child writes each row from reading the prose and never drops rows in bulk. You pass that exact file to ingest and never set an answer aside yourself: ingest decides.`,
    `- Run the tool as \`./bin/sigilc\` wherever the skill writes \`sigilc\`. A \`sigilc\` found elsewhere on this machine is a different version and must not be used. Never edit design, code or configuration. Proposed excludes are output only.`,
    "",
    `Every reading, including each re-ask, comes from a fresh child that inherits none of your conversation. ${input.spawnInstruction} Children run with model ${input.model} at ${effort}; the host is already set to that, so do not pass a model or effort override when starting a child. Never write, edit or repair rows yourself.`,
    "",
    "Do not read anything outside this directory except the tool and the files it names. There is no answer key to look for. Finish the whole action, including the write-back and the final check, then stop.",
    "",
    `Your final message must report the final check's state, its unread units and the findings it lists, and must end with exactly one line of the form \`Hand-back state: STATE\`, where STATE is ${
      alignment
        ? "closed, converged, drift or incomplete"
        : "coherent, loose, disjoint or incomplete"
    } (the check's state), or failed if you stopped on a failure.`,
    "",
  ].join("\n");
}

/** Read the state an orchestrator handed back from its final message. */
export function parseHandbackState(text: string): HandbackState | null {
  let state: HandbackState | null = null;
  for (
    const match of text.matchAll(
      /^[\s*_`>-]*Hand-back state:\s*[*_`]*\s*([A-Za-z]+)/gim,
    )
  ) {
    const word = match[1].toLowerCase();
    state = (HANDBACK_STATES as readonly string[]).includes(word)
      ? word as HandbackState
      : null;
  }
  return state;
}

/**
 * Launches one orchestrator process in its pass directory and retains its raw
 * evidence. The process runs the whole sigil-compute-design action; this function does
 * not read or judge what it produced.
 */
export async function runOrchestrator(
  request: AgentRunRequest,
): Promise<AgentRunResult> {
  const { action, ...launch } = request;
  const { handback: _handback, ...result } = await launchAgent({
    ...launch,
    prompt: (context) => orchestratorPrompt({ ...context, action }),
    allowedShell: ORCHESTRATOR_SHELL,
    children: [INTERPRETER_CHILD],
    parseHandback: parseHandbackState,
  });
  return result;
}
