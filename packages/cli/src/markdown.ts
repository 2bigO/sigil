import type {
  CollectedExpansion,
  ComponentContractView,
  ResolvedComponent,
  ResolvedConceptNamespace,
  SigilDiagnostic,
} from "@qoherent/sigil-core";
import type { CoreAdapter } from "./core-adapter.ts";
import type { ContextCommandResult } from "./output-model.ts";

export function renderWorkspaceMarkdown(
  resolved: Awaited<ReturnType<CoreAdapter["resolveWorkspace"]>>,
  core: CoreAdapter,
): string {
  const lines = [
    "# Sigil Workspace",
    "",
    `Workspace root: ${resolved.workspace.root}`,
    `Workspace: ${resolved.workspace.config?.workspace.name ?? "unresolved"}`,
    `Sigil: ${resolved.workspace.config?.sigilVersion ?? "unresolved"}`,
    "",
  ];
  for (const contract of core.componentContracts(resolved)) {
    lines.push(...formatComponentContract(contract));
    const expansion = core.collectedExpansionFor(resolved, contract.name);
    if (expansion?.expands.length) {
      lines.push(...formatCollectedExpansion(expansion));
    }
    lines.push("");
  }
  lines.push(...formatDiagnostics("## Diagnostics", resolved.diagnostics));
  return `${lines.join("\n")}\n`;
}

export function renderContextMarkdown(result: ContextCommandResult): string {
  const lines = [
    "# Sigil Context",
    "",
    `Workspace root: ${result.workspaceRoot}`,
    `Workspace: ${result.workspaceName ?? "unresolved"}`,
    `Sigil: ${result.sigilVersion ?? "unresolved"}`,
    "",
  ];

  if (!result.selectedComponents.length) {
    lines.push(
      "## Selection",
      "",
      "- No context matched the requested component or file.",
      "",
    );
  } else {
    for (const [index, component] of result.selectedComponents.entries()) {
      const contract = result.componentContracts.find((item) =>
        item.name === component.name && item.filePath === component.filePath
      ) ?? result.componentContracts.find((item) =>
        item.name === component.name
      );
      lines.push(
        `## ${component.name}`,
        "",
        `Source: ${component.filePath}`,
        "",
      );
      if (contract) {
        lines.push(...formatContractBody(contract));
      } else {
        lines.push("### Contract", "", "- none");
      }

      const expansion = expansionForComponent(result, component, index);
      if (expansion?.expands.length) {
        lines.push(...formatCollectedExpansion(expansion));
      }

      const conceptNamespace = conceptNamespaceForComponent(
        result,
        component,
        index,
      );
      if (conceptNamespace) {
        lines.push(...formatConceptNamespace(conceptNamespace));
      }

      const dependencyContext = agentDependencyContextForComponent(
        result,
        component,
        index,
      );
      if (dependencyContext) {
        lines.push(...formatAgentDependencyContext(dependencyContext));
      }

      const ownershipProjection = ownedImplementationProjectionForComponent(
        result,
        component,
        index,
      );
      if (ownershipProjection) {
        lines.push(...formatOwnedImplementationProjection(ownershipProjection));
      }

      lines.push("");
    }
  }

  if (isContextResultWithDependents(result)) {
    const dependentContexts = result.agentDependentContexts;
    if (dependentContexts.length) {
      lines.push("## Importing Files", "");
      for (const context of dependentContexts) {
        lines.push(`### ${context.selectedComponent.name}`, "");
        if (!context.importingFiles.length) {
          lines.push("- none", "");
          continue;
        }
        for (const importingFile of context.importingFiles) {
          lines.push(`- ${importingFile.filePath}`);
          lines.push(
            `  - Imported component: ${importingFile.importedComponent.name} (${importingFile.importedComponent.filePath})`,
          );
          for (const edge of importingFile.importEdges) {
            lines.push(
              `  - Import edge: ${edge.sourceFile} imports ${edge.componentName} from ${edge.targetFile} via ${edge.importPath}`,
            );
          }
          if (importingFile.contextualContracts.length) {
            lines.push("  - Contextual contracts:");
            for (const contract of importingFile.contextualContracts) {
              lines.push(`    - ${contract.name} (${contract.filePath})`);
            }
          } else {
            lines.push("  - Contextual contracts: none");
          }
        }
        lines.push("");
      }
    }
  }

  lines.push("## Related Files", "");
  lines.push(...formatList(result.relatedFilePaths));
  lines.push("");

  if (result.glossaryContext) {
    lines.push("## Glossary Context", "");
    lines.push(`Glossary: ${result.glossaryContext.glossaryPath ?? "absent"}`);
    lines.push("");
    lines.push("### Terms");
    lines.push(
      ...formatList(
        result.glossaryContext.terms.map((term) =>
          `${term.term}: ${term.definition}`
        ),
      ),
    );
    lines.push("");
    lines.push("### Occurrences");
    lines.push(...formatList(result.glossaryContext.occurrences.map((
      occurrence,
    ) =>
      `${occurrence.filePath}:${occurrence.range.start.line}:${occurrence.range.start.column} ${occurrence.matchedSpelling} -> ${occurrence.term.term}`
    )));
    lines.push("");
  }

  lines.push(...formatDiagnostics("## Diagnostics", result.diagnostics));
  return `${lines.join("\n")}\n`;
}

