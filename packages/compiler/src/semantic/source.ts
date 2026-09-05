import type {
  ResolvedComponent,
  ResolvedImport,
  SemanticUnit,
  SigilSectionName,
  SourceRange,
} from "@qoherent/sigil-core";
import { canonicalWorkspacePath } from "../compilation-target.ts";
import { TurtleBuilder } from "./builder.ts";
import { digest, parseSemanticWorld, type SemanticWorld } from "./turtle.ts";

export interface SemanticSourceBinding {
  readonly componentName: string;
  readonly componentId: string;
  readonly filePath: string;
  readonly range: SourceRange;
  readonly section?: SigilSectionName;
  readonly concept?: string;
  readonly unit?: SemanticUnit;
  /** Repeated identical assertions share meaning without losing physical origins. */
  readonly additionalLocations?: readonly SemanticSourceBinding[];
}

export interface SigilSemanticIntent {
  readonly world: SemanticWorld;
  readonly bindings: Readonly<Record<string, SemanticSourceBinding>>;
}

export function semanticComponentId(
  component: Pick<ResolvedComponent, "name" | "filePath">,
  root: string,
): string {
  return `urn:sigil:component:${
    encodeURIComponent(canonicalWorkspacePath(component.filePath, root))
  }:${encodeURIComponent(component.name)}`;
}

/** Extract structural assertions. Free prose becomes required interpretation work. */
export async function projectSigilIntent(
  components: readonly ResolvedComponent[],
  root: string,
  imports: readonly ResolvedImport[] = [],
): Promise<SigilSemanticIntent> {
  const builder = new TurtleBuilder();
  const bindings: Record<string, SemanticSourceBinding> = {};
  for (const component of components) {
    const id = semanticComponentId(component, root);
    const binding = {
      componentName: component.name,
      componentId: id,
      filePath: canonicalWorkspacePath(component.filePath, root),
      range: component.declaration.range,
    };
    bindings[id] = binding;
    builder.type(id, "Component").value(id, "label", component.name);
    const forms = [{
      filePath: component.filePath,
      declaration: component.declaration,
    }, ...component.expansions.expands];
    for (const form of forms) {
      const path = canonicalWorkspacePath(form.filePath, root);
      for (const section of form.declaration.sections) {
        for (const unit of section.units) {
          const identity = await digest(
            JSON.stringify([
              id,
              path,
              form.declaration.kind,
              section.name,
              unit.conceptIdentifier ?? "",
              unit.prose,
              unit.literalBlocks.map((b) => [b.type, b.body]),
            ]),
          );
          const contract = `urn:sigil:contract:${identity}`;
          builder.type(contract, "Contract").value(contract, "required", true)
            .value(contract, "section", section.name).value(
              contract,
              "description",
              unit.prose,
            )
            .edge(id, "hasContract", contract);
          if (unit.conceptIdentifier) {
            builder.value(contract, "label", unit.conceptIdentifier);
          }
          const sourceBinding: SemanticSourceBinding = {
            ...binding,
            filePath: path,
            range: unit.range,
            section: section.name,
            concept: unit.conceptIdentifier,
            unit,
          };
          const prior = bindings[contract];
          bindings[contract] = prior
            ? {
              ...prior,
              additionalLocations: [
                ...(prior.additionalLocations ?? []),
                sourceBinding,
              ],
            }
            : sourceBinding;
        }
      }
    }
    for (const imported of imports) {
      if (!forms.some((form) => form.filePath === imported.sourceFile)) {
        continue;
      }
      for (const importedName of imported.names) {
        if (
          !importedName.component || !importedName.componentFile ||
          !importedName.uses.some((use) => use.ownerName === component.name)
        ) continue;
        const target = semanticComponentId({
          name: importedName.name,
          filePath: importedName.componentFile,
        }, root);
        if (id !== target) builder.edge(id, "dependsOn", target);
      }
    }
  }
  const world = await parseSemanticWorld([{
    sourceId: "sigil-structural-intent",
    turtle: builder.toString(),
    producer: "projection",
  }]);
  return { world, bindings };
}
