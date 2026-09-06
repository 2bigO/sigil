import { basename, dirname, join, resolve } from "node:path";
import { createRuntimeManifest } from "./runtime-manifest.ts";

interface ReleaseTarget {
  readonly deno: string;
  readonly rust: string;
  readonly asset: string;
  readonly executable: string;
  readonly typescriptPackages: readonly string[];
}

const TARGETS: readonly ReleaseTarget[] = [
  {
    deno: "aarch64-apple-darwin",
    rust: "aarch64-apple-darwin",
    asset: "sigil-aarch64-apple-darwin",
    executable: "sigil",
    typescriptPackages: ["@typescript/typescript-darwin-arm64"],
  },
  {
    deno: "x86_64-apple-darwin",
    rust: "x86_64-apple-darwin",
    asset: "sigil-x86_64-apple-darwin",
    executable: "sigil",
    typescriptPackages: ["@typescript/typescript-darwin-x64"],
  },
  {
    deno: "aarch64-unknown-linux-gnu",
    rust: "aarch64-unknown-linux-gnu",
    asset: "sigil-aarch64-unknown-linux-gnu",
    executable: "sigil",
    typescriptPackages: ["@typescript/typescript-linux-arm64"],
  },
  {
    deno: "x86_64-unknown-linux-gnu",
    rust: "x86_64-unknown-linux-gnu",
    asset: "sigil-x86_64-unknown-linux-gnu",
    executable: "sigil",
    typescriptPackages: ["@typescript/typescript-linux-x64"],
  },
  {
    deno: "x86_64-pc-windows-msvc",
    rust: "x86_64-pc-windows-msvc",
    asset: "sigil-x86_64-pc-windows-msvc",
    executable: "sigil.exe",
    typescriptPackages: ["@typescript/typescript-win32-x64"],
  },
] as const;

const args = parseArgs(Deno.args);
const root = resolve(import.meta.dirname!, "..");
const output = resolve(root, args.output ?? "build/release");
const cliManifest = JSON.parse(
  await Deno.readTextFile(join(root, "packages/cli/deno.json")),
) as { version: string };
const version = args.version ?? cliManifest.version;
if (cliManifest.version !== version) {
  throw new Error(
    `Release version ${version} does not match CLI manifest ${cliManifest.version}.`,
  );
}
await Deno.mkdir(output, { recursive: true });
const selected = args.target
  ? TARGETS.filter((target) => target.deno === args.target)
  : TARGETS;
if (selected.length === 0) {
  throw new Error(`Unsupported release target ${args.target}.`);
}
for (const target of selected) await buildTarget(target);

for (const script of ["install.sh", "install.ps1"]) {
  const source = await Deno.readTextFile(join(root, script));
  await Deno.writeTextFile(
    join(output, script),
    source.replaceAll("__SIGIL_VERSION__", version),
  );
}
const assets: string[] = [];
for await (const entry of Deno.readDir(output)) {
  if (entry.isFile && entry.name !== "checksums.txt") assets.push(entry.name);
}
assets.sort();
await Deno.writeTextFile(
  join(output, "checksums.txt"),
  `${
    (await Promise.all(
      assets.map(async (asset) =>
        `${await sha256(await Deno.readFile(join(output, asset)))}  ${asset}`
      ),
    )).join("\n")
  }\n`,
);
console.log(`Built ${assets.length} release assets in ${output}.`);

