import { resolve } from "node:path";
import {
  artifactJson,
  initializeCompileArtifacts,
  isFingerprint,
  readCompileArtifact,
  writeCompileArtifact,
} from "./artifacts.ts";
import { compileSemanticWorld, type SemanticCompilation } from "./compile.ts";
import { parseEggWorld, serializeEggWorld } from "./egg-world.ts";
import type { SemanticEngineOptions } from "./engine.ts";
import {
  type ImplementationPolicy,
  parseImplementationPolicy,
} from "./evidence.ts";
import {
  bytesHash,
  captureImplementationSnapshot,
  implementationPath,
  type ImplementationSnapshot,
} from "./implementation-workspace.ts";
import { RDF_TYPE, SIGIL_ONTOLOGY } from "./ontology.ts";
import { scopeSemanticWorld } from "./scope.ts";
import { digest, SemanticInputError, type SemanticWorld } from "./turtle.ts";
import { TYPESCRIPT_EXTRACTOR_VERSION } from "./typescript7.ts";
import { parseUniqueJson } from "./proposal-protocol.ts";

export interface HandoffObligation {
  readonly id: string;
  readonly kernelId: string;
  readonly subject: string;
  readonly relation: string;
  readonly target: string;
  readonly expected: boolean;
  readonly facts: readonly string[];
}
export interface HandoffManifest {
  readonly version: 1;
  readonly worldFingerprint: string;
  readonly sliceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly kernelFingerprint: string;
  readonly analyzer: "typescript@7.0.2";
  readonly extractorVersion: typeof TYPESCRIPT_EXTRACTOR_VERSION;
  readonly subjects: readonly string[];
  readonly boundary: readonly string[];
  readonly obligations: readonly HandoffObligation[];
  readonly facts: Readonly<Record<string, readonly string[]>>;
  readonly policy: ImplementationPolicy;
  readonly policyFingerprint: string;
  readonly baselineFingerprint: string;
  readonly baselineFiles: readonly {
    readonly path: string;
    readonly hash: string;
    readonly symlink: string | null;
    readonly executable: boolean;
  }[];
  readonly protectedFiles: Readonly<Record<string, string>>;
  readonly requiredChecks: readonly string[];
  readonly canonicalRevision: string | null;
}
export interface ImplementationHandoff {
  readonly id: string;
  readonly manifest: HandoffManifest;
  readonly world: SemanticWorld;
  readonly slice: SemanticWorld;
  readonly compilation: SemanticCompilation;
}
function invalid(message: string): never {
  throw new SemanticInputError("INVALID_HANDOFF", message);
}
const same = (a: unknown, b: unknown) => artifactJson(a) === artifactJson(b);
const sorted = (items: readonly string[]) => [...new Set(items)].sort();

function componentIds(world: SemanticWorld): string[] {
  return sorted(
    world.facts.filter((f) =>
      f.predicate === RDF_TYPE &&
      ["Component", "System"].some((c) => f.object.value === SIGIL_ONTOLOGY + c)
    )
      .map((f) => f.subject.value),
  );
}

/** Export every boundary obligation before looking at returned receipt claims. */
async function obligations(
  compilation: SemanticCompilation,
): Promise<HandoffObligation[]> {
  const facts = new Set(compilation.world.facts.map((f) => f.id));
  const premises = new Map<string, string[]>();
  for (const [id, , a, b] of compilation.closure.tables.because) {
    premises.set(String(id), [
      ...premises.get(String(id)) ?? [],
      String(a),
      String(b),
    ]);
  }
  for (const [id, evidence] of compilation.closure.tables.satisfied) {
    premises.set(String(id), [
      ...premises.get(String(id)) ?? [],
      String(evidence),
    ]);
  }
  const result: HandoffObligation[] = [];
  for (const row of compilation.closure.tables.coverage) {
    const [kernelId, subject, relation, target, expected] = row.map(String);
    const visited = new Set<string>();
    const sources = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);
      if (facts.has(id)) sources.add(id);
      for (const premise of premises.get(id) ?? []) visit(premise);
    };
    visit(kernelId);
    result.push({
      id: `urn:sigil:obligation:${await digest(artifactJson(row))}`,
      kernelId,
      subject,
      relation,
      target,
      expected: expected === "true",
      facts: sorted([...sources]),
    });
  }
  return result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function factIndex(
  world: SemanticWorld,
  required: readonly HandoffObligation[],
) {
  return Object.fromEntries(
    world.facts.map((f) => [
      f.id,
      required.filter((o) => o.facts.includes(f.id)).map((o) => o.id),
    ]),
  );
}

