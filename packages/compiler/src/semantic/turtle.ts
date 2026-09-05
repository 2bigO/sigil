import { DataFactory, Parser, type Term, Writer } from "./rdf.ts";
import {
  RDF_LANG_STRING,
  RDF_TYPE,
  SEMANTIC_CLASSES,
  SEMANTIC_PREDICATES,
  SIGIL_ONTOLOGY,
  XSD,
} from "./ontology.ts";

export interface RdfTerm {
  readonly kind: "iri" | "blank" | "literal";
  readonly value: string;
  readonly datatype?: string;
  readonly language?: string;
}

export interface SemanticFact {
  readonly id: string;
  readonly subject: RdfTerm;
  readonly predicate: string;
  readonly object: RdfTerm;
}

/** Provenance belongs to the ingestion envelope, outside the semantic vocabulary. */
export interface TurtleDocument {
  readonly sourceId: string;
  readonly turtle: string;
  readonly producer?: "user" | "model" | "projection" | "tool";
}

export interface SemanticWorld {
  readonly version: 1;
  readonly fingerprint: string;
  readonly facts: readonly SemanticFact[];
  readonly provenance: Readonly<Record<string, readonly string[]>>;
}

export class SemanticInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SemanticInputError";
  }
}

export async function digest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function resourceId(term: RdfTerm): string {
  if (term.kind === "literal") {
    throw new SemanticInputError(
      "RESOURCE_EXPECTED",
      "Expected an RDF resource.",
    );
  }
  return term.kind === "blank" ? `_:${term.value}` : term.value;
}

function convertTerm(term: Term, scope: string): RdfTerm {
  if (term.termType === "NamedNode") return { kind: "iri", value: term.value };
  if (term.termType === "BlankNode") {
    // RDF 1.1 skolemization gives anonymous entities stable identities across
    // Turtle persistence without importing a dataset/reification language.
    return {
      kind: "iri",
      value: `urn:sigil:node:${scope}:${encodeURIComponent(term.value)}`,
    };
  }
  if (term.termType === "Literal") {
    return {
      kind: "literal",
      value: term.value,
      datatype: term.datatype.value,
      language: term.language.toLowerCase(),
    };
  }
  throw new SemanticInputError(
    "ORDINARY_TURTLE_REQUIRED",
    "Only RDF 1.1 resources and literals are supported.",
  );
}

function validate(
  subject: RdfTerm,
  predicate: string,
  object: RdfTerm,
): RdfTerm {
  resourceId(subject);
  if (predicate === RDF_TYPE) {
    if (
      object.kind !== "iri" ||
      !SEMANTIC_CLASSES.some((name) => object.value === SIGIL_ONTOLOGY + name)
    ) {
      throw new SemanticInputError(
        "UNKNOWN_CLASS",
        `Unknown Sigil class: ${object.value}`,
      );
    }
    return object;
  }
  const name = predicate.startsWith(SIGIL_ONTOLOGY)
    ? predicate.slice(SIGIL_ONTOLOGY.length)
    : "";
  if (!Object.hasOwn(SEMANTIC_PREDICATES, name)) {
    throw new SemanticInputError(
      "UNKNOWN_PREDICATE",
      `Unknown Sigil predicate: ${predicate}`,
    );
  }
  const range = SEMANTIC_PREDICATES[name as keyof typeof SEMANTIC_PREDICATES];
  if (range === "entity") {
    resourceId(object);
    return object;
  }
  if (object.kind !== "literal") {
    throw new SemanticInputError(
      "LITERAL_EXPECTED",
      `${name} requires a ${range} literal.`,
    );
  }
  if (
    range === "text" &&
    [XSD + "string", RDF_LANG_STRING].includes(object.datatype ?? "")
  ) {
    if (
      name === "relation" &&
      (object.language || !Object.hasOwn(SEMANTIC_PREDICATES, object.value) ||
        SEMANTIC_PREDICATES[
            object.value as keyof typeof SEMANTIC_PREDICATES
          ] !== "entity")
    ) {
      throw new SemanticInputError(
        "UNKNOWN_RELATION",
        `Contract relation must name an entity predicate in the Sigil vocabulary: ${object.value}`,
      );
    }
    return object;
  }
  if (
    range === "boolean" && object.datatype === XSD + "boolean" &&
    /^(true|false|0|1)$/.test(object.value)
  ) {
    return {
      ...object,
      value: ["true", "1"].includes(object.value) ? "true" : "false",
    };
  }
  if (range === "number") {
    const lexical = object.value;
    const valid = object.datatype === XSD + "integer"
      ? /^[+-]?\d+$/.test(lexical)
      : object.datatype === XSD + "decimal"
      ? /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(lexical)
      : object.datatype === XSD + "double"
      ? /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(lexical)
      : false;
    const value = Number(lexical);
    if (
      valid && Number.isFinite(value) && value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER &&
      (name !== "risk" || value <= 1)
    ) {
      if (object.datatype === XSD + "integer" && !Number.isSafeInteger(value)) {
        throw new SemanticInputError(
          "NUMERIC_RANGE",
          `Integer exceeds exact supported range: ${lexical}`,
        );
      }
      return { ...object, value: String(value) };
    }
  }
  throw new SemanticInputError(
    "INVALID_LITERAL",
    `Invalid ${name} literal: ${object.value} (${object.datatype})`,
  );
}

