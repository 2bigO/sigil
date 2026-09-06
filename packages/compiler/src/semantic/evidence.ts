import { isAbsolute, resolve } from "node:path";
import {
  type ImplementationSource,
  type OwnedImplementationTarget,
  ownedImplementationTargetsFor,
  type ResolvedSigilWorkspace,
} from "@qoherent/sigil-core";
import { semanticComponentId } from "./source.ts";
import { TurtleBuilder } from "./builder.ts";
import type {
  MechanicalCheck,
  MechanicalObservation,
  MechanicalScope,
} from "./engine.ts";
import {
  analyzeTypeScript7,
  type CodeLocation,
  type TypeScriptAnalysis,
  type TypeScriptAnalysisOptions,
  type TypeScriptCall,
} from "./typescript7.ts";
import { digest, parseSemanticWorld, type SemanticWorld } from "./turtle.ts";

/** Host-owned bindings, frozen before proposing code. These select observations,
 * never author laws or declare an obligation satisfied. Paths are exact inventories. */
export interface ImplementationPolicy {
  readonly version: 1;
  readonly project: string;
  readonly components: readonly {
    readonly entity: string;
    readonly files: readonly string[];
    /** Host asserts that this inventory includes every implementation file. */
    readonly exhaustive?: boolean;
  }[];
  readonly targets: readonly {
    readonly entity: string;
    readonly modules?: readonly string[];
    readonly declarations?: readonly {
      readonly file: string;
      readonly symbol?: string;
    }[];
    readonly globals?: readonly string[];
    /** Optional API catalog classification of direct calls. */
    readonly access?: "reads" | "writes";
  }[];
  /** Host-selected checks and their exact protected test-oracle inputs. */
  readonly checks?: readonly ImplementationCheckCommand[];
  readonly protectedFiles?: readonly string[];
}

export interface ImplementationCheckCommand {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly files: readonly string[];
  readonly timeoutMs?: number;
}

export interface EvidenceReceipt {
  readonly producer: "typescript@7.0.2";
  readonly inputFingerprint: string;
  readonly kind: "dependency" | "call" | "complete-dependencies" | "typecheck";
  readonly locations: readonly CodeLocation[];
  readonly files: readonly {
    readonly file: string;
    readonly fingerprint: string;
  }[];
  readonly details?: string;
}

export interface ImplementationEvidence {
  readonly version: 1;
  readonly inputFingerprint: string;
  /** Documentary RDF observations. Never merge into canonical design assertions. */
  readonly world: SemanticWorld;
  readonly observations: readonly MechanicalObservation[];
  readonly completeScopes: readonly MechanicalScope[];
  readonly requiredChecks: readonly string[];
  readonly checks: readonly MechanicalCheck[];
  readonly receipts: Readonly<Record<string, EvidenceReceipt>>;
  readonly analysis: TypeScriptAnalysis;
  /** Ownership annotations are claims, never blanket implementation proof. */
  readonly anchors: readonly ImplementationAnchorClaim[];
  readonly incomplete: readonly {
    readonly subject: string;
    readonly reason: string;
  }[];
}

export interface ImplementationAnchorClaim {
  readonly component: string;
  readonly target: OwnedImplementationTarget;
}

export function implementationAnchorClaims(
  resolved: ResolvedSigilWorkspace,
  sources: readonly ImplementationSource[],
): readonly ImplementationAnchorClaim[] {
  return resolved.components.flatMap((component) => {
    const projection = ownedImplementationTargetsFor(resolved, sources, {
      componentName: component.name,
      declarationPath: component.filePath,
    });
    if (
      projection?.diagnostics.some((diagnostic) =>
        diagnostic.severity === "error"
      )
    ) return [];
    return (projection?.targets ?? []).map((target) => ({
      component: semanticComponentId(component, resolved.workspace.root),
      target,
    }));
  });
}

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error("Invalid implementation policy object or unknown field.");
  }
  return value as Record<string, unknown>;
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096;
}
function entity(value: unknown): value is string {
  return nonempty(value) && /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
}
function path(value: unknown): value is string {
  return nonempty(value) && !isAbsolute(value) && !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}
function strings(value: unknown, predicate = nonempty): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 10_000 &&
    value.every(predicate) && new Set(value).size === value.length;
}