/** Freeze specification and tool configuration as well as explicitly named oracles. */
function automaticProtection(
  path: string,
  policy: ImplementationPolicy,
): boolean {
  // A host may bind a data file as implementation. Specification and known tool
  // configuration remain protected even if listed in a component inventory.
  const configuration = path.startsWith(".sigil/") || path === policy.project ||
    /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|deno\.jsonc?|[^/]*\.lock)$/
      .test(path);
  if (
    !configuration && !path.endsWith(".sigil") &&
    policy.components.some((c) => c.files.includes(path))
  ) return false;
  return path.endsWith(".sigil") || /\.(jsonc?|ya?ml|toml|lock)$/.test(path) ||
    ["package-lock.json", "yarn.lock", "bun.lockb"].includes(path);
}
function protectedPaths(
  baseline: readonly string[],
  policy: ImplementationPolicy,
  revision?: string | null,
): string[] {
  return sorted([
    ...baseline.filter((path) => automaticProtection(path, policy)),
    policy.project,
    ...policy.protectedFiles ?? [],
    ...policy.checks?.flatMap((check) => check.files) ?? [],
    ...revision
      ? [
        ".sigil/world/current.json",
        `.sigil/world/${revision}/manifest.json`,
        `.sigil/world/${revision}/assertions.egg`,
      ]
      : [],
  ]);
}
async function protectedHash(root: string, path: string): Promise<string> {
  if (!implementationPath(path)) invalid(`Invalid protected path: ${path}.`);
  root = await Deno.realPath(root);
  let full = root;
  for (const part of path.split("/")) {
    full = resolve(full, part);
    if ((await Deno.lstat(full)).isSymlink) {
      invalid(`Protected input cannot be a symlink: ${path}.`);
    }
  }
  const stat = await Deno.stat(full);
  if (!stat.isFile || stat.size > 32 * 1024 * 1024) {
    invalid(`Protected input is not a bounded file: ${path}.`);
  }
  const bytes = await Deno.readFile(full);
  if (bytes.length > 32 * 1024 * 1024) {
    invalid(`Protected input grew beyond its limit: ${path}.`);
  }
  return bytesHash(bytes);
}

// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationHandoff::RetainedHandoff interface
export async function createImplementationHandoff(options: {
  readonly root: string;
  readonly world: SemanticWorld;
  readonly subjects: readonly string[];
  readonly sourceFingerprint: string;
  readonly policy: ImplementationPolicy;
  readonly canonicalRevision?: string;
  readonly engine?: SemanticEngineOptions;
}): Promise<ImplementationHandoff> {
  const engine = {
    ...options.engine,
    focus: "design" as const,
    observations: [],
    completeScopes: [],
    requiredChecks: [],
    checks: [],
  };
  const policy = parseImplementationPolicy(
    JSON.parse(artifactJson(options.policy)),
  );
  const subjects = sorted(options.subjects);
  const components = componentIds(options.world);
  if (
    !subjects.length || subjects.length > 1000 ||
    subjects.some((s) => !components.includes(s)) ||
    !isFingerprint(options.sourceFingerprint) ||
    options.canonicalRevision !== undefined &&
      !isFingerprint(options.canonicalRevision)
  ) {
    invalid(
      "Handoff requires known components and valid source/revision identities.",
    );
  }
  // Reload even caller-supplied assertion objects through the canonical parser.
  const world = await parseEggWorld(serializeEggWorld(options.world), engine);
  if ((await compileSemanticWorld(world, engine)).status !== "green") {
    invalid("Handoff requires a green accepted world.");
  }
  const slice = await scopeSemanticWorld(world, subjects);
  const compilation = await compileSemanticWorld(slice, engine);
  if (compilation.status !== "green") {
    invalid("The retained verification boundary is not green.");
  }
  await initializeCompileArtifacts(options.root);
  const baseline = await captureImplementationSnapshot(
    options.root,
    engine.signal,
  );
  const paths = protectedPaths(
    baseline.files.map((f) => f.path),
    policy,
    options.canonicalRevision,
  );
  const protectedFiles: Record<string, string> = Object.create(null);
  for (const path of sorted([...paths])) {
    engine.signal?.throwIfAborted();
    protectedFiles[path] = await protectedHash(options.root, path);
    const captured = baseline.files.find((f) => f.path === path);
    if (captured && captured.hash !== protectedFiles[path]) {
      invalid(`Input changed during handoff: ${path}.`);
    }
  }
  const required = await obligations(compilation);
  const manifest: HandoffManifest = {
    version: 1,
    worldFingerprint: world.fingerprint,
    sliceFingerprint: slice.fingerprint,
    sourceFingerprint: options.sourceFingerprint,
    kernelFingerprint: compilation.closure.kernelFingerprint,
    analyzer: "typescript@7.0.2",
    extractorVersion: TYPESCRIPT_EXTRACTOR_VERSION,
    subjects,
    boundary: componentIds(slice),
    obligations: required,
    facts: factIndex(slice, required),
    policy,
    policyFingerprint: await digest(artifactJson(policy)),
    baselineFingerprint: baseline.fingerprint,
    baselineFiles: baseline.files.map((f) => ({
      path: f.path,
      hash: f.hash,
      symlink: f.symlink ?? null,
      executable: f.executable,
    })),
    protectedFiles,
    requiredChecks: [
      `urn:sigil:check:typescript7:${encodeURIComponent(policy.project)}`,
      ...policy.checks?.map((c) => c.id) ?? [],
    ].sort(),
    canonicalRevision: options.canonicalRevision ?? null,
  };
  engine.signal?.throwIfAborted();
  if (
    (await captureImplementationSnapshot(options.root, engine.signal))
      .fingerprint !== baseline.fingerprint
  ) invalid("Code changed while preparing the handoff.");
  const artifact = await writeCompileArtifact(options.root, {
    kind: "handoffs",
    dependencies: {
      world: world.fingerprint,
      slice: slice.fingerprint,
      source: manifest.sourceFingerprint,
      kernel: manifest.kernelFingerprint,
      policy: manifest.policyFingerprint,
      baseline: baseline.fingerprint,
    },
    files: {
      "world.egg": serializeEggWorld(world),
      "assertions.egg": serializeEggWorld(slice),
      "handoff.json": artifactJson(manifest),
    },
    metadata: { role: "implementation-handoff" },
  });
  return { id: artifact.id, manifest, world, slice, compilation };
}

// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilImplementationHandoff::RetainedHandoff interface
export async function readImplementationHandoff(
  root: string,
  id: string,
  engine: SemanticEngineOptions = {},
): Promise<ImplementationHandoff> {
  const artifact = await readCompileArtifact(root, "handoffs", id);
  if (
    !artifact || artifact.manifest.metadata.role !== "implementation-handoff" ||
    !same(Object.keys(artifact.files).sort(), [
      "assertions.egg",
      "handoff.json",
      "world.egg",
    ])
  ) invalid("No retained implementation handoff matches this identity.");
  let raw: HandoffManifest;
  try {
    raw = parseUniqueJson(artifact.files["handoff.json"]) as HandoffManifest;
  } catch {
    invalid("Retained handoff manifest is not valid JSON.");
  }
  if (
    !raw || raw.version !== 1 || raw.analyzer !== "typescript@7.0.2" ||
    raw.extractorVersion !== TYPESCRIPT_EXTRACTOR_VERSION ||
    Object.keys(raw).some((key) =>
      ![
        "version",
        "worldFingerprint",
        "sliceFingerprint",
        "sourceFingerprint",
        "kernelFingerprint",
        "analyzer",
        "extractorVersion",
        "subjects",
        "boundary",
        "obligations",
        "facts",
        "policy",
        "policyFingerprint",
        "baselineFingerprint",
        "baselineFiles",
        "protectedFiles",
        "requiredChecks",
        "canonicalRevision",
      ].includes(key)
    ) ||
    !Array.isArray(raw.subjects) || !raw.subjects.length ||
    raw.subjects.length > 1000 ||
    raw.subjects.some((s) => typeof s !== "string") ||
    !same(raw.subjects, sorted(raw.subjects)) ||
    !raw.protectedFiles || typeof raw.protectedFiles !== "object" ||
    Array.isArray(raw.protectedFiles) ||
    Object.entries(raw.protectedFiles).some(([path, hash]) =>
      !implementationPath(path) || !isFingerprint(hash)
    ) ||
    !Array.isArray(raw.baselineFiles) || raw.baselineFiles.length > 30000 ||
    raw.baselineFiles.some((f) =>
      !f || !implementationPath(f.path) || !isFingerprint(f.hash) ||
      typeof f.executable !== "boolean" ||
      f.symlink !== null && typeof f.symlink !== "string"
    ) ||
    raw.canonicalRevision !== null && !isFingerprint(raw.canonicalRevision)
  ) invalid("Invalid retained handoff manifest.");
  const policy = parseImplementationPolicy(raw.policy);
  if (
    !same(
      Object.keys(raw.protectedFiles).sort(),
      protectedPaths(
        raw.baselineFiles.map((f) => f.path),
        policy,
        raw.canonicalRevision,
      ),
    )
  ) invalid("Protected handoff input inventory is incomplete or altered.");
  if (
    !same(
      raw.baselineFiles.map((f) => f.path),
      sorted(raw.baselineFiles.map((f) => f.path)),
    ) ||
    raw.baselineFingerprint !==
      await digest(
        JSON.stringify(
          raw.baselineFiles.map(
            (f) => [f.path, f.hash, f.symlink, f.executable],
          ),
        ),
      )
  ) invalid("Invalid baseline inventory identity.");
  const cleanEngine = {
    ...engine,
    focus: "design" as const,
    observations: [],
    completeScopes: [],
    requiredChecks: [],
    checks: [],
  };
  const world = await parseEggWorld(artifact.files["world.egg"], cleanEngine);
  if ((await compileSemanticWorld(world, cleanEngine)).status !== "green") {
    invalid("The retained accepted world no longer compiles green.");
  }
  if (raw.subjects.some((s) => !componentIds(world).includes(s))) {
    invalid("Handoff contains an unknown component.");
  }
  const slice = await scopeSemanticWorld(world, raw.subjects);
  if (artifact.files["assertions.egg"] !== serializeEggWorld(slice)) {
    invalid("Handoff slice differs from its retained world.");
  }
  const compilation = await compileSemanticWorld(slice, cleanEngine);
  if (compilation.closure.kernelFingerprint !== raw.kernelFingerprint) {
    throw new SemanticInputError(
      "STALE_HANDOFF_KERNEL",
      "The kernel changed since handoff. Issue a new handoff under the current verifier.",
    );
  }
  const required = await obligations(compilation);
  if (
    compilation.status !== "green" ||
    raw.worldFingerprint !== world.fingerprint ||
    raw.sliceFingerprint !== slice.fingerprint ||
    !same(raw.obligations, required) ||
    !same(raw.facts, factIndex(slice, required)) ||
    !same(raw.boundary, componentIds(slice)) ||
    raw.policyFingerprint !== await digest(artifactJson(policy)) ||
    !same(
      raw.requiredChecks,
      [
        `urn:sigil:check:typescript7:${encodeURIComponent(policy.project)}`,
        ...policy.checks?.map((c) => c.id) ?? [],
      ].sort(),
    ) ||
    !same(artifact.manifest.dependencies, {
      world: world.fingerprint,
      slice: slice.fingerprint,
      source: raw.sourceFingerprint,
      kernel: raw.kernelFingerprint,
      policy: raw.policyFingerprint,
      baseline: raw.baselineFingerprint,
    })
  ) {
    invalid(
      "Retained handoff obligations or dependency identities do not match recomputed meaning.",
    );
  }
  return { id, manifest: raw, world, slice, compilation };
}