export async function parseSemanticWorld(
  documents: readonly TurtleDocument[],
): Promise<SemanticWorld> {
  const facts = new Map<string, SemanticFact>();
  const provenance: Record<string, string[]> = {};
  const sources = new Set<string>();
  for (const document of documents) {
    if (sources.has(document.sourceId)) {
      throw new SemanticInputError(
        "DUPLICATE_SOURCE",
        `Duplicate source identity: ${document.sourceId}`,
      );
    }
    sources.add(document.sourceId);
    if (document.turtle.length > 1_000_000) {
      throw new SemanticInputError(
        "INPUT_LIMIT",
        "Turtle document exceeds 1,000,000 characters.",
      );
    }
    const scope = (await digest(document.sourceId)).slice(0, 24);
    let anonymous = 0;
    let quads;
    try {
      quads = new Parser({
        format: "text/turtle",
        baseIRI: "urn:sigil:world:",
        blankNodePrefix: "",
        factory: {
          ...DataFactory,
          blankNode: (name?: string) =>
            DataFactory.blankNode(
              name === undefined ? `anonymous_${anonymous++}` : `named_${name}`,
            ),
        },
      }).parse(document.turtle);
    } catch (error) {
      throw new SemanticInputError(
        "TURTLE_PARSE",
        `${document.sourceId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
    if (quads.length > 20_000) {
      throw new SemanticInputError(
        "INPUT_LIMIT",
        "Turtle document exceeds 20,000 triples.",
      );
    }
    for (const quad of quads) {
      if (quad.graph.termType !== "DefaultGraph") {
        throw new SemanticInputError(
          "ORDINARY_TURTLE_REQUIRED",
          "Named graphs are not accepted.",
        );
      }
      const subject = convertTerm(quad.subject, scope);
      const predicate = quad.predicate.value;
      const object = validate(
        subject,
        predicate,
        convertTerm(quad.object, scope),
      );
      const id = "fact:" +
        await digest(JSON.stringify([subject, predicate, object]));
      facts.set(id, { id, subject, predicate, object });
      (provenance[id] ??= []).push(document.sourceId);
    }
  }
  return worldFromFacts([...facts.values()], provenance);
}

export async function worldFromFacts(
  facts: readonly SemanticFact[],
  provenance: Readonly<Record<string, readonly string[]>>,
): Promise<SemanticWorld> {
  const sorted = [...new Map(facts.map((fact) => [fact.id, fact])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: 1,
    facts: sorted,
    fingerprint: await digest(sorted.map((fact) => fact.id).join("\n")),
    provenance,
  };
}

/** Reuse the same ontology validation for native-parsed canonical assertions. */
export async function worldFromAssertionTerms(
  assertions: readonly {
    readonly subject: RdfTerm;
    readonly predicate: string;
    readonly object: RdfTerm;
  }[],
  sourceId: string,
): Promise<SemanticWorld> {
  const facts: SemanticFact[] = [];
  const provenance: Record<string, string[]> = {};
  const iri = (value: string) =>
    /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\]*$/.test(value);
  for (const assertion of assertions) {
    if (
      assertion.subject.kind !== "iri" || !iri(assertion.subject.value) ||
      !iri(assertion.predicate) ||
      assertion.object.kind === "blank" ||
      assertion.object.kind === "iri" && !iri(assertion.object.value)
    ) {
      throw new SemanticInputError(
        "INVALID_ASSERTION_TERM",
        "Canonical world resources must be normalized absolute IRIs.",
      );
    }
    if (
      assertion.object.kind === "literal" && (
        !!assertion.object.language !==
          (assertion.object.datatype === RDF_LANG_STRING) ||
        assertion.object.language &&
          !/^[a-z]+(?:-[a-z0-9]+)*$/.test(assertion.object.language)
      )
    ) {
      throw new SemanticInputError(
        "INVALID_ASSERTION_TERM",
        "Literal datatype and normalized language tag disagree.",
      );
    }
    const subject = { kind: "iri" as const, value: assertion.subject.value };
    const object = validate(subject, assertion.predicate, assertion.object);
    const id = "fact:" +
      await digest(JSON.stringify([subject, assertion.predicate, object]));
    facts.push({ id, subject, predicate: assertion.predicate, object });
    provenance[id] = [sourceId];
  }
  return worldFromFacts(facts, provenance);
}

export function serializeSemanticWorld(world: SemanticWorld): string {
  function rdf(term: RdfTerm) {
    if (term.kind === "iri") return DataFactory.namedNode(term.value);
    if (term.kind === "blank") return DataFactory.blankNode(term.value);
    return DataFactory.literal(
      term.value,
      term.language || DataFactory.namedNode(term.datatype ?? XSD + "string"),
    );
  }
  const writer = new Writer({ format: "text/turtle" });
  // Writer's synchronous quad serializer uses the actual RDF term model.
  return writer.quadsToString(world.facts.map((fact) =>
    DataFactory.quad(
      rdf(fact.subject) as ReturnType<typeof DataFactory.namedNode>,
      DataFactory.namedNode(fact.predicate),
      rdf(fact.object),
    )
  ));
}