export function parseImplementationPolicy(
  input: unknown,
): ImplementationPolicy {
  const value = record(input, [
    "version",
    "project",
    "components",
    "targets",
    "checks",
    "protectedFiles",
  ]);
  if (
    value.version !== 1 || !path(value.project) ||
    !Array.isArray(value.components) || value.components.length > 1000 ||
    !Array.isArray(value.targets) || value.targets.length > 1000
  ) {
    throw new Error(
      "Invalid implementation policy version, project or inventories.",
    );
  }
  const components = value.components.map((raw) => {
    const item = record(raw, ["entity", "files", "exhaustive"]);
    if (
      !entity(item.entity) || !strings(item.files, path) ||
      item.exhaustive !== undefined && typeof item.exhaustive !== "boolean"
    ) {
      throw new Error("Invalid implementation component binding.");
    }
    return item;
  });
  if (
    new Set(components.map((item) => item.entity)).size !== components.length
  ) {
    throw new Error("Duplicate implementation component binding.");
  }
  for (const raw of value.targets) {
    const item = record(raw, [
      "entity",
      "modules",
      "declarations",
      "globals",
      "access",
    ]);
    if (
      !entity(item.entity) ||
      item.modules !== undefined && !strings(item.modules) ||
      item.globals !== undefined &&
        !strings(item.globals, (name): name is string =>
          nonempty(name) &&
          /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name)) ||
      item.access !== undefined &&
        !["reads", "writes"].includes(String(item.access))
    ) {
      throw new Error("Invalid implementation target binding.");
    }
    if (item.declarations !== undefined) {
      if (
        !Array.isArray(item.declarations) || !item.declarations.length ||
        item.declarations.length > 10_000
      ) {
        throw new Error("Invalid implementation declaration bindings.");
      }
      for (const raw of item.declarations) {
        const declaration = record(raw, ["file", "symbol"]);
        if (
          !path(declaration.file) ||
          declaration.symbol !== undefined && !nonempty(declaration.symbol)
        ) {
          throw new Error("Invalid implementation declaration binding.");
        }
      }
    }
    if (!item.modules && !item.globals && !item.declarations) {
      throw new Error(
        "An implementation target needs a module, declaration or global selector.",
      );
    }
  }
  if (
    value.protectedFiles !== undefined && !strings(value.protectedFiles, path)
  ) {
    throw new Error("Invalid protected file inventory.");
  }
  if (value.checks !== undefined) {
    if (!Array.isArray(value.checks) || value.checks.length > 32) {
      throw new Error("Invalid required checks.");
    }
    const ids = new Set<string>();
    for (const raw of value.checks) {
      const check = record(raw, [
        "id",
        "command",
        "args",
        "files",
        "timeoutMs",
      ]);
      if (
        !nonempty(check.id) ||
        check.id.startsWith("urn:sigil:check:typescript7:") ||
        ids.has(check.id) ||
        !nonempty(check.command) || !Array.isArray(check.args) ||
        check.args.length > 256 ||
        check.args.some((arg) =>
          typeof arg !== "string" || arg.length > 8192 || arg.includes("\0")
        ) ||
        !strings(check.files, path) || check.timeoutMs !== undefined &&
          (!Number.isSafeInteger(check.timeoutMs) ||
            Number(check.timeoutMs) <= 0 ||
            Number(check.timeoutMs) > 2_147_483_647)
      ) {
        throw new Error(
          "Invalid host check identity, command or protected oracle files.",
        );
      }
      ids.add(check.id);
    }
  }
  return value as unknown as ImplementationPolicy;
}

export async function readImplementationPolicy(
  root: string,
): Promise<ImplementationPolicy | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(resolve(root, ".sigil/implementation.json"));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  if (text.length > 1024 * 1024) {
    throw new Error("Implementation policy exceeds the 1 MiB limit.");
  }
  return parseImplementationPolicy(JSON.parse(text));
}

function callMatches(
  call: TypeScriptCall,
  target: ImplementationPolicy["targets"][number],
  analysis: TypeScriptAnalysis,
): boolean {
  if (call.global && target.globals?.includes(call.global)) return true;
  if (!call.declaration) return false;
  if (
    target.declarations?.some((selector) =>
      selector.file === call.declaration!.file &&
      (!selector.symbol || selector.symbol === call.targetSymbol)
    )
  ) return true;
  return analysis.dependencies.some((dependency) =>
    dependency.file === call.file &&
    target.modules?.includes(dependency.specifier) &&
    dependency.resolvedFile === call.declaration!.file
  );
}

/** Static direct dependencies and resolved call sites, not a runtime effect proof.
 * Only a host-declared exhaustive, closed inventory can certify absent dependencies.
 * Calls, API effects and arbitrary behavior never receive an absence certificate. */