async function buildTarget(target: ReleaseTarget): Promise<void> {
  const stageParent = join(output, ".stage", target.asset, crypto.randomUUID());
  const stage = join(stageParent, `sigil-${version}`);
  const bootstrapPath = join(
    root,
    `.sigil-release-bootstrap-${target.deno}-${crypto.randomUUID()}.ts`,
  );
  try {
    const runtimeRoot = join(stage, "lib/sigil/runtime");
    await Promise.all([
      Deno.mkdir(join(stage, "bin"), { recursive: true }),
      Deno.mkdir(join(runtimeRoot, "egglog"), { recursive: true }),
      Deno.mkdir(join(runtimeRoot, "typescript"), { recursive: true }),
      Deno.mkdir(join(runtimeRoot, "licenses"), { recursive: true }),
    ]);
    const engineSuffix = target.executable.endsWith(".exe") ? ".exe" : "";
    const engineRelative =
      `egglog/sigil-semantic-engine${engineSuffix}` as const;
    await Deno.copyFile(
      await locateEngine(target),
      join(runtimeRoot, engineRelative),
    );
    await copyTypeScriptRuntime(
      await locateTypeScriptPackage(target),
      join(runtimeRoot, "typescript"),
      target,
    );
    await Deno.copyFile(join(root, "LICENSE"), join(stage, "LICENSE"));
    await Deno.copyFile(
      join(root, "LICENSE"),
      join(runtimeRoot, "licenses/Sigil-LICENSE"),
    );
    const kernelFingerprint = await runtimeInfo(
      join(runtimeRoot, engineRelative),
    );
    const built = await createRuntimeManifest(runtimeRoot, {
      sigilVersion: version,
      target: target.deno,
      engineProtocolVersion: 1,
      kernelFingerprint,
      typescriptVersion: "7.0.2",
      typescriptExtractorVersion: 3,
      egglogPath: engineRelative,
      typescriptPath: `typescript/tsc${engineSuffix}` as
        | "typescript/tsc"
        | "typescript/tsc.exe",
    });
    await Deno.writeTextFile(join(runtimeRoot, "manifest.json"), built.source);
    await Deno.writeTextFile(
      bootstrapPath,
      [
        // Keep this bootstrap inside the repository so Deno resolves both
        // imports into the compiled virtual filesystem. An absolute source
        // URL would make an extracted archive depend on this checkout.
        'import { configureStandaloneRuntime } from "./packages/compiler/src/semantic/runtime.ts";',
        `configureStandaloneRuntime(${
          JSON.stringify({
            manifestHash: built.hash,
            sigilVersion: version,
            target: target.deno,
          })
        });`,
        'const { runMain } = await import("./packages/cli/src/main.ts");',
        "await runMain();",
        "",
      ].join("\n"),
    );
    await run([
      Deno.execPath(),
      "compile",
      "--config",
      join(root, "deno.json"),
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      "--target",
      target.deno,
      "--output",
      join(stage, "bin", target.executable),
      bootstrapPath,
    ]);
    await copyValidSkills(
      join(root, "integrations/skills"),
      join(stage, "integrations/skills"),
    );
    await run([
      Deno.execPath(),
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      join(root, "scripts/test-cli-release.ts"),
      "--distribution",
      stage,
    ]);
    await run([
      Deno.execPath(),
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      join(root, "scripts/test-published-runtime.ts"),
      "--runtime",
      runtimeRoot,
    ]);
    const archive = join(
      output,
      `${target.asset}${engineSuffix ? ".zip" : ".tar.gz"}`,
    );
    if (engineSuffix) {
      await run(["zip", "-qr", archive, `sigil-${version}`], dirname(stage));
    } else {await run(
        ["tar", "-czf", archive, `sigil-${version}`],
        dirname(stage),
      );}
  } finally {
    await Deno.remove(bootstrapPath).catch(() => {});
    if (!Deno.env.get("SIGIL_KEEP_STAGE")) {
      await Deno.remove(stageParent, { recursive: true }).catch(() => {});
    }
  }
}

async function locateEngine(target: ReleaseTarget): Promise<string> {
  const suffix = target.executable.endsWith(".exe") ? ".exe" : "";
  const candidates = [
    join(
      root,
      "packages/compiler/native/target",
      target.rust,
      "release",
      `sigil-semantic-engine${suffix}`,
    ),
    join(
      root,
      "packages/compiler/native/target/release",
      `sigil-semantic-engine${suffix}`,
    ),
  ];
  for (const path of candidates) {
    try {
      if ((await Deno.stat(path)).isFile) return path;
    } catch { /* try next */ }
  }
  throw new Error(
    `Native engine for ${target.deno} is missing; build Rust with --release --locked on its target runner.`,
  );
}

