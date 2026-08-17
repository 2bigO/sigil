import {
  type CompilationReport,
  type CompilationTarget,
  compile,
  type CompileOptions,
  loadCompilationConfiguration,
} from "@qoherent/sigil-compiler";
import { OpenCodeAdapter } from "@qoherent/sigil-compiler-adapter-opencode";
import { PiAdapter } from "@qoherent/sigil-compiler-adapter-pi";
import { ClaudeAdapter } from "@qoherent/sigil-compiler-adapter-claude";

// @sigil implements packages/cli/_module.sigil::SigilCli::CompilationFacade logic
export function compileWithBundledAdapters(
  workspacePath: string,
  target: CompilationTarget | undefined,
  options?: CompileOptions & { readonly profile?: string },
): Promise<CompilationReport>;
export function compileWithBundledAdapters(
  workspacePath: string,
  target: CompilationTarget | undefined,
  profileName: string,
  options?: CompileOptions,
): Promise<CompilationReport>;
export async function compileWithBundledAdapters(
  workspacePath: string,
  target: CompilationTarget = { kind: "workspace" },
  profileOrOptions: string | (CompileOptions & { readonly profile?: string }) =
    {},
  suppliedOptions: CompileOptions = {},
): Promise<CompilationReport> {
  const configuration = await loadCompilationConfiguration(workspacePath);
  const profileName = typeof profileOrOptions === "string"
    ? profileOrOptions
    : profileOrOptions.profile ?? configuration.defaultProfile ?? "standard";
  const options = typeof profileOrOptions === "string"
    ? suppliedOptions
    : profileOrOptions;
  const openCodeModels = new Set<string | undefined>([undefined]);
  const piModels = new Set<string | undefined>([undefined]);
  const claudeModels = new Set<string | undefined>([undefined]);
  if (configuration.adapter?.provider === "opencode") {
    openCodeModels.add(configuration.adapter.model);
  }
  if (configuration.adapter?.provider === "pi") {
    piModels.add(configuration.adapter.model);
  }
  if (configuration.adapter?.provider === "claude") {
    claudeModels.add(
      typeof configuration.adapter.model === "string"
        ? configuration.adapter.model
        : undefined,
    );
  }
  for (const evaluator of Object.values(configuration.evaluators ?? {})) {
    if (evaluator.provider === "opencode") {
      openCodeModels.add(
        typeof evaluator.model === "string" ? evaluator.model : undefined,
      );
    }
    if (evaluator.provider === "pi") {
      piModels.add(
        typeof evaluator.model === "string" ? evaluator.model : undefined,
      );
    }
    if (evaluator.provider === "claude") {
      claudeModels.add(
        typeof evaluator.model === "string" ? evaluator.model : undefined,
      );
    }
  }
  const bundled = [
    ...[...openCodeModels].map((model) => new OpenCodeAdapter(model)),
    ...[...piModels].map((model) => new PiAdapter(model)),
    ...[...claudeModels].map((model) => new ClaudeAdapter(model)),
  ];
  return await compile(
    workspacePath,
    target,
    profileName,
    {
      ...options,
      adapters: [...(options.adapters ?? []), ...bundled],
    },
  );
}
