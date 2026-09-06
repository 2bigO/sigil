import { join, resolve } from "node:path";

const args = parseArgs(Deno.args);
const repository = resolve(import.meta.dirname!, "..");
const runtime = resolve(args.runtime);
const stage = await Deno.makeTempDir({ prefix: "sigil-published-consumer-" });
const cachedDenoDir = Deno.env.get("DENO_DIR") ??
  join(Deno.env.get("HOME") ?? stage, ".cache/deno");

try {
  await copyPublishedPackage(
    join(repository, "packages/core"),
    join(stage, "packages/core"),
  );
  await copyPublishedPackage(
    join(repository, "packages/compiler"),
    join(stage, "packages/compiler"),
  );
  await Deno.mkdir(join(stage, "consumer"), { recursive: true });
  await Deno.copyFile(
    join(repository, "scripts/fixtures/published-consumer/consumer.ts"),
    join(stage, "consumer/consumer.ts"),
  );
  await Deno.writeTextFile(
    join(stage, "consumer/deno.json"),
    JSON.stringify(
      {
        imports: {
          "@qoherent/sigil-compiler": "../packages/compiler/src/mod.ts",
          "@qoherent/sigil-core": "../packages/core/src/mod.ts",
          "n3": "npm:n3@1.26.0",
          "n3-types": "npm:@types/n3@1.26.0",
          "typescript7": "npm:typescript@7.0.2",
        },
      },
      null,
      2,
    ) + "\n",
  );
  const child = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--config",
      join(stage, "consumer/deno.json"),
      "--allow-env",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      join(stage, "consumer/consumer.ts"),
    ],
    cwd: stage,
    env: {
      HOME: join(stage, "home"),
      DENO_DIR: cachedDenoDir,
      SIGIL_RUNTIME_DIR: "",
      SIGIL_TEST_RUNTIME: runtime,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(child.stdout);
  const stderr = new TextDecoder().decode(child.stderr);
  if (!child.success) {
    throw new Error(
      `Published consumer failed (${child.code}): ${stderr || stdout}`,
    );
  }
  const result = JSON.parse(stdout) as {
    explicit?: boolean;
    missingRuntimeRejected?: boolean;
    doctor?: boolean;
  };
  if (
    result.explicit !== true || result.missingRuntimeRejected !== true ||
    result.doctor !== true
  ) throw new Error(`Published consumer returned an invalid result: ${stdout}`);
  console.log(stdout.trim());
} finally {
  await Deno.remove(stage, { recursive: true }).catch(() => {});
}

function parseArgs(argv: readonly string[]): { runtime: string } {
  const index = argv.indexOf("--runtime");
  if (index < 0 || !argv[index + 1] || argv.length !== index + 2) {
    throw new Error(
      "Usage: test-published-runtime.ts --runtime <runtime-directory>",
    );
  }
  return { runtime: argv[index + 1] };
}

async function copyPublishedPackage(
  source: string,
  target: string,
): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    if (
      entry.name === "tests" || entry.name === "node_modules" ||
      entry.name === "native"
    ) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory) await copyPublishedPackage(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}