async function locateTypeScriptPackage(target: ReleaseTarget): Promise<string> {
  const explicit = Deno.env.get("SIGIL_TYPESCRIPT_PACKAGE_DIR");
  if (explicit) return explicit;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  const candidates = target.typescriptPackages.map((name) =>
    home ? join(home, ".cache/deno/npm/registry.npmjs.org", name, "7.0.2") : ""
  );
  // The unscoped TypeScript package is acceptable only when building for the
  // current host. Cross-target archives must use the target-specific native
  // package; a host executable can never be smuggled into another archive.
  if (home && target.deno === Deno.build.target) {
    candidates.push(
      join(home, ".cache/deno/npm/registry.npmjs.org/typescript/7.0.2"),
    );
  }
  for (const candidate of candidates) {
    try {
      if ((await Deno.stat(join(candidate, "lib"))).isDirectory) {
        return candidate;
      }
    } catch { /* try next */ }
  }
  throw new Error(
    `TypeScript 7.0.2 platform package for ${target.deno} is missing; set SIGIL_TYPESCRIPT_PACKAGE_DIR.`,
  );
}

async function copyTypeScriptRuntime(
  source: string,
  target: string,
  platform: ReleaseTarget,
): Promise<void> {
  const executable = platform.executable.endsWith(".exe") ? "tsc.exe" : "tsc";
  await copyDirectory(join(source, "lib"), target);
  let copied = false;
  for (
    const candidate of [
      join(target, executable),
      join(source, "bin", executable),
    ]
  ) {
    try {
      if (candidate === join(target, executable)) {
        if ((await Deno.stat(candidate)).isFile) {
          copied = true;
          break;
        }
        continue;
      }
      await Deno.copyFile(candidate, join(target, executable));
      copied = true;
      break;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  if (!copied) throw new Error(`TypeScript runtime is missing ${executable}.`);
  for (const name of ["LICENSE", "NOTICE.txt"]) {
    try {
      await Deno.copyFile(
        join(source, name),
        join(target, "../licenses", `TypeScript-${name}`),
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}

async function runtimeInfo(engine: string): Promise<string> {
  const child = new Deno.Command(engine, {
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode('{"version":1,"runtime_info":true}'),
  );
  await writer.close();
  writer.releaseLock();
  const [stdout, status] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    child.status,
  ]);
  if (!status.success) {
    throw new Error(`Native runtime-info failed for ${engine}.`);
  }
  const value = JSON.parse(new TextDecoder().decode(stdout)) as {
    kernelFingerprint?: unknown;
  };
  if (
    typeof value.kernelFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.kernelFingerprint)
  ) throw new Error("Native runtime-info returned no kernel fingerprint.");
  return value.kernelFingerprint;
}

async function copyValidSkills(source: string, target: string): Promise<void> {
  for await (const entry of Deno.readDir(source)) {
    if (!entry.isDirectory || entry.isSymlink || entry.name.startsWith(".")) {
      continue;
    }
    const skill = join(source, entry.name);
    try {
      if (!(await Deno.stat(join(skill, "SKILL.md"))).isFile) continue;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    await copyDirectory(skill, join(target, entry.name));
  }
}
async function copyDirectory(source: string, target: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory) await copyDirectory(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}
async function run(command: readonly string[], cwd = root): Promise<void> {
  const result = await new Deno.Command(command[0], {
    args: command.slice(1),
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) {
    throw new Error(`${basename(command[0])} exited with ${result.code}.`);
  }
}
function parseArgs(
  values: readonly string[],
): { version?: string; output?: string; target?: string } {
  let version: string | undefined,
    output: string | undefined,
    target: string | undefined;
  for (let index = 0; index < values.length; index++) {
    if (values[index] === "--version") version = values[++index];
    else if (values[index] === "--output") output = values[++index];
    else if (values[index] === "--target") target = values[++index];
    else throw new Error(`Unsupported argument ${values[index]}.`);
  }
  return { version, output, target };
}
async function sha256(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((
    byte,
  ) => byte.toString(16).padStart(2, "0")).join("");
}
