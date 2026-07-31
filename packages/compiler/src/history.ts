import type {
  CompilationHistoryStore,
  CompilationReport,
  CompilationTarget,
  CompilerDiagnostic,
  EffectiveProfile,
} from "./types.ts";

// @sigil implements packages/compiler/src/compiler.sigil::SigilCompiler::CompilationHistory interface,logic,constraints,cases
export class FileCompilationHistoryStore implements CompilationHistoryStore {
  constructor(private readonly directory: string) {}

  async read(key: string): Promise<CompilationReport | undefined> {
    try {
      const value = JSON.parse(
        await Deno.readTextFile(`${this.directory}/${key}.json`),
      );
      return isCompatibleReport(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async write(key: string, report: CompilationReport): Promise<void> {
    await Deno.mkdir(this.directory, { recursive: true });
    const temporary = await Deno.makeTempFile({
      dir: this.directory,
      prefix: `${key}.`,
      suffix: ".tmp",
    });
    try {
      await Deno.writeTextFile(temporary, `${JSON.stringify(report)}\n`);
      await Deno.rename(temporary, `${this.directory}/${key}.json`);
    } catch (error) {
      await Deno.remove(temporary).catch(() => {});
      throw error;
    }
  }
}

export async function compilationHistoryKey(
  workspaceRoot: string,
  target: CompilationTarget,
  profile: EffectiveProfile,
): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({
      reportVersion: 2,
      workspaceRoot: workspaceRoot.replaceAll("\\", "/"),
      target,
      profile: profile.fingerprint,
    })),
  );
  return [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function applyDiagnosticLifecycle(
  current: readonly CompilerDiagnostic[],
  previous?: CompilationReport,
): readonly CompilerDiagnostic[] {
  if (!previous) return current;
  const prior = new Map(previous.diagnostics.map((item) => [
    item.fingerprint,
    item,
  ]));
  const active = current.map((item) => {
    const earlier = prior.get(item.fingerprint);
    return {
      ...item,
      lifecycle: earlier
        ? earlier.lifecycle === "resolved" ? "regressed" : "unchanged"
        : "new",
    } as CompilerDiagnostic;
  });
  const fingerprints = new Set(current.map((item) => item.fingerprint));
  return [
    ...active,
    ...previous.diagnostics
      .filter((item) =>
        item.lifecycle !== "resolved" && !fingerprints.has(item.fingerprint)
      )
      .map((item) => ({ ...item, lifecycle: "resolved" as const })),
  ];
}

function isCompatibleReport(value: unknown): value is CompilationReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return report.reportVersion === 2 &&
    typeof report.workspaceRoot === "string" &&
    Array.isArray(report.diagnostics) &&
    !!report.profile && typeof report.profile === "object" &&
    typeof (report.profile as Record<string, unknown>).fingerprint === "string";
}
