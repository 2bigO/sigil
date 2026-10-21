export const TARGETS: readonly string[];
export function binaryFileName(target: string): string;
export function parsePackageArguments(
  argv: readonly string[],
): { target: string | undefined; binary: string | undefined };
export function packagePlan(
  manifestVersion: string,
  options: { target?: string; binary?: string },
): { output: string; shipped: string | undefined };
