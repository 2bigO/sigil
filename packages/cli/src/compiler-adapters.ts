import {
  type CompilationReport,
  type CompilationTarget,
  compile,
  type CompileOptions,
  loadCompilationConfiguration,
} from "@qoherent/sigil-compiler";
import { OpenCodeAdapter } from "@qoherent/sigil-compiler-adapter-opencode";

// @sigil implements packages/cli/_module.sigil::SigilCli::CompilationFacade logic
export async function compileWithBundledAdapters(
  workspacePath: string,
  target: CompilationTarget = { kind: "workspace" },
  options: CompileOptions = {},
): Promise<CompilationReport> {
  const configuration = await loadCompilationConfiguration(workspacePath);
  const models = new Set<string | undefined>([undefined]);
  if (configuration.adapter?.provider === "opencode") {
    models.add(configuration.adapter.model);
  }
  for (const evaluator of Object.values(configuration.evaluators ?? {})) {
    if (evaluator.provider === "opencode") {
      models.add(
        typeof evaluator.model === "string" ? evaluator.model : undefined,
      );
    }
  }
  const bundled = [...models].map((model) => new OpenCodeAdapter(model));
  return await compile(workspacePath, target, {
    ...options,
    adapters: [...(options.adapters ?? []), ...bundled],
  });
}