export async function collectImplementationEvidence(
  options: Omit<TypeScriptAnalysisOptions, "project"> & {
    readonly policy: ImplementationPolicy;
    readonly resolved?: ResolvedSigilWorkspace;
  },
): Promise<ImplementationEvidence> {
  const policy = parseImplementationPolicy(options.policy);
  const analysis = await analyzeTypeScript7({
    ...options,
    project: policy.project,
  });
  const sources: ImplementationSource[] = [];
  for (const file of analysis.files) {
    options.signal?.throwIfAborted();
    const filePath = resolve(options.root, file.file);
    const text = await Deno.readTextFile(filePath);
    if (await digest(text) !== file.fingerprint) {
      throw new Error(
        `Implementation changed during TypeScript analysis: ${file.file}.`,
      );
    }
    sources.push({ filePath, text });
  }
  const anchors = options.resolved
    ? implementationAnchorClaims(options.resolved, sources)
    : [];
  const inputFingerprint = await digest(
    JSON.stringify({ policy, analysis: analysis.fingerprint, anchors }),
  );
  const observations: MechanicalObservation[] = [];
  const completeScopes: MechanicalScope[] = [];
  const receipts: Record<string, EvidenceReceipt> = {};
  const incomplete: { subject: string; reason: string }[] = [];
  const builder = new TurtleBuilder();
  const fileByName = new Map(analysis.files.map((file) => [file.file, file]));
  const receipt = async (
    kind: EvidenceReceipt["kind"],
    locations: readonly CodeLocation[],
    files: readonly string[],
    details?: string,
  ) => {
    const value: EvidenceReceipt = {
      producer: analysis.analyzer,
      inputFingerprint,
      kind,
      locations,
      files: [...new Set(files)].sort().flatMap((file) => {
        const source = fileByName.get(file);
        return source ? [{ file, fingerprint: source.fingerprint }] : [];
      }),
      details,
    };
    const id = `urn:sigil:evidence:${await digest(JSON.stringify(value))}`;
    receipts[id] = value;
    builder.type(id, "Evidence");
    return id;
  };
  const observe = (
    subject: string,
    predicate: string,
    object: string,
    evidence: string,
  ) => {
    observations.push({ subject, predicate, object, evidence });
    builder.edge(subject, predicate, object).edge(evidence, "from", subject)
      .value(evidence, "relation", predicate).edge(evidence, "target", object);
  };
  const typecheckId = `urn:sigil:check:typescript7:${
    encodeURIComponent(policy.project)
  }`;
  const typecheckEvidence = await receipt(
    "typecheck",
    [],
    analysis.files.map((file) => file.file),
    JSON.stringify(analysis.diagnostics),
  );
  const checks = [{
    id: typecheckId,
    passed: !analysis.diagnostics.some((d) => d.category === 1),
    evidence: typecheckEvidence,
  }];
  builder.value(typecheckEvidence, "passes", checks[0].passed).edge(
    typecheckEvidence,
    "evidenceFor",
    typecheckId,
  );
  for (const component of policy.components) {
    options.signal?.throwIfAborted();
    const files = new Set(component.files);
    const missing = component.files.filter((file) =>
      !fileByName.has(file) || fileByName.get(file)!.declaration
    );
    if (missing.length) {
      incomplete.push({
        subject: component.entity,
        reason:
          `Implementation files absent from the executable TypeScript snapshot: ${
            missing.join(", ")
          }.`,
      });
    }
    const dependencies = analysis.dependencies.filter((d) => files.has(d.file));
    for (const dependency of dependencies) {
      for (const target of policy.targets) {
        if (
          target.modules?.includes(dependency.specifier) ||
          target.declarations?.some((selector) =>
            selector.file === dependency.resolvedFile
          )
        ) {
          const id = await receipt("dependency", [dependency], [
            dependency.file,
          ], `${component.entity} dependsOn ${target.entity}`);
          observe(component.entity, "dependsOn", target.entity, id);
        }
      }
    }
    for (const call of analysis.calls.filter((call) => files.has(call.file))) {
      if (
        analysis.issues.some((issue) =>
          issue.file === call.file && issue.start === call.start &&
          issue.reason === "indirect-call"
        )
      ) continue;
      for (
        const target of policy.targets.filter((target) =>
          callMatches(call, target, analysis)
        )
      ) {
        for (
          const predicate of [
            "invokes",
            "uses",
            ...(target.access ? [target.access] : []),
          ]
        ) {
          const locations = [
            call,
            ...(call.declaration ? [call.declaration] : []),
          ];
          const id = await receipt(
            "call",
            locations,
            locations.map((location) => location.file),
            `${component.entity} ${predicate} ${target.entity}`,
          );
          observe(component.entity, predicate, target.entity, id);
        }
      }
    }
    // Stay open in the presence of errors, opaque calls, unknown imports or an
    // incomplete inventory. A successful typecheck alone never proves a negative.
    const closed = component.exhaustive && !missing.length &&
      checks[0].passed &&
      !analysis.issues.some((issue) => files.has(issue.file)) &&
      dependencies.every((dependency) => !!dependency.resolvedFile);
    if (closed) {
      for (const target of policy.targets) {
        if (
          target.globals?.length ||
          (!target.modules?.length && !target.declarations?.length)
        ) continue;
        const id = await receipt(
          "complete-dependencies",
          [],
          component.files,
          `Complete static direct dependency inventory for ${component.entity} and ${target.entity}.`,
        );
        completeScopes.push({
          subject: component.entity,
          predicate: "dependsOn",
          object: target.entity,
          evidence: id,
        });
        builder.edge(id, "from", component.entity).value(
          id,
          "relation",
          "dependsOn",
        ).edge(id, "target", target.entity);
      }
    } else {incomplete.push({
        subject: component.entity,
        reason:
          "No complete dependency scope: inventory is partial, or TypeScript reports errors, opaque calls or unresolved imports.",
      });}
  }
  const world = await parseSemanticWorld([{
    sourceId: `mechanical:${inputFingerprint}`,
    turtle: builder.toString(),
  }]);
  return {
    version: 1,
    inputFingerprint,
    world,
    observations,
    completeScopes,
    requiredChecks: [
      typecheckId,
      ...policy.checks?.map((check) => check.id) ?? [],
    ],
    checks,
    receipts,
    analysis,
    incomplete,
    anchors,
  };
}
