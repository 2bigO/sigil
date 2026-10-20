/**
 * Checks a built platform package of the VS Code extension: it is for the
 * named target, it ships `bin/sigil`, and that `sigil`, extracted from the zip
 * the way an install would, answers a language-server session. A `.vsix` is a
 * zip, so a shipped binary can arrive without its mode bit; the extension
 * makes it executable before it starts it, and so does this check.
 *
 * Usage: deno run --allow-read --allow-write --allow-run --allow-env scripts/smoke-vsix.ts <package.vsix> <vsce target>
 */
import { join, resolve } from "node:path";
import { lspSmoke } from "./lsp-smoke.ts";

const root = resolve(import.meta.dirname!, "..");
const FIXTURE = join(root, "scripts/fixtures/release/project");

async function extract(archive: string, into: string): Promise<void> {
  // bsdtar reads zip files on macOS and Windows; Linux has unzip.
  const command = Deno.build.os === "linux"
    ? new Deno.Command("unzip", { args: ["-q", archive, "-d", into] })
    : new Deno.Command("tar", { args: ["-xf", archive, "-C", into] });
  const output = await command.output();
  if (!output.success) {
    throw new Error(
      `Could not extract ${archive}: ${
        new TextDecoder().decode(output.stderr)
      }`,
    );
  }
}

export async function smokeVsix(archive: string, target: string) {
  const dir = await Deno.makeTempDir({ prefix: "sigil vsix smoke Ω " });
  try {
    const unpacked = join(dir, "unpacked");
    await Deno.mkdir(unpacked);
    await extract(resolve(archive), unpacked);
    const manifest = await Deno.readTextFile(
      join(unpacked, "extension.vsixmanifest"),
    );
    if (!manifest.includes(`TargetPlatform="${target}"`)) {
      throw new Error(`${archive} is not a ${target} package`);
    }
    const windows = target.startsWith("win32-");
    const sigil = join(
      unpacked,
      "extension/bin",
      windows ? "sigil.exe" : "sigil",
    );
    await Deno.stat(sigil).catch(() => {
      throw new Error(`${archive} ships no ${sigil}`);
    });
    await Deno.stat(join(unpacked, "extension/dist/UNICODE-LICENSE.txt"));
    if (!windows) await Deno.chmod(sigil, 0o755);
    const workspace = join(dir, "workspace");
    await Deno.mkdir(join(workspace, ".sigil"), { recursive: true });
    await Deno.copyFile(
      join(FIXTURE, "fixture-config.json"),
      join(workspace, ".sigil/config.json"),
    );
    const document = join(workspace, "main.sigil");
    await Deno.copyFile(join(FIXTURE, "main.sigil"), document);
    return await lspSmoke({ executable: sigil, workspace, document });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

if (import.meta.main) {
  const [archive, target] = Deno.args;
  if (!archive || !target) {
    throw new Error("Usage: smoke-vsix.ts <package.vsix> <vsce target>");
  }
  console.log(JSON.stringify(await smokeVsix(archive, target)));
}
