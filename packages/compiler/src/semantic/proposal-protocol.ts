import { SemanticInputError } from "./turtle.ts";

export const SEMANTIC_PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "candidates"],
  properties: {
    version: { type: "integer", const: 1 },
    candidates: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "additions", "retractions"],
        properties: {
          id: { type: "string" },
          additions: { type: "string" },
          retractions: { type: "string" },
        },
      },
    },
  },
} as const;

export const SEMANTIC_QUESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "factId", "question"],
  properties: {
    version: { type: "integer", const: 1 },
    factId: { type: "string" },
    question: { type: "string" },
  },
} as const;

function invalid(message: string): never {
  throw new SemanticInputError("INVALID_PROPOSAL", message);
}

class UniqueJsonParser {
  #index = 0;
  constructor(readonly source: string) {}
  parse(): unknown {
    const value = this.value();
    this.space();
    if (this.#index !== this.source.length) {
      invalid("JSON payload has trailing content.");
    }
    return value;
  }
  #char(): string | undefined {
    return this.source[this.#index];
  }
  space(): void {
    while (/\s/.test(this.#char() ?? "")) this.#index++;
  }
  value(): unknown {
    this.space();
    const char = this.#char();
    if (char === "{") return this.object();
    if (char === "[") return this.array();
    if (char === '"') return this.string();
    for (
      const [token, value] of [["true", true], ["false", false], [
        "null",
        null,
      ]] as const
    ) {
      if (this.source.startsWith(token, this.#index)) {
        this.#index += token.length;
        return value;
      }
    }
    const number = this.source.slice(this.#index).match(
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    );
    if (number) {
      this.#index += number[0].length;
      const value = Number(number[0]);
      if (!Number.isFinite(value)) invalid("JSON number is not finite.");
      return value;
    }
    invalid(`Invalid JSON value at byte ${this.#index}.`);
  }
  object(): Record<string, unknown> {
    this.#index++;
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    this.space();
    if (this.#char() === "}") {
      this.#index++;
      return result;
    }
    while (true) {
      this.space();
      if (this.#char() !== '"') {
        invalid(`JSON object key expected at byte ${this.#index}.`);
      }
      const key = this.string();
      if (typeof key !== "string") invalid("JSON object key is not a string.");
      if (keys.has(key)) {
        invalid(`Duplicate JSON object key ${JSON.stringify(key)}.`);
      }
      keys.add(key);
      this.space();
      if (this.#char() !== ":") {
        invalid("JSON object key must be followed by a colon.");
      }
      this.#index++;
      result[key] = this.value();
      this.space();
      if (this.#char() === "}") {
        this.#index++;
        return result;
      }
      if (this.#char() !== ",") {
        invalid("JSON object entries must be comma separated.");
      }
      this.#index++;
    }
  }
  array(): unknown[] {
    this.#index++;
    const result: unknown[] = [];
    this.space();
    if (this.#char() === "]") {
      this.#index++;
      return result;
    }
    while (true) {
      result.push(this.value());
      this.space();
      if (this.#char() === "]") {
        this.#index++;
        return result;
      }
      if (this.#char() !== ",") {
        invalid("JSON array entries must be comma separated.");
      }
      this.#index++;
    }
  }
  string(): string {
    const start = this.#index++;
    while (this.#index < this.source.length) {
      const char = this.source[this.#index++];
      if (char === "\\") this.#index++;
      else if (char === '"') {
        try {
          return JSON.parse(this.source.slice(start, this.#index));
        } catch {
          invalid("JSON string is malformed.");
        }
      } else if (char < " ") {
        invalid("JSON strings cannot contain control characters.");
      }
    }
    invalid("JSON string is unterminated.");
  }
}

export function parseUniqueJson(
  source: string,
  maxBytes = 4 * 1024 * 1024,
): unknown {
  if (new TextEncoder().encode(source).length > maxBytes) {
    invalid("JSON payload exceeds its byte limit.");
  }
  try {
    return new UniqueJsonParser(source).parse();
  } catch (error) {
    if (error instanceof SemanticInputError) throw error;
    invalid(error instanceof Error ? error.message : "Invalid JSON payload.");
  }
}

export function decodeProposalEnvelope(source: string): {
  readonly version: 1;
  readonly candidates: readonly {
    readonly id: string;
    readonly additions: string;
    readonly retractions: string;
  }[];
} {
  const value = parseUniqueJson(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Proposal output must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1 || !Array.isArray(raw.candidates) ||
    raw.candidates.length < 1 || raw.candidates.length > 8 ||
    Object.keys(raw).some((key) => !["version", "candidates"].includes(key))
  ) invalid("Expected version 1 with between 1 and 8 Turtle candidates.");
  const ids = new Set<string>();
  const candidates = raw.candidates.map((candidate) => {
    if (
      !candidate || typeof candidate !== "object" || Array.isArray(candidate)
    ) invalid("Each candidate must be an object.");
    const item = candidate as Record<string, unknown>;
    if (
      Object.keys(item).some((key) =>
        !["id", "additions", "retractions"].includes(key)
      ) || typeof item.id !== "string" || !item.id.trim() ||
      item.id.length > 128 || typeof item.additions !== "string" ||
      typeof item.retractions !== "string" || ids.has(item.id)
    ) {
      invalid(
        "Each candidate needs a unique id, additions Turtle and retractions Turtle, with no other fields.",
      );
    }
    ids.add(item.id);
    return {
      id: item.id,
      additions: item.additions,
      retractions: item.retractions,
    };
  });
  return { version: 1, candidates };
}

export function decodeQuestionEnvelope(
  source: string,
  factId: string,
): { readonly version: 1; readonly factId: string; readonly question: string } {
  const value = parseUniqueJson(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Question rendering must return an object.");
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1 || raw.factId !== factId ||
    typeof raw.question !== "string" || !raw.question.trim() ||
    raw.question.length > 2000 ||
    Object.keys(raw).some((key) =>
      !["version", "factId", "question"].includes(key)
    )
  ) {
    invalid(
      "Question renderer changed the proposition identity or returned invalid text.",
    );
  }
  return { version: 1, factId, question: raw.question };
}
