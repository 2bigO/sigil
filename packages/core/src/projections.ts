import type {
  AgentDependencyContext,
  CollectedExpansion,
  ComponentContractView,
  DependencyDecisionView,
  ResolvedComponent,
  ResolvedConceptNamespace,
  ResolvedSigilWorkspace,
} from "./model.ts";

// @sigil implements packages/core/src/projections.sigil::SigilProjections::ContractProjection interface,logic,cases
export function componentContracts(
  resolved: ResolvedSigilWorkspace,
): readonly ComponentContractView[] {
  return resolved.components.map(componentContractView);
}

// @sigil implements packages/core/src/projections.sigil::SigilProjections::ConceptNamespaceProjection interface,logic,cases
export function conceptNamespaceFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
): ResolvedConceptNamespace | undefined {
  return resolved.components.find((component) =>
    component.name === componentName
  )?.conceptNamespace;
}

// @sigil implements packages/core/src/projections.sigil::SigilProjections::ExpansionProjection interface,logic,cases
export function collectedExpansionFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
): CollectedExpansion | undefined {
  return resolved.components.find((component: ResolvedComponent) =>
    component.name === componentName
  )?.expansions;
}

// @sigil implements packages/core/src/projections.sigil::SigilProjections::AgentDependencyContext interface,logic,constraints,cases
export function agentDependencyContextFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
): AgentDependencyContext | undefined {
  const selectedComponent = resolved.components.find((component) =>
    component.name === componentName
  );
  if (!selectedComponent) return undefined;

  const dependencies: ResolvedComponent[] = [];
  const seen = new Set<string>();
  for (
    const resolvedImport of resolved.imports.filter((item) =>
      item.sourceFile === selectedComponent.filePath
    )
  ) {
    for (const importedName of resolvedImport.names) {
      if (!importedName.component || !importedName.componentFile) continue;
      const key = `${importedName.componentFile}\0${importedName.name}`;
      if (seen.has(key)) continue;
      const dependency = resolved.components.find((component) =>
        component.name === importedName.name &&
        component.filePath === importedName.componentFile
      );
      if (!dependency) continue;
      seen.add(key);
      dependencies.push(dependency);
    }
  }

  const dependencyDecisions: DependencyDecisionView[] = dependencies.flatMap(
    (dependency) =>
      dependency.expansions.expands.flatMap((expansion) =>
        expansion.declaration.sections
          .filter((section) => section.name === "decisions")
          .map((section) => ({
            componentName: dependency.name,
            filePath: expansion.filePath,
            section,
          }))
      ),
  );
  const dependencyContracts = dependencies.map(componentContractView);
  const relatedFilePaths = [
    ...new Set([
      selectedComponent.filePath,
      ...selectedComponent.expansions.expands.map((item) => item.filePath),
      ...dependencyContracts.map((contract) => contract.filePath),
      ...dependencyDecisions.map((decision) => decision.filePath),
    ]),
  ].sort();

  return {
    selectedComponent,
    collectedExpansion: selectedComponent.expansions,
    dependencyContracts,
    dependencyDecisions,
    relatedFilePaths,
  };
}

function componentContractView(
  component: ResolvedComponent,
): ComponentContractView {
  const goal = component.declaration.sections.find((section) =>
    section.name === "goal"
  );
  const iface = component.declaration.sections.find((section) =>
    section.name === "interface"
  );
  return {
    name: component.name,
    filePath: component.filePath,
    goalLines: goal?.units.map((unit) => unit.prose) ?? [],
    interfaceLines: iface?.units.map((unit) => unit.prose) ?? [],
    ungroupedInterfaceLines:
      iface?.units.filter((unit) => unit.conceptIdentifier === undefined).map((
        unit,
      ) => unit.prose) ?? [],
    interfaceConcepts: iface?.concepts.map((concept) => ({
      identifier: concept.identifier,
      lines: concept.units.map((unit) => unit.prose),
      sourceRange: concept.range,
    })) ?? [],
  };
}
