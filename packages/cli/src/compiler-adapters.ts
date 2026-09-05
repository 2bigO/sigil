import {
  type CompilationReport,
  type CompilationScopeSeed,
  compile,
  type CompileOptions,
  loadCompilationConfiguration,
} from "@qoherent/sigil-compiler";

/** Compatibility facade; deterministic compilation has no provider dependency. */
// @sigil implements packages/cli/_module.sigil::SigilCli::CompilationFacade logic
export function compileWithBundledAdapters(
  workspacePath: string,
  target: CompilationScopeSeed | undefined,
  options?: CompileOptions & { readonly profile?: string },
): Promise<CompilationReport>;
export function compileWithBundledAdapters(
  workspacePath: string,
  target: CompilationScopeSeed | undefined,
  profileName: string,
  options?: CompileOptions,
): Promise<CompilationReport>;
export async function compileWithBundledAdapters(
  workspacePath: string,
  target: CompilationScopeSeed = { kind: "workspace" },
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
  return await compile(workspacePath, target, profileName, options);
}
