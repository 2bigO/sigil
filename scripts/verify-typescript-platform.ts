import { join, resolve } from "node:path";

interface JsonObject {
  readonly [key: string]: unknown;
}

const options = parseArguments(Deno.args);
const packageDirectory = resolve(options.packageDirectory);
const packageJson = readJson(join(packageDirectory, "package.json"));
const packageLock = readJson(resolve(options.lockfile));
const denoLock = readJson(resolve(options.lock));
const expectedVersion = "7.0.2";
const packageName = options.packageName;
const installedName = stringValue(packageJson.name);
const installedVersion = stringValue(packageJson.version);

if (installedName !== packageName || installedVersion !== expectedVersion) {
  throw new Error(
    "Installed TypeScript package metadata is " + installedName + "@" +
      installedVersion + ", expected " + packageName + "@" + expectedVersion +
      ".",
  );
}

const lockKey = packageName + "@" + expectedVersion;
const denoNpm = objectValue(denoLock.npm);
const denoEntry = objectValue(denoNpm[lockKey]);
const integrity = stringValue(denoEntry.integrity);
if (!integrity) {
  throw new Error("deno.lock has no integrity entry for " + lockKey + ".");
}
const packageEntries = objectValue(packageLock.packages);
const packageLockEntry = objectValue(
  packageEntries["node_modules/" + packageName],
);
if (
  stringValue(packageLockEntry.version) !== expectedVersion ||
  stringValue(packageLockEntry.integrity) !== integrity
) {
  throw new Error(
    "package-lock.json integrity for " + lockKey +
      " does not match deno.lock.",
  );
}

const library = join(packageDirectory, "lib");
if (!(await isDirectory(library))) {
  throw new Error("TypeScript package " + lockKey + " has no lib directory.");
}
const executable = packageName.includes("win32")
  ? join(library, "tsc.exe")
  : join(library, "tsc");
if (!(await isFile(executable))) {
  throw new Error(
    "TypeScript package " + lockKey + " has no " + executable + ".",
  );
}

console.log(JSON.stringify({
  package: packageName,
  version: expectedVersion,
  integrity,
  lockVerified: true,
  library: true,
  executable: true,
}));

function parseArguments(values: readonly string[]): {
  packageDirectory: string;
  packageName: string;
  lock: string;
  lockfile: string;
} {
  let packageDirectory: string | undefined;
  let packageName: string | undefined;
  let lock = "deno.lock";
  let lockfile: string | undefined;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === "--package-dir") packageDirectory = values[++index];
    else if (value === "--package-name") packageName = values[++index];
    else if (value === "--lock") lock = values[++index] ?? "";
    else if (value === "--lockfile") lockfile = values[++index];
    else throw new Error("Unsupported argument " + value + ".");
  }
  if (!packageDirectory || !packageName || !lock || !lockfile) {
    throw new Error(
      "Usage: verify-typescript-platform.ts --package-dir <dir> --package-name <name> --lockfile <path> [--lock <path>]",
    );
  }
  return { packageDirectory, packageName, lock, lockfile };
}

function readJson(path: string): JsonObject {
  try {
    return JSON.parse(Deno.readTextFileSync(path)) as JsonObject;
  } catch (error) {
    throw new Error("Cannot read JSON " + path + ": " + error);
  }
}

function objectValue(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}
