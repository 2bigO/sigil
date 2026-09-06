import { basename, join, resolve } from "node:path";

const distribution = parse(Deno.args);
const executable = Deno.build.os === "windows" ? "sigil.exe" : "sigil";
const cli = join(distribution, "bin", executable);
if (!(await Deno.stat(cli)).isFile) {
  throw new Error(`Release is missing ${cli}.`);
}
const scratch = await Deno.makeTempDir({ prefix: "sigil release smoke 空 " });
const relocated = join(scratch, "bundle with spaces and Ω");
await copyDirectory(distribution, relocated);
const unrelated = await Deno.makeTempDir({
  prefix: "sigil-release-unrelated-",
});
const isolatedHome = join(scratch, "empty-home");
const isolatedCache = join(scratch, "empty-deno-cache");
const shims = join(scratch, "hostile-shims");
await Deno.mkdir(join(isolatedHome, ".config"), { recursive: true });
await Deno.mkdir(isolatedCache, { recursive: true });
await Deno.mkdir(shims, { recursive: true });
const shimMarker = join(shims, "unexpected-invocation.log");
for (
  const name of [
    "deno",
    "node",
    "npm",
    "npx",
    "cargo",
    "rustc",
    "tsc",
    "tsgo",
  ]
) {
  const shimPath = join(
    shims,
    Deno.build.os === "windows" ? `${name}.cmd` : name,
  );
  const script = Deno.build.os === "windows"
    ? `@echo off\necho ${name}>>"${shimMarker}"\nexit /b 97\n`
    : `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(name)} >> ${
      JSON.stringify(shimMarker)
    }\nexit 97\n`;
  await Deno.writeTextFile(
    shimPath,
    script,
    { mode: 0o700 },
  );
}
const inheritedPath = Deno.env.get("PATH") ?? "";
const isolatedEnv = {
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  DENO_DIR: isolatedCache,
  SIGIL_RUNTIME_DIR: "",
  PATH: Deno.build.os === "windows"
    ? `${shims};${inheritedPath}`
    : `${shims}:/usr/local/bin:/usr/bin:/bin`,
};
try {
  const relocatedCli = join(relocated, "bin", executable);
  const version = await run(
    [relocatedCli, "--version"],
    unrelated,
    false,
    isolatedEnv,
  );
  if (version.code !== 0 || !version.stdout.trim()) {
    throw new Error(
      `Packaged version command failed (${version.code}): ${version.stderr}`,
    );
  }
  const cliVersion = version.stdout.trim();
  if (!/^\d+\.\d+\.\d+$/.test(cliVersion)) {
    throw new Error("Packaged version command returned an invalid response.");
  }
  const doctor = await run(
    [relocatedCli, "doctor", "--format", "json"],
    unrelated,
    false,
    isolatedEnv,
  );
  const doctorJson = JSON.parse(doctor.stdout) as {
    command?: string;
    result?: { ok?: boolean };
  };
  if (doctorJson.command !== "doctor" || doctorJson.result?.ok !== true) {
    throw new Error("Packaged doctor did not report a ready runtime.");
  }

  const fixture = join(scratch, "fixture project");
  await writeFixture(fixture);
  const design = await run(
    [relocatedCli, "semantic", "status", fixture, "--format", "json"],
    unrelated,
    true,
    isolatedEnv,
  );
  const designJson = JSON.parse(design.stdout) as {
    status?: string;
    worldFingerprint?: string;
    diagnostics?: readonly unknown[];
  };
  if (
    design.code !== 1 || designJson.status !== "yellow" ||
    !designJson.worldFingerprint ||
    !designJson.diagnostics?.length
  ) {
    throw new Error(
      "Packaged semantic design fixture did not produce the expected unresolved design result.",
    );
  }
  try {
    const unexpected = await Deno.readTextFile(shimMarker);
    if (unexpected.trim()) {
      throw new Error(
        `Packaged CLI invoked a forbidden host tool: ${unexpected}`,
      );
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  const tampered = await Deno.makeTempDir({
    prefix: "sigil-release-tampered-",
  });
  try {
    await copyDirectory(distribution, tampered);
    const engineName = Deno.build.os === "windows"
      ? "sigil-semantic-engine.exe"
      : "sigil-semantic-engine";
    const engine = join(tampered, "lib/sigil/runtime/egglog", engineName);
    const bytes = await Deno.readFile(engine);
    bytes[0] ^= 0xff;
    await Deno.writeFile(engine, bytes);
    const failed = await run(
      [join(tampered, "bin", executable), "doctor", "--format", "json"],
      unrelated,
      true,
      isolatedEnv,
    );
    if (failed.code === 0) {
      throw new Error("Tampered runtime unexpectedly passed doctor.");
    }
  } finally {
    await Deno.remove(tampered, { recursive: true }).catch(() => {});
  }
  const missingRuntime = await Deno.makeTempDir({
    prefix: "sigil-release-missing-runtime-",
  });
  try {
    await Deno.mkdir(join(missingRuntime, "bin"), { recursive: true });
    await Deno.copyFile(cli, join(missingRuntime, "bin", executable));
    const failed = await run(
      [join(missingRuntime, "bin", executable), "doctor", "--format", "json"],
      unrelated,
      true,
      isolatedEnv,
    );
    if (
      failed.code === 0 ||
      !/runtime|engine/i.test(failed.stderr + failed.stdout)
    ) {
      throw new Error(
        "A bundle containing only bin/sigil did not report its missing runtime.",
      );
    }
  } finally {
    await Deno.remove(missingRuntime, { recursive: true }).catch(() => {});
  }
  const missingLibrary = await Deno.makeTempDir({
    prefix: "sigil-release-missing-library-",
  });
  try {
    await copyDirectory(distribution, missingLibrary);
    const manifestSource = await Deno.readTextFile(
      join(missingLibrary, "lib/sigil/runtime/manifest.json"),
    );
    const manifest = JSON.parse(manifestSource) as {
      files: readonly { path: string }[];
    };
    const library = manifest.files.find((file) =>
      file.path.startsWith("typescript/") && !file.path.endsWith("/tsc") &&
      !file.path.endsWith("/tsc.exe")
    );
    if (!library) {
      throw new Error("Release manifest has no TypeScript library fixture.");
    }
    await Deno.remove(
      join(missingLibrary, "lib/sigil/runtime", ...library.path.split("/")),
    );
    const failed = await run(
      [join(missingLibrary, "bin", executable), "doctor", "--format", "json"],
      unrelated,
      true,
      isolatedEnv,
    );
    if (
      failed.code === 0 ||
      !/integrity|typescript|runtime/i.test(failed.stderr + failed.stdout)
    ) {
      throw new Error(
        "A missing TypeScript library unexpectedly passed doctor.",
      );
    }
  } finally {
    await Deno.remove(missingLibrary, { recursive: true }).catch(() => {});
  }
  console.log(
    JSON.stringify({
      version: cliVersion,
      doctor: true,
      relocated: true,
      isolated: true,
      design: true,
      tamperRejected: true,
      missingRuntimeRejected: true,
      missingLibraryRejected: true,
    }),
  );
} finally {
  await Deno.remove(unrelated, { recursive: true }).catch(() => {});
  await Deno.remove(scratch, { recursive: true }).catch(() => {});
}

function parse(args: readonly string[]): string {
  const index = args.indexOf("--distribution");
  if (index < 0 || !args[index + 1] || args.length !== index + 2) {
    throw new Error(
      "Usage: test-cli-release.ts --distribution <extracted-directory>",
    );
  }
  return resolve(args[index + 1]);
}

async function run(
  command: readonly string[],
  cwd: string,
  allowFailure = false,
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const child = await new Deno.Command(command[0], {
    args: command.slice(1),
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const result = {
    stdout: new TextDecoder().decode(child.stdout),
    stderr: new TextDecoder().decode(child.stderr),
    code: child.code,
  };
  if (!allowFailure && result.code !== 0) {
    throw new Error(
      `${basename(command[0])} failed (${result.code}): ${result.stderr}`,
    );
  }
  return result;
}

async function writeFixture(root: string): Promise<void> {
  const source = join(import.meta.dirname!, "fixtures/release/project");
  await copyDirectory(source, root);
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory) await copyDirectory(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}
