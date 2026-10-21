/**
 * The version a Cargo manifest declares in its `[package]` table. The release
 * tooling reads the CLI version from `packages/cli/Cargo.toml` through this, so
 * the manifest stays the one owner of the number.
 */
export function cargoPackageVersion(text: string, label: string): string {
  const versions: string[] = [];
  let inPackage = false;
  for (const line of text.split(/\r?\n/)) {
    const table = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (table) {
      inPackage = table[1].trim() === "package";
      continue;
    }
    if (!inPackage) continue;
    const version = line.match(/^\s*version\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (version) versions.push(version[1]);
  }
  if (versions.length === 0) {
    throw new Error(`${label}: [package] declares no version`);
  }
  if (versions.length > 1) {
    throw new Error(`${label}: [package] declares more than one version`);
  }
  return versions[0];
}

export async function readCargoPackageVersion(path: string): Promise<string> {
  return cargoPackageVersion(await Deno.readTextFile(path), path);
}
