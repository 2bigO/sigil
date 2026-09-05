import { RDF_TYPE, SIGIL_ONTOLOGY } from "./ontology.ts";
import { resourceId, type SemanticWorld, worldFromFacts } from "./turtle.ts";

/** Select assertion context; all semantic inference remains in egglog. */
export function scopeSemanticWorld(
  world: SemanticWorld,
  seeds: readonly string[],
): Promise<SemanticWorld> {
  const selected = new Set(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fact of world.facts) {
      if (fact.predicate === RDF_TYPE || fact.object.kind === "literal") {
        continue;
      }
      const subject = resourceId(fact.subject);
      const object = resourceId(fact.object);
      if (selected.has(subject) && !selected.has(object)) {
        selected.add(object);
        changed = true;
      }
      // Include contracts on selected subjects and competing explicit owners.
      if (
        ["from", "owns"].some((p) => fact.predicate === SIGIL_ONTOLOGY + p) &&
        selected.has(object) && !selected.has(subject)
      ) {
        selected.add(subject);
        changed = true;
      }
    }
  }
  return worldFromFacts(
    world.facts.filter((f) => selected.has(resourceId(f.subject))),
    world.provenance,
  );
}
