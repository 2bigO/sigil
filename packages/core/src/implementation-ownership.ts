import { diagnostic } from "./diagnostics.ts";
import { normalizePath } from "./path.ts";
import type {
  ImplementationArtifactKind,
  ImplementationRelation,
  OwnedImplementationProjection,
  OwnedImplementationTarget,
  ResolvedComponent,
  ResolvedSigilWorkspace,
  SigilDiagnostic,
  SourceRange,
} from "./model.ts";

const IMPLEMENTATION_RELATIONS: ReadonlySet<ImplementationRelation> = new Set([
  "follows",
  "implements",
  "tests",
  "validates",
  "related",
]);

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown"];

interface ParsedAnnotation {
  readonly target: OwnedImplementationTarget;
}

export function ownedImplementationTargetsFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
  conceptName?: string,
): OwnedImplementationProjection | undefined {
  const owningComponent = resolved.components.find((component) =>
    component.name === componentName
  );
  if (!owningComponent) return undefined;

  const concept = conceptName
    ? owningComponent.conceptNamespace.concepts.find((item) =>
      item.identifier === conceptName
    )
    : undefined;
  if (conceptName && !concept) return undefined;

  const diagnostics: SigilDiagnostic[] = [];
  const targets: OwnedImplementationTarget[] = [];
  const seen = new Set<string>();

  for (const line of implementationAnnotationLines(owningComponent, conceptName)) {
    const annotations = parseImplementationAnnotations(line.text);
    if (annotations.length === 0 && line.text.includes("@sigil")) {
      diagnostics.push(diagnostic(
        "SIGIL_PARSE_STRUCTURE",
        `Unable to parse implementation annotation: ${line.text}`,
        { filePath: line.filePath, range: line.range },
      ));
      continue;
    }
    for (const annotation of annotations) {
      const key = `${annotation.target.relation}\0${annotation.target.filePath}\0${
        annotation.target.symbolIdentity ?? ""
      }`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(annotation.target);
    }
  }

  targets.sort((left, right) =>
    left.filePath.localeCompare(right.filePath) ||
    (left.symbolIdentity ?? "").localeCompare(right.symbolIdentity ?? "") ||
    left.relation.localeCompare(right.relation)
  );

  return {
    owningComponent,
    concept,
    targets,
    diagnostics,
  };
}

function implementationAnnotationLines(
  component: ResolvedComponent,
  conceptName?: string,
): readonly {
  readonly filePath: string;
  readonly range: SourceRange;
  readonly text: string;
}[] {
  const lines = [
    ...component.declaration.sections.flatMap((section) => section.lines),
    ...component.expansions.expands.flatMap((expand) =>
      expand.declaration.sections.flatMap((section) => section.lines)
    ),
  ];
  return conceptName
    ? lines.filter((line) => line.conceptIdentifier === conceptName)
    : lines;
}

function parseImplementationAnnotations(
  text: string,
): readonly ParsedAnnotation[] {
  if (!text.includes("@sigil")) return [];
  const annotations: ParsedAnnotation[] = [];
  for (const segment of text.split("@sigil").slice(1)) {
    const parsed = parseImplementationAnnotation(segment);
    if (parsed) annotations.push(parsed);
  }
  return annotations;
}

function parseImplementationAnnotation(
  segment: string,
): ParsedAnnotation | undefined {
  const cleaned = segment.trim();
  if (!cleaned) return undefined;
  const relationMatch = cleaned.match(
    /^(follows|implements|tests|validates|related)\s+(.+)$/i,
  );
  if (!relationMatch) return undefined;

  const relation = relationMatch[1].toLowerCase() as ImplementationRelation;
  if (!IMPLEMENTATION_RELATIONS.has(relation)) return undefined;

  const body = relationMatch[2].trim();
  const sectionless = body.replace(/\s+\[[^\]]*\]\s*$/, "").trim();
  if (!sectionless) return undefined;

  const targetParts = sectionless.split("::").map((part) => part.trim());
  const filePath = normalizePath(targetParts[0] ?? "");
  if (!filePath || filePath === ".") return undefined;
  const symbolIdentity = targetParts.length > 1
    ? targetParts.slice(1).join("::") || undefined
    : undefined;

  return {
    target: {
      relation,
      artifactKind: inferArtifactKind(filePath, relation),
      filePath,
      symbolIdentity,
    },
  };
}

function inferArtifactKind(
  filePath: string,
  relation: ImplementationRelation,
): ImplementationArtifactKind {
  const normalized = normalizePath(filePath).toLowerCase();
  if (MARKDOWN_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
    return "markdown";
  }
  if (relation === "tests") return "test";
  return "code";
}
