import {
  artifactJson,
  isFingerprint,
  readCompileArtifact,
  writeCompileArtifact,
} from "./artifacts.ts";
import { parseEggWorld, serializeEggWorld } from "./egg-world.ts";
import type { SemanticEngineOptions } from "./engine.ts";
import type { ImplementationHandoff } from "./handoff.ts";
import { implementationPath } from "./implementation-workspace.ts";
import { RDF_TYPE, SIGIL_ONTOLOGY, XSD } from "./ontology.ts";
import {
  digest,
  parseSemanticWorld,
  type SemanticFact,
  SemanticInputError,
  type SemanticWorld,
  serializeSemanticWorld,
} from "./turtle.ts";

export interface ReceiptLocation {
  readonly file: string;
  readonly fingerprint: string;
  /** Native-qualified symbol selector, not a text search or line proximity hint. */
  readonly symbol: string;
  readonly start?: number;
  readonly end?: number;
}
export interface ReceiptSidecar {
  readonly version: 1;
  readonly handoff: string;
  readonly producer?: string;
  readonly receipts: Readonly<
    Record<string, {
      readonly locations: readonly ReceiptLocation[];
      readonly tests?: readonly string[];
    }>
  >;
}
export interface ReceiptClaim {
  readonly id: string;
  readonly references: readonly string[];
  readonly obligations: readonly string[];
  readonly subject: string;
  readonly relation: string;
  readonly target: string;
  readonly expected: boolean;
  readonly locations: readonly ReceiptLocation[];
  readonly suggestedTests: readonly string[];
}
export interface ReceiptSubmission {
  readonly fingerprint: string;
  readonly handoff: string;
  readonly world: SemanticWorld;
  readonly sidecar: ReceiptSidecar;
  readonly claims: readonly ReceiptClaim[];
}
function invalid(message: string): never {
  throw new SemanticInputError("INVALID_RECEIPTS", message);
}
function object(
  value: unknown,
  keys?: readonly string[],
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (!keys || Object.keys(value).every((k) => keys.includes(k)));
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 4096 && !value.includes("\0");
}

/** JSON.parse validates syntax; this pass rejects ambiguous duplicate object keys. */
function sidecarJson(source: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    invalid("Receipt sidecar is not JSON.");
  }
  const tokens = source.match(
    /"(?:[^"\\]|\\.)*"|[{}\[\]:,]|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  ) ?? [];
  let index = 0;
  function visit(depth: number): void {
    if (depth > 32) invalid("Receipt sidecar exceeds its nesting limit.");
    const token = tokens[index++];
    if (token === "{") {
      const keys = new Set<string>();
      while (tokens[index] !== "}") {
        const key = JSON.parse(tokens[index++]) as string;
        if (keys.has(key)) invalid(`Duplicate receipt sidecar key: ${key}.`);
        keys.add(key);
        index++; // colon; syntax already validated
        visit(depth + 1);
        if (tokens[index] !== ",") break;
        index++;
      }
      index++;
    } else if (token === "[") {
      while (tokens[index] !== "]") {
        visit(depth + 1);
        if (tokens[index] !== ",") break;
        index++;
      }
      index++;
    }
  }
  visit(0);
  return value;
}

function parseSidecar(input: unknown, expected: string): ReceiptSidecar {
  if (typeof input === "string") {
    if (input.length > 2 * 1024 * 1024) {
      invalid("Receipt sidecar exceeds its size limit.");
    }
    input = sidecarJson(input);
  }
  if (
    !object(input, ["version", "handoff", "producer", "receipts"]) ||
    input.version !== 1 || input.handoff !== expected ||
    input.producer !== undefined && !text(input.producer) ||
    !object(input.receipts) ||
    Object.keys(input.receipts).length > 10000
  ) {
    invalid(
      "Receipt sidecar version or retained handoff identity does not match.",
    );
  }
  for (const [id, item] of Object.entries(input.receipts)) {
    if (
      !text(id) || !object(item, ["locations", "tests"]) ||
      !Array.isArray(item.locations) || item.locations.length > 100 ||
      item.tests !== undefined &&
        (!Array.isArray(item.tests) || item.tests.length > 100 ||
          !item.tests.every(text))
    ) invalid("Invalid receipt location/test sidecar.");
    for (const loc of item.locations) {
      if (
        !object(loc, ["file", "fingerprint", "symbol", "start", "end"]) ||
        !text(loc.file) || !implementationPath(loc.file) ||
        !isFingerprint(loc.fingerprint) || !text(loc.symbol) ||
        (loc.start === undefined) !== (loc.end === undefined) ||
        loc.start !== undefined &&
          (!Number.isSafeInteger(loc.start) || !Number.isSafeInteger(loc.end) ||
            Number(loc.start) < 0 || Number(loc.end) <= Number(loc.start))
      ) invalid("Invalid receipt symbol, file hash or source range.");
    }
  }
  // Detach claims from caller-owned mutable data and omit absent optional fields.
  const sidecar = JSON.parse(JSON.stringify(input)) as ReceiptSidecar;
  if (artifactJson(sidecar).length > 2 * 1024 * 1024) {
    invalid("Receipt sidecar exceeds its size limit.");
  }
  return sidecar;
}

// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationHandoff::ReceiptSubmission interface
export async function parseReceiptSubmission(
  handoff: ImplementationHandoff,
  turtle: string,
  input: unknown,
): Promise<ReceiptSubmission> {
  if (typeof turtle !== "string" || turtle.length > 2 * 1024 * 1024) {
    invalid("Receipt Turtle exceeds its size limit.");
  }
  const sidecar = parseSidecar(input, handoff.id);
  const world = await parseSemanticWorld([{
    sourceId: `receipts:${handoff.id}`,
    turtle,
    producer: "model",
  }]);
  const grouped = new Map<string, SemanticFact[]>();
  for (const fact of world.facts) {
    const id = fact.subject.value;
    if (
      ![
        RDF_TYPE,
        ...["covers", "from", "relation", "target", "expected", "passes"].map(
          (p) => SIGIL_ONTOLOGY + p,
        ),
      ].includes(fact.predicate)
    ) invalid("Receipts cannot change assertions, rules or verifier policy.");
    grouped.set(id, [...grouped.get(id) ?? [], fact]);
  }
  if (
    grouped.size > 10000 ||
    artifactJson([...grouped.keys()].sort()) !==
      artifactJson(Object.keys(sidecar.receipts).sort())
  ) invalid("Every receipt needs exactly one matching location sidecar entry.");
  const claims: ReceiptClaim[] = [];
  for (
    const [id, facts] of [...grouped].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )
  ) {
    const values = (name: string) =>
      facts.filter((f) =>
        f.predicate === (name === "type" ? RDF_TYPE : SIGIL_ONTOLOGY + name)
      ).map((f) => f.object);
    const one = (name: string) => {
      const choices = values(name);
      if (choices.length !== 1) {
        invalid(`Receipt ${id} needs exactly one ${name}.`);
      }
      return choices[0];
    };
    if (one("type").value !== SIGIL_ONTOLOGY + "Evidence") {
      invalid("Receipt subjects must be Evidence entities.");
    }
    const subject = one("from").value;
    const relation = one("relation");
    const target = one("target").value;
    if (relation.datatype !== XSD + "string" || relation.language) {
      invalid("Receipt relation must be a plain string.");
    }
    const expectedTerms = values("expected");
    if (expectedTerms.length > 1) {
      invalid("Conflicting expected values on receipt.");
    }
    if (values("passes").length > 1) {
      invalid("Conflicting documentary check claims on receipt.");
    }
    const expected = expectedTerms.length
      ? expectedTerms[0].value === "true"
      : true;
    const references = values("covers").map((v) => v.value).sort();
    if (!references.length) {
      invalid("A receipt must name a handed-off fact or obligation.");
    }
    const ids = new Set<string>();
    for (const ref of references) {
      const direct = handoff.manifest.obligations.find((o) => o.id === ref);
      const matching = direct ? [direct.id] : handoff.manifest.facts[ref];
      if (!matching?.length) {
        invalid(
          `Receipt references an unknown or non-obligating proposition: ${ref}.`,
        );
      }
      for (const obligation of matching) ids.add(obligation);
    }
    for (const obligation of ids) {
      const original = handoff.manifest.obligations.find((o) =>
        o.id === obligation
      )!;
      if (
        original.subject !== subject || original.relation !== relation.value ||
        original.target !== target || original.expected !== expected
      ) {
        invalid(
          `Receipt ${id} does not match the exact handed-off proposition ${obligation}.`,
        );
      }
    }
    const locations = sidecar.receipts[id];
    claims.push({
      id,
      references,
      obligations: [...ids].sort(),
      subject,
      relation: relation.value,
      target,
      expected,
      locations: locations.locations,
      suggestedTests: locations.tests ?? [],
    });
  }
  return {
    fingerprint: await digest(artifactJson([world.fingerprint, sidecar])),
    handoff: handoff.id,
    world,
    sidecar,
    claims,
  };
}

export async function writeReceiptSubmission(
  root: string,
  handoff: ImplementationHandoff,
  turtle: string,
  sidecar: unknown,
): Promise<{ readonly id: string; readonly submission: ReceiptSubmission }> {
  const submission = await parseReceiptSubmission(handoff, turtle, sidecar);
  const artifact = await writeCompileArtifact(root, {
    kind: "receipts",
    dependencies: { handoff: handoff.id, slice: handoff.slice.fingerprint },
    files: {
      "assertions.egg": serializeEggWorld(submission.world),
      "locations.json": artifactJson(submission.sidecar),
    },
    metadata: { role: "untrusted-receipts" },
  });
  return { id: artifact.id, submission };
}

export async function readReceiptSubmission(
  root: string,
  handoff: ImplementationHandoff,
  id: string,
  engine: SemanticEngineOptions = {},
): Promise<ReceiptSubmission> {
  const artifact = await readCompileArtifact(root, "receipts", id);
  if (
    !artifact || artifact.manifest.metadata.role !== "untrusted-receipts" ||
    artifactJson(artifact.manifest.dependencies) !==
      artifactJson({ handoff: handoff.id, slice: handoff.slice.fingerprint }) ||
    artifactJson(Object.keys(artifact.files).sort()) !==
      artifactJson(["assertions.egg", "locations.json"])
  ) invalid("Receipt bundle does not match the retained handoff.");
  const world = await parseEggWorld(artifact.files["assertions.egg"], engine);
  return parseReceiptSubmission(
    handoff,
    serializeSemanticWorld(world),
    artifact.files["locations.json"],
  );
}