function formatComponentContract(contract: ComponentContractView): string[] {
  return formatComponentContractAtLevel(contract, 2);
}

function formatComponentContractAtLevel(
  contract: ComponentContractView,
  headingLevel: number,
): string[] {
  return [
    `${heading(headingLevel)} ${contract.name}`,
    "",
    `Source: ${contract.filePath}`,
    "",
    ...formatContractBody(contract, headingLevel + 1),
  ];
}

function formatContractBody(
  contract: ComponentContractView,
  headingLevel = 3,
): string[] {
  const lines = [
    `${heading(headingLevel)} Goal`,
    ...formatList(contract.goalLines),
    "",
    `${heading(headingLevel)} Interface`,
  ];
  if (contract.ungroupedInterfaceLines.length) {
    lines.push(...formatList(contract.ungroupedInterfaceLines));
  } else if (!contract.interfaceConcepts.length) {
    lines.push("- none");
  }
  for (const concept of contract.interfaceConcepts) {
    lines.push(
      "",
      `${heading(headingLevel + 1)} ${concept.identifier}`,
      ...formatList(concept.lines),
    );
  }
  return lines;
}

function formatCollectedExpansion(expansion: CollectedExpansion): string[] {
  const lines = ["", "### Expansions"];
  for (const item of expansion.expands) {
    lines.push("", `Source: ${item.filePath}`);
    for (const section of item.declaration.sections) {
      lines.push(
        "",
        `#### ${section.name}`,
        ...formatList(section.lines.map((line) => line.text)),
      );
    }
  }
  return lines;
}

function formatAgentDependencyContext(
  context: ContextCommandResult["agentDependencyContexts"][number],
): string[] {
  const lines = ["", "### Direct Dependencies"];
  if (!context.dependencyContracts.length) {
    lines.push("- none");
  } else {
    const renderedDecisionIndexes = new Set<number>();
    for (const contract of context.dependencyContracts) {
      lines.push("", ...formatComponentContractAtLevel(contract, 4));
      const decisions = context.dependencyDecisions
        .map((decision, index) => ({ decision, index }))
        .filter(({ decision }) => decision.componentName === contract.name);
      lines.push("", "##### Dependency Decisions");
      if (!decisions.length) {
        lines.push("- none");
      } else {
        for (const { decision, index } of decisions) {
          renderedDecisionIndexes.add(index);
          lines.push(`- ${decision.filePath}`);
          for (const line of decision.section.lines) {
            lines.push(`  - ${line.text}`);
          }
        }
      }
    }
    const unassociatedDecisions = context.dependencyDecisions
      .map((decision, index) => ({ decision, index }))
      .filter(({ index }) => !renderedDecisionIndexes.has(index));
    if (unassociatedDecisions.length) {
      lines.push("", "#### Other Dependency Decisions");
      for (const { decision } of unassociatedDecisions) {
        lines.push(`- ${decision.componentName} (${decision.filePath})`);
        for (const line of decision.section.lines) {
          lines.push(`  - ${line.text}`);
        }
      }
    }
  }
  return lines;
}

