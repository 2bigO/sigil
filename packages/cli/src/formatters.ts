import type { CommandRequest } from "./args.ts";
import type { CommandResult } from "./output-model.ts";
import { projectRetrieval } from "@qoherent/sigil-core";
import { renderContextMarkdown, renderRetrieveMarkdown } from "./markdown.ts";

// @sigil implements packages/cli/_module.sigil::SigilCli::StructuredOutput interface,constraints
export async function formatResult(
  result: CommandResult,
  request: CommandRequest,
): Promise<string> {
  if (request.quiet) return "";
  result = normalizeResultPaths(result, request);
  if (
    result.command === "render" &&
    (request.format === undefined || request.format === "markdown")
  ) {
    return result.markdown;
  }
  if (result.command === "context" && request.format === "markdown") {
    return renderContextMarkdown(result);
  }
  if (result.command === "retrieve" && request.format === "markdown") {
    return renderRetrieveMarkdown(await projectRetrieval(result));
  }
  if (
    result.command === "version" &&
    (request.format === undefined || request.format === "text")
  ) {
    const lines = [
      `CLI: ${result.cliVersion}`,
      `Core: ${result.coreVersion}`,
      `Workspace: ${result.workspaceRoot}`,
      `Workspace name: ${result.workspaceName ?? "unresolved"}`,
      `Configured Sigil: ${result.sigilVersion ?? "unresolved"}`,
    ];
    for (const item of result.diagnostics) {
      lines.push(`${item.severity} ${item.code}: ${item.message}`);
    }
    return `${lines.join("\n")}\n`;
  }
  if (
    result.command === "check" &&
    (request.format === undefined || request.format === "text")
  ) {
    const showLocations = request.command === "check" && request.showLocations;
    return formatCheckText(result, showLocations);
  }
  if (
    result.command === "fmt" &&
    (request.format === undefined || request.format === "text")
  ) {
    const lines = result.files.map((file) => `${file.status} ${file.filePath}`);
    for (const diagnostic of result.diagnostics) {
      lines.push(
        `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
      );
    }
    return lines.length ? `${lines.join("\n")}\n` : "";
  }
  if (
    result.command === "glossary" &&
    (request.format === undefined || request.format === "text")
  ) {
    return formatGlossaryText(result);
  }
  if (
    (result.command === "init" || result.command === "config-set-default" ||
      result.command === "config-set-profile" ||
      result.command === "config-set-provider" ||
      result.command === "config-set-provider-default" ||
      result.command === "config-migrate") &&
    (request.format === undefined || request.format === "text")
  ) {
    return formatConfigWriteText(result, request);
  }
  return `${JSON.stringify(result, null, request.pretty ? 2 : 0)}\n`;
}

function normalizeResultPaths(
  result: CommandResult,
  request: CommandRequest,
): CommandResult {
  const supplied = request.root ?? controllingPath(request);
  if (supplied && isAbsolute(supplied)) return result;
  const workspaceRoot = "workspaceRoot" in result
    ? result.workspaceRoot
    : undefined;
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) return result;
  const displayRoot = relativeFrom(
    normalizePath(Deno.cwd()),
    normalizePath(workspaceRoot),
  );
  return replaceStrings(result, workspaceRoot, displayRoot) as CommandResult;
}

function controllingPath(request: CommandRequest): string | undefined {
  if (request.command === "parse") return request.file;
  if (
    request.command === "context" || request.command === "retrieve" ||
    request.command === "compile"
  ) {
    return request.path ?? request.file;
  }
  return "path" in request ? request.path : undefined;
}

function replaceStrings(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") {
    const prefix = to === "." ? "" : `${to}/`;
    return value.replaceAll(`${from}/`, prefix).replaceAll(from, to);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceStrings(item, from, to));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map((
        [key, item],
      ) => [key, replaceStrings(item, from, to)]),
    );
  }
  return value;
}

function relativeFrom(root: string, path: string): string {
  if (root === path) return ".";
  const rootParts = root.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  let common = 0;
  while (
    common < rootParts.length && common < pathParts.length &&
    rootParts[common] === pathParts[common]
  ) common++;
  return [
    ...Array(rootParts.length - common).fill(".."),
    ...pathParts.slice(common),
  ].join("/") || ".";
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
}
function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * These commands write one file, so the useful report is what changed rather
 * than the resulting document, which the caller can read or request as JSON.
 */
function formatConfigWriteText(
  result: Extract<
    CommandResult,
    {
      command:
        | "init"
        | "config-set-default"
        | "config-set-profile"
        | "config-set-provider"
        | "config-set-provider-default"
        | "config-migrate";
    }
  >,
  request: CommandRequest,
): string {
  const lines: string[] = [];
  const failed = result.diagnostics.some((item) => item.severity === "error");
  if (!failed) {
    const compile = result.config?.tools?.compile as
      | { readonly defaultProfile?: string }
      | undefined;
    if (result.command === "init") {
      lines.push(`Created ${result.configPath}`);
      lines.push(
        `Workspace ${result.workspaceName ?? "unnamed"} on Sigil ${
          result.sigilVersion ?? "unresolved"
        }`,
      );
    } else if (result.command === "config-set-default") {
      lines.push(`Updated ${result.configPath}`);
      lines.push(`Default profile ${compile?.defaultProfile ?? "unresolved"}`);
    } else {
      lines.push(`Updated ${result.configPath}`);
      if (request.command === "config-set-profile") {
        lines.push(`Profile ${request.profileName}`);
      } else if (request.command === "config-set-provider") {
        lines.push(`Semantic provider ${request.name}`);
      } else if (request.command === "config-set-provider-default") {
        lines.push(`Default semantic provider ${request.name}`);
      } else if (request.command === "config-migrate") {
        lines.push(
          `${request.write ? "Migrated" : "Migration preview"} configuration`,
        );
      }
    }
  }
  for (const item of result.diagnostics) {
    lines.push(`${item.severity} ${item.code}: ${item.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatCheckText(
  result: Extract<CommandResult, { command: "check" }>,
  showLocations: boolean,
): string {
  const counts = result.diagnosticCounts;
  const lines = [
    `Workspace root: ${result.workspaceRoot}`,
    `Diagnostics: ${counts.error} error, ${counts.warning} warning, ${counts.info} info`,
  ];
  for (const diagnostic of result.diagnostics) {
    const label = `${diagnostic.severity} ${diagnostic.code}`;
    const location = showLocations && diagnostic.filePath
      ? ` ${diagnostic.filePath}${
        diagnostic.range
          ? `:${diagnostic.range.start.line}:${diagnostic.range.start.column}`
          : ""
      }`
      : "";
    lines.push(`${label}${location}: ${diagnostic.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatGlossaryText(
  result: Extract<CommandResult, { command: "glossary" }>,
): string {
  const lines = [
    `Workspace root: ${result.workspaceRoot}`,
    `Glossary: ${result.glossaryPath ?? "absent"}`,
    `Schema version: ${result.schemaVersion ?? "none"}`,
    `Terms: ${result.terms.length}`,
    `Contexts: ${result.contexts.length}`,
    `Occurrences: ${result.occurrences.length}`,
  ];
  for (const occurrence of result.occurrences) {
    const context = occurrence.term.scope.kind === "context"
      ? ` [${occurrence.term.scope.id}]`
      : "";
    lines.push(
      `${occurrence.filePath}:${occurrence.range.start.line}:${occurrence.range.start.column} ${occurrence.matchedSpelling} -> ${occurrence.term.term}${context}`,
    );
  }
  for (const item of result.diagnostics) {
    lines.push(`${item.severity} ${item.code}: ${item.message}`);
  }
  return `${lines.join("\n")}\n`;
}
