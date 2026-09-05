/** Versioned Sigil vocabulary. Changing it is an explicit compiler change. */
export const SIGIL_ONTOLOGY = "https://sigil.dev/ontology/1#";
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const RDF_LANG_STRING =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";

export const SEMANTIC_CLASSES = [
  "Component",
  "Capability",
  "Artifact",
  "Boundary",
  "Actor",
  "System",
  "Goal",
  "Interface",
  "State",
  "Logic",
  "Constraint",
  "Decision",
  "Case",
  "Contract",
  "Proposition",
  "Dependency",
  "Implementation",
  "Evidence",
] as const;

export const SEMANTIC_PREDICATES = {
  owns: "entity",
  provides: "entity",
  requires: "entity",
  dependsOn: "entity",
  excludes: "entity",
  delegates: "entity",
  routesThrough: "entity",
  persistsAt: "entity",
  authorityFor: "entity",
  trusts: "entity",
  invokes: "entity",
  reads: "entity",
  writes: "entity",
  uses: "entity",
  implements: "entity",
  evidenceFor: "entity",
  covers: "entity",
  hasContract: "entity",
  from: "entity",
  to: "entity",
  target: "entity",
  initialState: "entity",
  transitionsTo: "entity",
  label: "text",
  description: "text",
  section: "text",
  relation: "text",
  required: "boolean",
  exclusive: "boolean",
  interpreted: "boolean",
  assumed: "boolean",
  expected: "boolean",
  passes: "boolean",
  cost: "number",
  latencyBudgetMs: "number",
  latencyMs: "number",
  risk: "number",
} as const;

export type SemanticPredicate = keyof typeof SEMANTIC_PREDICATES;

export function vocabularyPrompt(): string {
  return `Use ordinary RDF 1.1 Turtle with @prefix sigil: <${SIGIL_ONTOLOGY}> .\n` +
    `Classes: ${SEMANTIC_CLASSES.join(", ")}.\n` +
    `Properties: ${
      Object.entries(SEMANTIC_PREDICATES).map(([p, t]) => `${p} (${t})`).join(
        ", ",
      )
    }.\n` +
    "You may introduce instance identifiers, never predicates, classes, rules, derived conclusions, or quality scores. " +
    "Express materially different interpretations only when the intent permits consequential ambiguity. " +
    "Mark unsupported assumptions with assumed true. Evidence you propose is not mechanically established evidence.";
}
