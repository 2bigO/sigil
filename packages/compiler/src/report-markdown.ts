import type {
  CompilationReport,
  CompilerDiagnostic,
  DiagnosticSemanticSubject,
} from "./types.ts";

// @sigil implements packages/compiler/src/report-markdown.sigil::SigilCompilationReportMarkdown::CompilationReportMarkdown interface,logic,constraints,cases
export function renderCompilationReportMarkdown(
  report: CompilationReport,
): string {
  const lines = [
    "# Sigil Compilation Report",
    "",
    `Status: **${report.status.toUpperCase()}**`,
    "",
    "## Stage execution",
    "",
    "| Stage | State | Diagnostics |",
    "| --- | --- | ---: |",
    ...report.stages.map((stage) =>
      `| ${tableCell(stage.id)} | ${
        tableCell(stage.state)
      } | ${stage.diagnosticCount} |`
    ),
  ];

  if (report.artifacts) {
    lines.push("", "## Saved artifacts", "");
    if (report.artifacts.run) {
      lines.push(`- Run: ${inlineText(`.sigil/runs/${report.artifacts.run}`)}`);
    }
    for (const [stage, id] of Object.entries(report.artifacts.stages)) {
      lines.push(`- ${inlineText(stage)}: ${inlineText(`.sigil/cache/${id}`)}`);
    }
  }

  const grouped = groupDiagnostics(report);
  if (grouped.length > 0) {
    lines.push("", "## Findings");
    for (const [stage, diagnostics] of grouped) {
      lines.push(
        "",
        `### ${inlineText(stage)}`,
        "",
        "| Severity | Lifecycle | Rule | Semantic subject | Location |",
        "| --- | --- | --- | --- | --- |",
        ...diagnostics.map((diagnostic) =>
          `| ${tableCell(diagnostic.severity)} | ${
            tableCell(diagnostic.lifecycle)
          } | ${tableCell(diagnostic.code)} | ${
            tableCell(semanticSubjects(diagnostic.semanticSubjects))
          } | ${tableCell(location(diagnostic))} |`
        ),
      );
      for (const diagnostic of diagnostics) {
        lines.push(
          "",
          `**${inlineText(diagnostic.code)} — ${
            inlineText(diagnostic.message)
          }**`,
          "",
          `- Evidence: ${inlineText(diagnostic.evidence)}`,
          `- Impact: ${inlineText(diagnostic.impact)}`,
          `- Suggested correction: ${inlineText(diagnostic.correction)}`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function groupDiagnostics(
  report: CompilationReport,
): readonly [string, readonly CompilerDiagnostic[]][] {
  const byStage = new Map<string, CompilerDiagnostic[]>();
  for (const stage of report.stages) byStage.set(stage.id, []);
  for (const diagnostic of report.diagnostics) {
    const diagnostics = byStage.get(diagnostic.stage);
    if (diagnostics) diagnostics.push(diagnostic);
    else byStage.set(diagnostic.stage, [diagnostic]);
  }
  return [...byStage.entries()].filter(([, diagnostics]) =>
    diagnostics.length > 0
  );
}

function semanticSubjects(
  subjects: readonly DiagnosticSemanticSubject[],
): string {
  if (subjects.length === 0) return "—";
  return subjects.map((subject) => {
    const concept = subject.conceptIdentifier
      ? `::${subject.conceptIdentifier}`
      : "";
    return `${subject.relation} ${subject.componentName}${concept} ${subject.sectionName} (${subject.sigilPath})`;
  }).join("; ");
}

function location(diagnostic: CompilerDiagnostic): string {
  if (!diagnostic.filePath) return "—";
  if (!diagnostic.range) return diagnostic.filePath;
  return `${diagnostic.filePath}:${diagnostic.range.start.line}:${diagnostic.range.start.column}`;
}

function tableCell(value: string): string {
  return inlineText(value).replaceAll("|", "\\|");
}

function inlineText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/[\r\n\t ]+/g, " ")
    .trim()
    .replace(/([`*<>\[\]])/g, "\\$1");
}
