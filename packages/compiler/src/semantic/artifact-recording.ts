import { writeCompileArtifact } from "./artifacts.ts";
import type { SemanticCompilation } from "./compile.ts";
import { serializeEggWorld } from "./egg-world.ts";
import type { SemanticEngineOptions } from "./engine.ts";
import type { ImplementationEvidence } from "./evidence.ts";
import { digest } from "./turtle.ts";

/** JSON output may omit optional undefined fields; identity hashes the actual bytes. */
export function artifactPayload(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilCompileArtifacts::ArtifactBundles interface
export async function recordSemanticStage(
  root: string,
  compilation: SemanticCompilation,
  options: {
    readonly stage: string;
    readonly sourceFingerprint: string;
    readonly evidence?: ImplementationEvidence;
    readonly mechanical?: SemanticEngineOptions;
    readonly extraFiles?: Readonly<Record<string, string>>;
  },
): Promise<string> {
  const mechanical: SemanticEngineOptions = options.mechanical ??
    options.evidence ?? {};
  const inputs = {
    observations: mechanical.observations ?? [],
    completeScopes: mechanical.completeScopes ?? [],
    requiredChecks: mechanical.requiredChecks ?? [],
    checks: mechanical.checks ?? [],
    receiptClaims: mechanical.receiptClaims ?? [],
    receiptLocations: mechanical.receiptLocations ?? [],
    symbolOwners: mechanical.symbolOwners ?? [],
    scopedObservations: mechanical.scopedObservations ?? [],
  };
  const files: Record<string, string> = {
    "assertions.egg": serializeEggWorld(compilation.world),
    "closure.json": artifactPayload(compilation.closure),
    "diagnostics.json": artifactPayload(compilation.diagnostics),
    "inputs.json": artifactPayload(inputs),
  };
  if (options.evidence) {
    files["observations.egg"] = serializeEggWorld(options.evidence.world);
    files["evidence.json"] = artifactPayload({
      ...options.evidence,
      world: undefined,
    });
  }
  for (const [name, text] of Object.entries(options.extraFiles ?? {})) {
    if (Object.hasOwn(files, name)) {
      throw new Error("Duplicate semantic stage payload name.");
    }
    files[name] = text;
  }
  const artifact = await writeCompileArtifact(root, {
    kind: "cache",
    dependencies: {
      world: compilation.world.fingerprint,
      source: options.sourceFingerprint,
      kernel: compilation.closure.kernelFingerprint,
      mechanical: await digest(files["inputs.json"]),
      ...(options.evidence
        ? { analysis: options.evidence.inputFingerprint }
        : {}),
    },
    files,
    metadata: { stage: options.stage, status: compilation.status },
  });
  return artifact.id;
}

/** Stored result data is inspectable provenance, never a reusable proof authority. */
// @sigil implements packages/compiler/src/semantic/_module.sigil::SigilCompileArtifacts::ArtifactBundles interface
export async function recordCompilationRun(
  root: string,
  report: unknown,
  dependencies: Readonly<Record<string, string>>,
): Promise<string> {
  return (await writeCompileArtifact(root, {
    kind: "runs",
    dependencies,
    files: { "report.json": artifactPayload(report) },
    metadata: { role: "computed-result" },
  })).id;
}
