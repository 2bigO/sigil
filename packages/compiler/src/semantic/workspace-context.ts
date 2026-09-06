import type { ResolvedSigilWorkspace } from "@qoherent/sigil-core";
import {
  createSemanticComponentRegistry,
  type SemanticComponentRegistry,
} from "./component-registry.ts";
import type { SemanticEngineOptions } from "./engine.ts";
import { projectSigilIntent, type SigilSemanticIntent } from "./source.ts";
import { readSemanticState, type StoredSemanticState } from "./store.ts";
import { type SemanticWorld, worldFromFacts } from "./turtle.ts";

export interface SemanticWorkspaceContext {
  readonly root: string;
  readonly resolved: ResolvedSigilWorkspace;
  readonly source: SigilSemanticIntent;
  readonly stored?: StoredSemanticState;
  readonly world: SemanticWorld;
  readonly sourceChanged: boolean;
  readonly registry: SemanticComponentRegistry;
  readonly receipt: {
    readonly sourceFingerprint: string;
    readonly canonicalFingerprint?: string;
  };
}

/**
 * Resolve authored intent and accepted meaning once. Generated views are not
 * inputs here; callers can inspect them separately without changing semantics.
 */
export async function createSemanticWorkspaceContext(options: {
  readonly root: string;
  readonly resolved: ResolvedSigilWorkspace;
  readonly engine?: SemanticEngineOptions;
}): Promise<SemanticWorkspaceContext> {
  const source = await projectSigilIntent(
    options.resolved.components,
    options.root,
    options.resolved.imports,
  );
  const stored = await readSemanticState(options.root, options.engine ?? {});
  const sourceChanged = !!stored &&
    stored.receipt.sourceFingerprint !== source.world.fingerprint;
  const world = !stored || sourceChanged ? source.world : await worldFromFacts(
    [...source.world.facts, ...stored.world.facts],
    { ...source.world.provenance, ...stored.world.provenance },
  );
  const registry = await createSemanticComponentRegistry({
    resolved: options.resolved,
    root: options.root,
    world,
    bindings: source.bindings,
    componentBindings: stored?.receipt.componentBindings,
  });
  return {
    root: options.root,
    resolved: options.resolved,
    source,
    stored,
    world,
    sourceChanged,
    registry,
    receipt: {
      sourceFingerprint: source.world.fingerprint,
      canonicalFingerprint: stored?.revision,
    },
  };
}
