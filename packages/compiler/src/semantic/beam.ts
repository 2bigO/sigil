import type { SemanticEngineOptions } from "./engine.ts";
import {
  answerProposition,
  discriminateWorlds,
  searchSemanticWorlds,
  type TurtlePatch,
  type WorldSearchResult,
} from "./search.ts";
import {
  parseSemanticWorld,
  SemanticInputError,
  type SemanticWorld,
  serializeSemanticWorld,
  worldFromFacts,
} from "./turtle.ts";

/** Persist asserted hypotheses and intent answers. Recompute every conclusion. */
export interface WorldBeamCheckpoint {
  readonly version: 1;
  readonly kernelVersion: "1";
  readonly base: { readonly fingerprint: string; readonly turtle: string };
  readonly candidates: readonly {
    readonly id: string;
    readonly patch: TurtlePatch;
  }[];
  readonly mutableFactIds: readonly string[];
  readonly answers: readonly {
    readonly factId: string;
    readonly value: boolean;
  }[];
}

export async function patchBetweenWorlds(
  base: SemanticWorld,
  next: SemanticWorld,
): Promise<TurtlePatch> {
  const before = new Set(base.facts.map((f) => f.id));
  const after = new Set(next.facts.map((f) => f.id));
  return {
    baseFingerprint: base.fingerprint,
    additions: serializeSemanticWorld(
      await worldFromFacts(
        next.facts.filter((f) => !before.has(f.id)),
        next.provenance,
      ),
    ),
    retractions: serializeSemanticWorld(
      await worldFromFacts(
        base.facts.filter((f) => !after.has(f.id)),
        base.provenance,
      ),
    ),
  };
}

export async function checkpointWorldBeam(
  base: SemanticWorld,
  result: WorldSearchResult,
  mutableFactIds: readonly string[] = [],
  answers: WorldBeamCheckpoint["answers"] = [],
): Promise<WorldBeamCheckpoint> {
  return {
    version: 1,
    kernelVersion: "1",
    base: {
      fingerprint: base.fingerprint,
      turtle: serializeSemanticWorld(base),
    },
    candidates: await Promise.all(
      result.survivors.map(async (candidate) => ({
        id: candidate.id,
        patch: await patchBetweenWorlds(base, candidate.compilation.world),
      })),
    ),
    mutableFactIds,
    answers,
  };
}

export function selectWorldBeamAnswer(
  result: WorldSearchResult,
  answer: boolean,
): WorldSearchResult {
  const survivors = answerProposition(result, answer);
  if (survivors.length === 1) {
    return {
      status: "selected",
      selected: survivors[0],
      survivors,
      rejected: result.rejected,
    };
  }
  return {
    status: "ambiguous",
    survivors,
    rejected: result.rejected,
    proposition: discriminateWorlds(survivors),
  };
}

/** Validate checkpoint transport before reading any cached hypothesis. */
export function validateWorldBeam(
  value: unknown,
): asserts value is WorldBeamCheckpoint {
  const object = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === "object" && !Array.isArray(x);
  const fingerprint = (x: unknown): x is string =>
    typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
  const factId = (x: unknown): x is string =>
    typeof x === "string" && /^fact:[a-f0-9]{64}$/.test(x);
  const invalid = () => {
    throw new SemanticInputError(
      "INVALID_BEAM",
      "Malformed semantic world beam checkpoint.",
    );
  };
  if (
    !object(value) || value.version !== 1 || value.kernelVersion !== "1" ||
    !object(value.base) ||
    !fingerprint(value.base.fingerprint) ||
    typeof value.base.turtle !== "string" ||
    !Array.isArray(value.candidates) || value.candidates.length < 1 ||
    value.candidates.length > 8 ||
    !Array.isArray(value.mutableFactIds) ||
    value.mutableFactIds.some((id) => !factId(id)) ||
    !Array.isArray(value.answers) || value.answers.length > 1000 ||
    Object.keys(value).some((key) =>
      ![
        "version",
        "kernelVersion",
        "base",
        "candidates",
        "mutableFactIds",
        "answers",
      ].includes(key)
    )
  ) return invalid();
  if (JSON.stringify(value).length > 16 * 1024 * 1024) return invalid();
  const names = new Set<string>();
  for (const candidate of value.candidates) {
    if (
      !object(candidate) || typeof candidate.id !== "string" ||
      !candidate.id.trim() || candidate.id.length > 128 ||
      names.has(candidate.id) ||
      !object(candidate.patch) ||
      candidate.patch.baseFingerprint !== value.base.fingerprint ||
      typeof candidate.patch.additions !== "string" ||
      (candidate.patch.retractions !== undefined &&
        typeof candidate.patch.retractions !== "string")
    ) return invalid();
    names.add(candidate.id);
  }
  const answers = new Map<string, boolean>();
  for (const answer of value.answers) {
    if (
      !object(answer) || !factId(answer.factId) ||
      typeof answer.value !== "boolean" ||
      (answers.has(answer.factId) &&
        answers.get(answer.factId) !== answer.value)
    ) return invalid();
    answers.set(answer.factId, answer.value);
  }
}

export async function resumeWorldBeam(
  checkpoint: WorldBeamCheckpoint,
  options: SemanticEngineOptions = {},
): Promise<WorldSearchResult> {
  validateWorldBeam(checkpoint);
  const base = await parseSemanticWorld([{
    sourceId: "beam-base",
    turtle: checkpoint.base.turtle,
  }]);
  if (base.fingerprint !== checkpoint.base.fingerprint) {
    throw new SemanticInputError(
      "INVALID_BEAM",
      "Semantic world beam base fingerprint does not match its Turtle.",
    );
  }
  if (
    checkpoint.mutableFactIds.some((id) =>
      !base.facts.some((fact) => fact.id === id)
    )
  ) {
    throw new SemanticInputError(
      "INVALID_BEAM",
      "A mutable fact is absent from the beam base.",
    );
  }
  let result = await searchSemanticWorlds(base, checkpoint.candidates, {
    ...options,
    mutableFactIds: checkpoint.mutableFactIds,
  });
  for (const answer of checkpoint.answers) {
    if (
      !result.survivors.some((candidate) =>
        candidate.compilation.world.facts.some((fact) =>
          fact.id === answer.factId
        )
      )
    ) {
      throw new SemanticInputError(
        "INVALID_BEAM",
        "An intent answer references a proposition absent from the surviving worlds.",
      );
    }
    const survivors = result.survivors.filter((c) =>
      c.compilation.world.facts.some((f) => f.id === answer.factId) ===
        answer.value
    );
    if (!survivors.length) {
      return {
        status: "rejected",
        survivors: [],
        rejected: [
          ...result.rejected,
          ...result.survivors.map((c) => ({
            id: c.id,
            reason: "Incompatible with the recorded intent answer.",
          })),
        ],
      };
    }
    result = survivors.length === 1
      ? {
        status: "selected",
        selected: survivors[0],
        survivors,
        rejected: result.rejected,
      }
      : {
        status: "ambiguous",
        survivors,
        rejected: result.rejected,
        proposition: discriminateWorlds(survivors),
      };
  }
  return result;
}
