import { basename, dirname, join, resolve } from "node:path";
import { readCargoPackageVersion } from "./manifest-version.ts";
import { checkPluginManifests, VERSION_MANIFEST } from "./plugin-manifests.ts";

interface ReleaseTarget {
  /** The Rust target triple, which is also what Deno reports for the host. */
  readonly rust: string;
  readonly asset: string;
  readonly executable: string;
}

const TARGETS: readonly ReleaseTarget[] = [
  {
    rust: "aarch64-apple-darwin",
    asset: "sigil-aarch64-apple-darwin",
    executable: "sigil",
  },
  {
    rust: "x86_64-apple-darwin",
    asset: "sigil-x86_64-apple-darwin",
    executable: "sigil",
  },
  {
    rust: "aarch64-unknown-linux-gnu",
    asset: "sigil-aarch64-unknown-linux-gnu",
    executable: "sigil",
  },
  {
    rust: "x86_64-unknown-linux-gnu",
    asset: "sigil-x86_64-unknown-linux-gnu",
    executable: "sigil",
  },
  {
    rust: "x86_64-pc-windows-msvc",
    asset: "sigil-x86_64-pc-windows-msvc",
    executable: "sigil.exe",
  },
] as const;

const args = parseArgs(Deno.args);
const root = resolve(import.meta.dirname!, "..");
const output = resolve(root, args.output ?? "build/release");
const cliManifestVersion = await readCargoPackageVersion(
  join(root, VERSION_MANIFEST),
);
const version = args.version ?? cliManifestVersion;
if (cliManifestVersion !== version) {
  throw new Error(
    `Release version ${version} does not match CLI manifest ${cliManifestVersion}.`,
  );
}
const manifestErrors = await checkPluginManifests(root);
if (manifestErrors.length > 0) {
  throw new Error(
    `Plugin manifests disagree with the release:\n${manifestErrors.join("\n")}`,
  );
}
await Deno.mkdir(output, { recursive: true });
const selected = args.target
  ? TARGETS.filter((target) => target.rust === args.target)
  : TARGETS.filter((target) => target.rust === Deno.build.target);
if (selected.length === 0) {
  throw new Error(`Unsupported release target ${args.target}.`);
}
for (const target of selected) {
  if (target.rust !== Deno.build.target) {
    throw new Error(
      `Build and execute ${target.rust} on its matching native runner; current runner is ${Deno.build.target}.`,
    );
  }
  await buildTarget(target);
}

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
  try {
    await Deno.mkdir(join(stage, "bin"), { recursive: true });
    const suffix = target.executable.endsWith(".exe") ? ".exe" : "";
    // Both programs come from one release build per target, on the runner that
    // runs them, so the archive holds exactly what the smoke test executed.
    for (const crate of ["packages/cli", "packages/sigilc"]) {
      await run([
        "cargo",
        "build",
        "--manifest-path",
        join(root, crate, "Cargo.toml"),
        "--release",
        "--locked",
        "--target",
        target.rust,
      ]);
    }
    for (
      const [crate, name] of [
        ["packages/cli", "sigil"],
        ["packages/sigilc", "sigilc"],
      ]
    ) {
      await Deno.copyFile(
        join(root, crate, "target", target.rust, "release", `${name}${suffix}`),
        join(stage, "bin", `${name}${suffix}`),
      );
    }
    await Deno.copyFile(join(root, "LICENSE"), join(stage, "LICENSE"));
    await Deno.copyFile(
      join(root, "packages/core/src/language/data/UNICODE-LICENSE.txt"),
      join(stage, "UNICODE-LICENSE.txt"),
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
      "--version",
      version,
    ]);
    const archive = join(
      output,
      `${target.asset}${suffix ? ".zip" : ".tar.gz"}`,
    );
    if (suffix) {
      const source = join(dirname(stage), `sigil-${version}`);
      const command = [
        "$ErrorActionPreference = 'Stop';",
        `Compress-Archive -Path ${powershellLiteral(source)} -DestinationPath ${
          powershellLiteral(archive)
        } -Force`,
      ].join(" ");
      await run([
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        command,
      ]);
    } else {await run(
        ["tar", "-czf", archive, `sigil-${version}`],
        dirname(stage),
      );}
  } finally {
    if (!Deno.env.get("SIGIL_KEEP_STAGE")) {
      await Deno.remove(stageParent, { recursive: true }).catch(() => {});
    }
  }
}

function powershellLiteral(path: string): string {
  return `'${path.replaceAll("'", "''")}'`;
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
    if (!values[index + 1] || values[index + 1].startsWith("--")) {
      throw new Error(`Missing value for ${values[index]}.`);
    }
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
