import { compileSemanticWorld, type SemanticCompilation } from "./compile.ts";
import type { SemanticEngineOptions } from "./engine.ts";
import { SIGIL_ONTOLOGY } from "./ontology.ts";
import {
  digest,
  parseSemanticWorld,
  resourceId,
  type SemanticFact,
  SemanticInputError,
  type SemanticWorld,
  worldFromFacts,
} from "./turtle.ts";

/** JSON is an API envelope; additions/retractions are ordinary Turtle facts. */
export interface TurtlePatch {
  readonly baseFingerprint: string;
  readonly additions: string;
  readonly retractions?: string;
}

export interface WorldCandidate {
  readonly id: string;
  readonly patch: TurtlePatch;
}

export interface EvaluatedCandidate {
  readonly id: string;
  readonly compilation: SemanticCompilation;
  readonly objective: readonly number[];
}

export interface DiscriminatingProposition {
  readonly fact: SemanticFact;
  readonly informationGainBits: number;
  readonly yes: readonly string[];
  readonly no: readonly string[];
  readonly question: string;
}

export interface WorldSearchResult {
  readonly status: "selected" | "ambiguous" | "rejected";
  readonly selected?: EvaluatedCandidate;
  readonly survivors: readonly EvaluatedCandidate[];
  readonly rejected: readonly {
    readonly id: string;
    readonly reason: string;
  }[];
  readonly proposition?: DiscriminatingProposition;
}

export interface SearchOptions extends SemanticEngineOptions {
  /** Only intent-authorized retractions may modify established facts. */
  readonly mutableFactIds?: readonly string[];
  readonly maxCandidates?: number;
}

export async function applyTurtlePatch(
  base: SemanticWorld,
  patch: TurtlePatch,
  sourceId: string,
  mutableFactIds: readonly string[] = [],
): Promise<SemanticWorld> {
  if (patch.baseFingerprint !== base.fingerprint) {
    throw new SemanticInputError(
      "STALE_WORLD",
      "Patch base fingerprint no longer matches the semantic world.",
    );
  }
  const additions = await parseSemanticWorld([{
    sourceId,
    turtle: patch.additions,
    producer: "model",
  }]);
  const retractions = await parseSemanticWorld([{
    sourceId: "retractions",
    turtle: patch.retractions ?? "",
  }]);
  const mutable = new Set(mutableFactIds);
  const retained = new Map(base.facts.map((fact) => [fact.id, fact]));
  const provenance = { ...base.provenance };
  for (const fact of retractions.facts) {
    if (!retained.has(fact.id)) {
      throw new SemanticInputError(
        "UNKNOWN_RETRACTION",
        `Cannot retract a fact absent from the base: ${fact.id}`,
      );
    }
    if (!mutable.has(fact.id)) {
      throw new SemanticInputError(
        "PROTECTED_FACT",
        `Candidate cannot remove established intent: ${fact.id}`,
      );
    }
    retained.delete(fact.id);
    delete provenance[fact.id];
  }
  for (const fact of additions.facts) {
    retained.set(fact.id, fact);
    provenance[fact.id] = [
      ...new Set([
        ...(provenance[fact.id] ?? []),
        ...(additions.provenance[fact.id] ?? []),
      ]),
    ].sort();
  }
  return worldFromFacts([...retained.values()], provenance);
}

function objective(
  compilation: SemanticCompilation,
  base: SemanticWorld,
  rankingObligations: ReadonlySet<string>,
): readonly number[] {
  const { world, closure } = compilation;
  const baseEntities = new Set(base.facts.map((f) => resourceId(f.subject)));
  const entities = new Set(world.facts.map((f) => resourceId(f.subject)));
  const satisfied = new Set(
    closure.tables.satisfied.filter((row) =>
      rankingObligations.has(String(row[0]))
    ).map((row) => row[0]),
  ).size;
  const assumptions =
    world.facts.filter((f) =>
      f.predicate === SIGIL_ONTOLOGY + "assumed" && f.object.value === "true"
    ).length;
  const dependencies =
    world.facts.filter((f) =>
      ["dependsOn", "delegates"].some((p) => f.predicate === SIGIL_ONTOLOGY + p)
    ).length;
  return [
    -satisfied,
    closure.tables.unresolved.length,
    assumptions,
    entities.size,
    [...entities].filter((e) => !baseEntities.has(e)).length,
    dependencies,
  ];
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function meaningfulFacts(world: SemanticWorld): readonly SemanticFact[] {
  return world.facts.filter((f) =>
    !["label", "description"].some((p) => f.predicate === SIGIL_ONTOLOGY + p)
  );
}

export function discriminateWorlds(
  candidates: readonly EvaluatedCandidate[],
): DiscriminatingProposition | undefined {
  const facts = new Map<string, SemanticFact>();
  const membership = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const fact of meaningfulFacts(candidate.compilation.world)) {
      facts.set(fact.id, fact);
      const members = membership.get(fact.id) ?? new Set<string>();
      members.add(candidate.id);
      membership.set(fact.id, members);
    }
  }
  const choices: DiscriminatingProposition[] = [];
  for (const [id, yesSet] of membership) {
    if (yesSet.size === candidates.length) continue;
    const fact = facts.get(id)!;
    const p = yesSet.size / candidates.length;
    const yes = [...yesSet].sort();
    const no = candidates.filter((c) => !yesSet.has(c.id)).map((c) => c.id)
      .sort();
    choices.push({
      fact,
      yes,
      no,
      informationGainBits: -p * Math.log2(p) - (1 - p) * Math.log2(1 - p),
      question: `Should ${resourceId(fact.subject)} ${
        fact.predicate.slice(SIGIL_ONTOLOGY.length)
      } ${fact.object.value}?`,
    });
  }
  return choices.sort((a, b) =>
    b.informationGainBits - a.informationGainBits ||
    a.fact.id.localeCompare(b.fact.id)
  )[0];
}

