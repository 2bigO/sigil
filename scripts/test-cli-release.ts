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
  await runPackagedPublicFlow(relocatedCli, unrelated, isolatedEnv, scratch);

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
      publicFlow: true,
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
      `${basename(command[0])} failed (${result.code}) [${
        command.slice(1).join(" ")
      }]: ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

async function writeFixture(root: string): Promise<void> {
  const source = join(import.meta.dirname!, "fixtures/release/project");
  await copyDirectory(source, root);
  const config = await Deno.readTextFile(join(root, "fixture-config.json"));
  await Deno.mkdir(join(root, ".sigil"), { recursive: true });
  await Deno.writeTextFile(join(root, ".sigil/config.json"), config);
  await Deno.remove(join(root, "fixture-config.json"));
}

async function writePublicFixture(root: string): Promise<void> {
  await Deno.mkdir(join(root, ".sigil"), { recursive: true });
  await Deno.writeTextFile(
    join(root, ".sigil/config.json"),
    JSON.stringify({
      sigilVersion: "0.7.0",
      workspace: { name: "packaged-public", members: [] },
      files: { include: ["**/*.sigil"], exclude: [] },
      tools: {},
    }),
  );
  await Deno.writeTextFile(
    join(root, "main.sigil"),
    `component Application {
  goal {
  }
  interface {
  }
}
`,
  );
  await Deno.writeTextFile(
    join(root, "app.ts"),
    "export function run() { return 1; }\n",
  );
  await Deno.writeTextFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true },
      files: ["app.ts"],
    }),
  );
}

async function runPackagedPublicFlow(
  cli: string,
  cwd: string,
  env: Record<string, string>,
  scratch: string,
): Promise<void> {
  const root = join(scratch, "packaged public flow");
  await writePublicFixture(root);
  const component = "urn:sigil:component:main.sigil:Application";
  const intent = "Keep application behavior independent of disk.";
  const contract = `urn:sigil:intent:${await sha256Text(intent)}`;
  const proposals = join(root, "proposals.json");
  await Deno.writeTextFile(
    proposals,
    JSON.stringify({
      version: 1,
      candidates: [{
        id: "packaged",
        additions: `@prefix s: <https://sigil.dev/ontology/1#> .
<urn:Disk> a s:Capability .
<urn:Generated> a s:Component; s:label "Generated" .
<${contract}> a s:Contract; s:required true; s:description "${intent}"; s:section "goal"; s:from <${component}>; s:relation "dependsOn"; s:target <urn:Disk>; s:expected false .
<${component}> s:hasContract <${contract}> .`,
        retractions: "",
      }],
    }),
  );
  const intentResult = await run(
    [
      cli,
      "semantic",
      "intent",
      root,
      "--text",
      intent,
      "--proposals",
      proposals,
      "--beam",
      "packaged-flow",
    ],
    cwd,
    false,
    env,
  );
  const intentJson = JSON.parse(intentResult.stdout) as { status?: string };
  if (intentJson.status !== "green") {
    throw new Error("Packaged public intent did not produce a green beam.");
  }
  const accepted = await run(
    [
      cli,
      "semantic",
      "accept",
      root,
      "--beam",
      "packaged-flow",
    ],
    cwd,
    false,
    env,
  );
  const acceptedJson = JSON.parse(accepted.stdout) as { revision?: string };
  if (!acceptedJson.revision) {
    throw new Error("Packaged acceptance omitted revision.");
  }
  await run(
    [
      cli,
      "semantic",
      "project",
      root,
      "--write",
      "--expected-revision",
      acceptedJson.revision,
    ],
    cwd,
    false,
    env,
  );
  const listed = await run(
    [
      cli,
      "semantic",
      "status",
      root,
      "--list",
      "components",
    ],
    cwd,
    false,
    env,
  );
  const components = JSON.parse(listed.stdout) as {
    items?: readonly { id?: string; authoredPath?: string | null }[];
  };
  if (
    !components.items?.some((item) =>
      item.id === "urn:Generated" && item.authoredPath === null
    )
  ) {
    throw new Error(
      "Packaged public flow lost its generated component identity.",
    );
  }
  await Deno.writeTextFile(
    join(root, ".sigil/implementation.json"),
    JSON.stringify({
      version: 1,
      project: "tsconfig.json",
      components: [{ entity: component, files: ["app.ts"], exhaustive: true }],
      targets: [{
        entity: "urn:Disk",
        declarations: [{ file: "app.ts", symbol: "run" }],
      }],
    }),
  );
  const slice = await run(
    [
      cli,
      "semantic",
      "slice",
      root,
      "--component",
      component,
    ],
    cwd,
    false,
    env,
  );
  const sliceJson = JSON.parse(slice.stdout) as {
    artifacts?: { handoff?: string };
  };
  const handoff = sliceJson.artifacts?.handoff;
  if (!handoff) throw new Error("Packaged public slice omitted its handoff.");
  const manifest = JSON.parse(
    await Deno.readTextFile(
      join(root, ".sigil/handoffs", handoff, "handoff.json"),
    ),
  ) as {
    obligations?: readonly {
      id: string;
      subject: string;
      relation: string;
      target: string;
      expected: boolean;
    }[];
  };
  const obligation = manifest.obligations?.find((item) =>
    item.subject === component
  );
  if (!obligation) {
    throw new Error("Packaged public handoff omitted its obligation.");
  }
  const returned = join(scratch, "packaged returned checkout");
  await copyDirectory(root, returned);
  const submission = join(scratch, "packaged receipt submission");
  await Deno.mkdir(submission, { recursive: true });
  const fingerprint = await sha256(
    await Deno.readFile(join(returned, "app.ts")),
  );
  const claims = join(submission, "claims.ttl");
  const locations = join(submission, "locations.json");
  await Deno.writeTextFile(
    claims,
    `@prefix s: <https://sigil.dev/ontology/1#> .
<urn:packaged:receipt> a s:Evidence; s:covers <${obligation.id}>; s:from <${obligation.subject}>; s:relation "${obligation.relation}"; s:target <${obligation.target}>; s:expected ${obligation.expected} .`,
  );
  await Deno.writeTextFile(
    locations,
    JSON.stringify({
      version: 1,
      handoff,
      receipts: {
        "urn:packaged:receipt": {
          locations: [{ file: "app.ts", fingerprint, symbol: "run" }],
        },
      },
    }),
  );
  const imported = await run(
    [
      cli,
      "semantic",
      "receipts",
      returned,
      "--handoff",
      handoff,
      "--handoff-root",
      root,
      "--claims",
      claims,
      "--locations",
      locations,
    ],
    cwd,
    false,
    env,
  );
  const receiptId =
    (JSON.parse(imported.stdout) as { artifacts?: { receipts?: string } })
      .artifacts?.receipts;
  if (!receiptId) {
    throw new Error("Packaged receipt import omitted its artifact identity.");
  }
  const verified = await run(
    [
      cli,
      "semantic",
      "verify",
      returned,
      "--handoff",
      handoff,
      "--handoff-root",
      root,
      "--receipts",
      receiptId,
    ],
    cwd,
    false,
    env,
  );
  const report = JSON.parse(verified.stdout) as {
    status?: string;
    receiptResults?: readonly { status?: string }[];
  };
  if (
    report.status !== "green" ||
    !report.receiptResults?.some((item) => item.status === "supported")
  ) {
    throw new Error("Packaged public receipt verification did not pass.");
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

async function sha256Text(value: string): Promise<string> {
  return await sha256(new TextEncoder().encode(value));
}

async function sha256(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map(
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
