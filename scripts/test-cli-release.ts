import { basename, join, resolve } from "node:path";

const distribution = parse(Deno.args);
const executable = Deno.build.os === "windows" ? "sigil.exe" : "sigil";
const cli = join(distribution, "bin", executable);
if (!(await Deno.stat(cli)).isFile) {
  throw new Error(`Release is missing ${cli}.`);
}
const unrelated = await Deno.makeTempDir({ prefix: "sigil-release-smoke-" });
try {
  const version = await run([cli, "--version"], unrelated);
  if (version.code !== 0 || !version.stdout.trim()) {
    throw new Error(
      `Packaged version command failed (${version.code}): ${version.stderr}`,
    );
  }
  const cliVersion = version.stdout.trim();
  if (!/^\d+\.\d+\.\d+$/.test(cliVersion)) {
    throw new Error("Packaged version command returned an invalid response.");
  }
  const doctor = await run([cli, "doctor", "--format", "json"], unrelated);
  const doctorJson = JSON.parse(doctor.stdout) as {
    command?: string;
    result?: { ok?: boolean };
  };
  if (doctorJson.command !== "doctor" || doctorJson.result?.ok !== true) {
    throw new Error("Packaged doctor did not report a ready runtime.");
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
    );
    if (failed.code === 0) {
      throw new Error("Tampered runtime unexpectedly passed doctor.");
    }
  } finally {
    await Deno.remove(tampered, { recursive: true }).catch(() => {});
  }
  console.log(
    JSON.stringify({
      version: cliVersion,
      doctor: true,
      tamperRejected: true,
    }),
  );
} finally {
  await Deno.remove(unrelated, { recursive: true }).catch(() => {});
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
): Promise<{ stdout: string; stderr: string; code: number }> {
  const child = await new Deno.Command(command[0], {
    args: command.slice(1),
    cwd,
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

async function copyDirectory(source: string, target: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory) await copyDirectory(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}
