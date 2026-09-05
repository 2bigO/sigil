import { executeSemanticEngine, type SemanticEngineOptions } from "./engine.ts";
import {
  type RdfTerm,
  SemanticInputError,
  type SemanticWorld,
  worldFromAssertionTerms,
} from "./turtle.ts";

function quote(value: string): string {
  // Match egglog's four string escapes; its parser also accepts raw control chars.
  return '"' +
    value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll(
      "\n",
      "\\n",
    ).replaceAll("\t", "\\t") + '"';
}

/** Canonical assertions only. The compiler owns the table declarations and laws. */
export function serializeEggWorld(world: SemanticWorld): string {
  const rows = [...world.facts].sort((a, b) => a.id.localeCompare(b.id)).map(
    (fact) => {
      if (fact.subject.kind !== "iri" || fact.object.kind === "blank") {
        throw new SemanticInputError(
          "INVALID_ASSERTION_TERM",
          "Normalize anonymous resources before persisting a world.",
        );
      }
      const object = fact.object;
      const args = [fact.subject.value, fact.predicate, object.value];
      if (object.kind === "literal") {
        args.push(object.datatype ?? "", object.language ?? "");
      }
      return `(${object.kind === "iri" ? "assert-iri" : "assert-literal"} ${
        args.map(quote).join(" ")
      })`;
    },
  );
  return "; Sigil world assertions v1. Declarations and rules are compiler-owned.\n" +
    rows.join("\n") + (rows.length ? "\n" : "");
}

export async function parseEggWorld(
  source: string,
  options: SemanticEngineOptions = {},
): Promise<SemanticWorld> {
  const response: unknown = JSON.parse(
    await executeSemanticEngine({ version: 1, assertions: source }, options),
  );
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Invalid native assertion response.");
  }
  const value = response as Record<string, unknown>;
  if (
    value.version !== 1 ||
    Object.keys(value).some((key) =>
      !["version", "assertions"].includes(key)
    ) || !Array.isArray(value.assertions)
  ) throw new Error("Invalid native assertion tables.");
  const assertions: { subject: RdfTerm; predicate: string; object: RdfTerm }[] =
    [];
  for (const row of value.assertions) {
    if (
      !Array.isArray(row) || row.some((cell) => typeof cell !== "string") ||
      !(row[0] === "assert-iri" && row.length === 4 ||
        row[0] === "assert-literal" && row.length === 6)
    ) throw new Error("Invalid native assertion row.");
    assertions.push({
      subject: { kind: "iri", value: row[1] },
      predicate: row[2],
      object: row[0] === "assert-iri" ? { kind: "iri", value: row[3] } : {
        kind: "literal",
        value: row[3],
        datatype: row[4],
        language: row[5],
      },
    });
  }
  return worldFromAssertionTerms(assertions, "canonical-egg-world");
}
