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

export async function resumeWorldBeam(
  checkpoint: WorldBeamCheckpoint,
  options: SemanticEngineOptions = {},
): Promise<WorldSearchResult> {
  if (
    checkpoint.version !== 1 || checkpoint.kernelVersion !== "1" ||
    !checkpoint.candidates.length
  ) {
    throw new SemanticInputError(
      "INVALID_BEAM",
      "Unsupported or empty semantic world beam.",
    );
  }
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
  let result = await searchSemanticWorlds(base, checkpoint.candidates, {
    ...options,
    mutableFactIds: checkpoint.mutableFactIds,
  });
  for (const answer of checkpoint.answers) {
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