function formatConceptNamespace(
  namespace: ResolvedConceptNamespace,
): string[] {
  const lines = ["", "### Concept Namespace"];
  lines.push("", "#### Public Concepts");
  lines.push(...formatConcepts(namespace.publicConcepts));
  lines.push("", "#### Accessible Concepts");
  lines.push(...formatConcepts(namespace.accessibleConcepts));
  lines.push("", "#### Declared Concepts");
  lines.push(...formatConcepts(namespace.concepts));
  lines.push("", "#### References");
  if (!namespace.references.length) {
    lines.push("- none");
  } else {
    for (const reference of namespace.references) {
      lines.push(
        `- ${reference.conceptIdentity.identifier} from ${reference.conceptIdentity.componentName} (${reference.conceptIdentity.filePath}) referenced by ${reference.ownerKind} ${reference.ownerName} ${reference.sectionName} in ${reference.filePath}`,
      );
    }
  }
  return lines;
}

function formatConcepts(
  concepts: ResolvedConceptNamespace["concepts"],
): string[] {
  if (!concepts.length) return ["- none"];
  return concepts.map((concept) => {
    const visibility = concept.isPublic ? "public" : "private";
    const origin = concept.isImported ? "imported" : "declared";
    const occurrences = concept.occurrences
      .map((occurrence) =>
        `${occurrence.ownerKind} ${occurrence.componentName} ${occurrence.sectionName} in ${occurrence.filePath}`
      )
      .join("; ");
    return `- ${concept.identifier} (${concept.identity.componentName}, ${concept.identity.filePath}; ${visibility}, ${origin})${
      occurrences ? `: ${occurrences}` : ""
    }`;
  });
}

function formatOwnedImplementationProjection(
  projection: ContextCommandResult["ownedImplementationProjections"][number],
): string[] {
  const lines = ["", "### Owned Implementation Targets"];
  if (!projection.targets.length) {
    lines.push("- none");
  } else {
    for (const target of projection.targets) {
      const sections = target.sections.length
        ? ` [${target.sections.join(", ")}]`
        : "";
      const symbol = target.symbolIdentity ? ` ${target.symbolIdentity}` : "";
      lines.push(
        `- ${target.relation}${sections}: ${target.filePath}${symbol}`,
      );
    }
  }
  if (projection.diagnostics.length) {
    lines.push("", "#### Ownership Diagnostics");
    for (const diagnostic of projection.diagnostics) {
      lines.push(`- ${formatDiagnostic(diagnostic)}`);
    }
  }
  return lines;
}

function formatDiagnostics(
  heading: string,
  diagnostics: readonly SigilDiagnostic[],
): string[] {
  const lines = [heading, ""];
  if (!diagnostics.length) lines.push("- none");
  else {
    for (const item of diagnostics) {
      lines.push(`- ${formatDiagnostic(item)}`);
    }
  }
  return lines;
}

function formatDiagnostic(diagnostic: SigilDiagnostic): string {
  const location = diagnostic.filePath ? ` ${diagnostic.filePath}` : "";
  return `${diagnostic.severity} ${diagnostic.code}${location}: ${diagnostic.message}`;
}

