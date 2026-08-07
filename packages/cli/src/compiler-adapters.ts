import {
  type CompilationReport,
  type CompilationTarget,
  compile,
  type CompileOptions,
  loadCompilationConfiguration,
} from "@qoherent/sigil-compiler";
import { OpenCodeAdapter } from "@qoherent/sigil-compiler-adapter-opencode";
import { PiAdapter } from "@qoherent/sigil-compiler-adapter-pi";

// @sigil implements packages/cli/_module.sigil::SigilCli::CompilationFacade logic
export async function compileWithBundledAdapters(
  workspacePath: string,
  target: CompilationTarget = { kind: "workspace" },
  options: CompileOptions = {},
): Promise<CompilationReport> {
  const configuration = await loadCompilationConfiguration(workspacePath);
  const openCodeModels = new Set<string | undefined>([undefined]);
  const piModels = new Set<string | undefined>([undefined]);
  if (configuration.adapter?.provider === "opencode") {
    openCodeModels.add(configuration.adapter.model);
  }
  if (configuration.adapter?.provider === "pi") {
    piModels.add(configuration.adapter.model);
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
  }
  const bundled = [
    ...[...openCodeModels].map((model) => new OpenCodeAdapter(model)),
    ...[...piModels].map((model) => new PiAdapter(model)),
  ];
  return await compile(workspacePath, target, {
    ...options,
    adapters: [...(options.adapters ?? []), ...bundled],
  });
}