/** The expected id must come from the caller's retained assignment, not the receipt. */
export async function validateHandoffSnapshot(
  root: string,
  handoff: ImplementationHandoff,
  signal?: AbortSignal,
): Promise<ImplementationSnapshot> {
  const snapshot = await captureImplementationSnapshot(root, signal);
  const changed: string[] = [];
  for (const [path, hash] of Object.entries(handoff.manifest.protectedFiles)) {
    signal?.throwIfAborted();
    try {
      if (await protectedHash(root, path) !== hash) changed.push(path);
      const captured = snapshot.files.find((f) => f.path === path);
      if (captured && captured.hash !== hash) changed.push(path);
    } catch (error) {
      if (
        error instanceof Deno.errors.NotFound ||
        error instanceof SemanticInputError
      ) changed.push(path);
      else throw error;
    }
  }
  for (const file of snapshot.files) {
    if (
      automaticProtection(file.path, handoff.manifest.policy) &&
      !Object.hasOwn(handoff.manifest.protectedFiles, file.path)
    ) changed.push(file.path);
  }
  if (changed.length) {
    throw new SemanticInputError(
      "HANDOFF_INPUT_DRIFT",
      `Protected handoff inputs changed: ${sorted(changed).join(", ")}.`,
    );
  }
  return snapshot;
}
