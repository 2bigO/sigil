import { fileURLToPath } from "node:url";
import { RDF_TYPE, SEMANTIC_PREDICATES, SIGIL_ONTOLOGY } from "./ontology.ts";
import { resourceId, type SemanticWorld } from "./turtle.ts";

export interface LoweredFact {
  readonly relation: "kind" | "edge" | "boolean" | "number" | "text";
  readonly args: readonly (string | number)[];
}

export interface ClosureResult {
  readonly version: 1;
  readonly kernelVersion: "1";
  readonly tables: Readonly<
    Record<string, readonly (readonly (string | number | boolean)[])[]>
  >;
}

export interface SemanticEngineOptions {
  readonly binaryPath?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly focus?: "design" | "implementation";
  /** Host-owned observations. Asserted Turtle never populates these tables. */
  readonly observations?: readonly MechanicalObservation[];
  readonly completeScopes?: readonly MechanicalScope[];
}

export interface MechanicalScope {
  readonly subject: string;
  readonly predicate: string;
  readonly evidence: string;
}

export interface MechanicalObservation extends MechanicalScope {
  readonly object: string;
}

export function lowerSemanticWorld(
  world: SemanticWorld,
): readonly LoweredFact[] {
  return world.facts.map((fact) => {
    const subject = resourceId(fact.subject);
    if (fact.predicate === RDF_TYPE) {
      return {
        relation: "kind",
        args: [
          subject,
          fact.object.value.slice(SIGIL_ONTOLOGY.length),
          "",
          fact.id,
        ],
      };
    }
    const predicate = fact.predicate.slice(
      SIGIL_ONTOLOGY.length,
    ) as keyof typeof SEMANTIC_PREDICATES;
    const range = SEMANTIC_PREDICATES[predicate];
    return {
      relation: range === "entity" ? "edge" : range,
      args: [
        subject,
        predicate,
        range === "entity"
          ? resourceId(fact.object)
          : range === "number"
          ? Number(fact.object.value)
          : fact.object.value,
        fact.id,
      ],
    };
  });
}

export async function computeClosure(
  world: SemanticWorld,
  options: SemanticEngineOptions = {},
): Promise<ClosureResult> {
  options.signal?.throwIfAborted();
  const binary = options.binaryPath ??
    fileURLToPath(
      new URL(
        `../../native/target/release/sigil-semantic-engine${
          Deno.build.os === "windows" ? ".exe" : ""
        }`,
        import.meta.url,
      ),
    );
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Semantic engine timeout must be a positive safe integer.");
  }
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(timeoutMs),
  ]);
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(binary, {
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      signal,
    }).spawn();
  } catch (error) {
    throw new Error(
      `Cannot start Sigil's egglog engine. Run deno task build:semantic. ${
        error instanceof Error ? error.message : error
      }`,
      { cause: error },
    );
  }
  const input = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      facts: lowerSemanticWorld(world),
      implementation: options.focus === "implementation",
      observations: options.observations ?? [],
      complete_scopes: options.completeScopes ?? [],
    }),
  );
  const writer = child.stdin.getWriter();
  const [, output] = await Promise.all([
    (async () => {
      try {
        await writer.write(input);
      } finally {
        await writer.close();
      }
    })(),
    child.output(),
  ]);
  signal.throwIfAborted();
  if (!output.success) {
    throw new Error(
      `egglog failed: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
  const result = JSON.parse(
    new TextDecoder().decode(output.stdout),
  ) as ClosureResult;
  if (result.version !== 1 || result.kernelVersion !== "1" || !result.tables) {
    throw new Error("Incompatible egglog engine response.");
  }
  return result;
}