export async function searchSemanticWorlds(
  base: SemanticWorld,
  proposals: readonly WorldCandidate[],
  options: SearchOptions = {},
): Promise<WorldSearchResult> {
  const maxCandidates = options.maxCandidates ?? 8;
  if (
    !Number.isSafeInteger(maxCandidates) || maxCandidates < 1 ||
    proposals.length < 1 || proposals.length > maxCandidates
  ) {
    throw new SemanticInputError(
      "CANDIDATE_LIMIT",
      `Expected between 1 and ${maxCandidates} candidates.`,
    );
  }
  if (new Set(proposals.map((p) => p.id)).size !== proposals.length) {
    throw new SemanticInputError(
      "DUPLICATE_CANDIDATE",
      "Candidate identifiers must be unique.",
    );
  }
  const viable: EvaluatedCandidate[] = [];
  const rejected: { id: string; reason: string }[] = [];
  // Candidates may add requirements, but cannot earn quality credit merely by
  // inventing easy ones. The established intent defines the ranking domain.
  const baseCompilation = await compileSemanticWorld(base, options);
  const rankingObligations = new Set(
    baseCompilation.closure.tables.obligation.map((row) => String(row[0])),
  );
  for (const proposal of proposals) {
    options.signal?.throwIfAborted();
    try {
      const world = await applyTurtlePatch(
        base,
        proposal.patch,
        `candidate:${base.fingerprint}`,
        options.mutableFactIds,
      );
      const compilation = await compileSemanticWorld(world, options);
      if (compilation.status === "red") {
        rejected.push({
          id: proposal.id,
          reason: compilation.diagnostics.map((d) => d.message).join("\n"),
        });
      } else {viable.push({
          id: proposal.id,
          compilation,
          objective: objective(compilation, base, rankingObligations),
        });}
    } catch (error) {
      if (!(error instanceof SemanticInputError)) throw error;
      rejected.push({
        id: proposal.id,
        reason: `${error.code}: ${error.message}`,
      });
    }
  }
  viable.sort((a, b) =>
    compare(a.objective, b.objective) || a.id.localeCompare(b.id)
  );
  const best = viable[0];
  if (!best) return { status: "rejected", survivors: [], rejected };
  const survivors: EvaluatedCandidate[] = [];
  const identities = new Set<string>();
  for (const candidate of viable) {
    if (compare(candidate.objective, best.objective) !== 0) {
      rejected.push({
        id: candidate.id,
        reason: "Deterministically dominated by the lexicographic objective.",
      });
      continue;
    }
    const meaning = await digest(
      meaningfulFacts(candidate.compilation.world).map((f) => f.id).sort().join(
        "\n",
      ),
    );
    if (!identities.has(meaning)) {
      identities.add(meaning);
      survivors.push(candidate);
    }
  }
  if (survivors.length === 1) {
    return { status: "selected", selected: survivors[0], survivors, rejected };
  }
  return {
    status: "ambiguous",
    survivors,
    rejected,
    proposition: discriminateWorlds(survivors),
  };
}

/** Keep all surviving hypotheses until intent answers distinguish them. */
export function answerProposition(
  search: WorldSearchResult,
  answer: boolean,
): readonly EvaluatedCandidate[] {
  if (!search.proposition) {
    throw new SemanticInputError(
      "NO_PROPOSITION",
      "There is no unresolved discriminating proposition.",
    );
  }
  const accepted = new Set(
    answer ? search.proposition.yes : search.proposition.no,
  );
  return search.survivors.filter((candidate) => accepted.has(candidate.id));
}