function formatList(lines: readonly string[]): string[] {
  return lines.length ? lines.map((line) => `- ${line}`) : ["- none"];
}

function heading(level: number): string {
  return "#".repeat(level);
}

function expansionForComponent(
  result: ContextCommandResult,
  component: ResolvedComponent,
  index: number,
): CollectedExpansion | undefined {
  if (component.expansions.componentName === component.name) {
    return component.expansions;
  }
  const indexed = result.collectedExpansions[index];
  if (indexed?.componentName === component.name) return indexed;
  return result.collectedExpansions.find((item) =>
    item.componentName === component.name
  );
}

function conceptNamespaceForComponent(
  result: ContextCommandResult,
  component: ResolvedComponent,
  index: number,
): ResolvedConceptNamespace | undefined {
  if (namespaceMatchesComponent(component.conceptNamespace, component)) {
    return component.conceptNamespace;
  }
  const indexed = result.conceptNamespaces[index];
  if (indexed && namespaceMatchesComponent(indexed, component)) return indexed;
  return result.conceptNamespaces.find((namespace) =>
    namespaceMatchesComponent(namespace, component)
  ) ?? result.conceptNamespaces.find((namespace) =>
    namespace.componentName === component.name
  );
}

function agentDependencyContextForComponent(
  result: ContextCommandResult,
  component: ResolvedComponent,
  index: number,
): ContextCommandResult["agentDependencyContexts"][number] | undefined {
  const indexed = result.agentDependencyContexts[index];
  if (
    indexed && componentIdentityMatches(indexed.selectedComponent, component)
  ) {
    return indexed;
  }
  return result.agentDependencyContexts.find((item) =>
    componentIdentityMatches(item.selectedComponent, component)
  ) ?? result.agentDependencyContexts.find((item) =>
    item.selectedComponent.name === component.name
  );
}

function ownedImplementationProjectionForComponent(
  result: ContextCommandResult,
  component: ResolvedComponent,
  index: number,
): ContextCommandResult["ownedImplementationProjections"][number] | undefined {
  const indexed = result.ownedImplementationProjections[index];
  if (
    indexed && componentIdentityMatches(indexed.owningComponent, component)
  ) {
    return indexed;
  }
  return result.ownedImplementationProjections.find((item) =>
    componentIdentityMatches(item.owningComponent, component)
  ) ?? result.ownedImplementationProjections.find((item) =>
    item.owningComponent.name === component.name
  );
}

function componentIdentityMatches(
  left: Pick<ResolvedComponent, "name" | "filePath">,
  right: Pick<ResolvedComponent, "name" | "filePath">,
): boolean {
  return left.name === right.name && left.filePath === right.filePath;
}

function namespaceMatchesComponent(
  namespace: ResolvedConceptNamespace,
  component: ResolvedComponent,
): boolean {
  if (namespace.componentName !== component.name) return false;
  return [
    ...namespace.concepts,
    ...namespace.accessibleConcepts,
    ...namespace.publicConcepts,
  ].some((concept) =>
    concept.identity.componentName === component.name &&
    concept.identity.filePath === component.filePath
  ) || namespace.references.some((reference) =>
    reference.componentName === component.name &&
    reference.filePath === component.filePath
  );
}

function isContextResultWithDependents(
  result: ContextCommandResult,
): result is ContextCommandResult & {
  readonly agentDependentContexts: readonly {
    readonly selectedComponent: { readonly name: string };
    readonly importingFiles: readonly {
      readonly filePath: string;
      readonly importedComponent: {
        readonly name: string;
        readonly filePath: string;
      };
      readonly importEdges: readonly {
        readonly sourceFile: string;
        readonly targetFile: string;
        readonly componentName: string;
        readonly importPath: string;
      }[];
      readonly contextualContracts: readonly ComponentContractView[];
    }[];
  }[];
} {
  return "agentDependentContexts" in result &&
    Array.isArray(result.agentDependentContexts);
}
