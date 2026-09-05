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
  readonly kernelFingerprint: string;
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
  readonly requiredChecks?: readonly string[];
  readonly checks?: readonly MechanicalCheck[];
}

export interface MechanicalCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly evidence: string;
}

export interface MechanicalScope {
  readonly subject: string;
  /** Omission is an explicit host assertion of completeness for every target. */
  readonly object?: string;
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

const IPC_LIMIT = 16 * 1024 * 1024;
const TABLE_SIGNATURES: Readonly<Record<string, string>> = {
  known: "ssss",
  reachable: "sss",
  obligation: "ssss",
  satisfied: "ss",
  violation: "ssss",
  unresolved: "ssss",
  because: "ssss",
  "path-cost": "ssn",
  "risk-score": "sn",
  proposition: "sssss",
  coverage: "sssss",
  "implementation-satisfied": "ss",
};

/** Validate every fixed table before any absence can be interpreted as success. */
export function decodeClosureResponse(source: string): ClosureResult {
  if (new TextEncoder().encode(source).length > IPC_LIMIT) {
    throw new Error("Semantic engine response exceeds the 16 MiB limit.");
  }
  const raw: unknown = JSON.parse(source);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid egglog engine response.");
  }
  const value = raw as Record<string, unknown>;
  if (
    value.version !== 1 || value.kernelVersion !== "1" ||
    typeof value.kernelFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.kernelFingerprint) ||
    !value.tables || typeof value.tables !== "object" ||
    Array.isArray(value.tables) ||
    Object.keys(value).some((key) =>
      !["version", "kernelVersion", "kernelFingerprint", "tables"].includes(key)
    )
  ) {
    throw new Error("Incompatible egglog engine response.");
  }
  const tables = value.tables as Record<string, unknown>;
  if (
    Object.keys(tables).length !== Object.keys(TABLE_SIGNATURES).length ||
    Object.keys(tables).some((key) => !Object.hasOwn(TABLE_SIGNATURES, key))
  ) {
    throw new Error("Incomplete or unknown egglog output tables.");
  }
  for (const [name, signature] of Object.entries(TABLE_SIGNATURES)) {
    const rows = tables[name];
    if (
      !Array.isArray(rows) || rows.some((row) =>
        !Array.isArray(row) ||
        row.length !== signature.length || row.some((cell, index) =>
          signature[index] === "s"
            ? typeof cell !== "string"
            : typeof cell !== "number" || !Number.isFinite(cell) || cell < 0
        )
      )
    ) {
      throw new Error(`Invalid egglog output rows in ${name}.`);
    }
  }
  return raw as ClosureResult;
}

async function boundedOutput(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        throw new Error("Semantic engine output limit exceeded.");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function computeClosure(
  world: SemanticWorld,
  options: SemanticEngineOptions = {},
): Promise<ClosureResult> {
  return decodeClosureResponse(
    await executeSemanticEngine({
      version: 1,
      facts: lowerSemanticWorld(world),
      implementation: options.focus === "implementation",
      observations: options.observations ?? [],
      complete_scopes: options.completeScopes ?? [],
      required_checks: options.requiredChecks ?? [],
      checks: options.checks ?? [],
    }, options),
  );
}

/** Bounded native transport shared by closure execution and data-only parsing. */
export async function executeSemanticEngine(
  request: unknown,
  options: SemanticEngineOptions = {},
): Promise<string> {
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
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  ) {
    throw new Error(
      "Semantic engine timeout must be a positive integer of at most 2147483647 milliseconds.",
    );
  }
  const input = new TextEncoder().encode(JSON.stringify(request));
  if (input.length > IPC_LIMIT) {
    throw new Error("Semantic engine input exceeds the 16 MiB limit.");
  }
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(binary, {
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (error) {
    throw new Error(
      `Cannot start Sigil's egglog engine. Run deno task build:semantic. ${
        error instanceof Error ? error.message : error
      }`,
      { cause: error },
    );
  }
  const timeout = new AbortController();
  const timer = setTimeout(() =>
    timeout.abort(
      new DOMException("Semantic engine execution timed out.", "TimeoutError"),
    ), timeoutMs);
  const signal = AbortSignal.any([
    timeout.signal,
    ...(options.signal ? [options.signal] : []),
  ]);
  // The native engine has no subprocesses. Kill it on every rejected I/O path and
  // always reap it; returning early from Promise.all would leak a running engine.
  const stop = () => {
    try {
      child.kill("SIGKILL");
    } catch { /* already exited */ }
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  let failure: unknown;
  let ioFailed = false;
  const guard = <T>(operation: Promise<T>): Promise<T> =>
    operation.catch((error) => {
      if (!ioFailed) {
        failure = error;
        ioFailed = true;
      }
      stop();
      throw error;
    });
  try {
    const writer = child.stdin.getWriter();
    const results = await Promise.allSettled(
      [
        guard((async () => {
          try {
            await writer.write(input);
            await writer.close();
          } finally {
            writer.releaseLock();
          }
        })()),
        guard(boundedOutput(child.stdout, IPC_LIMIT)),
        guard(boundedOutput(child.stderr, 1024 * 1024)),
        guard(child.status),
      ] as const,
    );
    signal.throwIfAborted();
    if (ioFailed) throw failure;
    const [, stdout, stderr, status] = results;
    if (
      stdout.status !== "fulfilled" || stderr.status !== "fulfilled" ||
      status.status !== "fulfilled"
    ) {
      throw new Error("Semantic engine I/O did not settle.");
    }
    if (!status.value.success) {
      throw new Error(
        `egglog failed: ${new TextDecoder().decode(stderr.value)}`,
      );
    }
    return new TextDecoder().decode(stdout.value);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}
