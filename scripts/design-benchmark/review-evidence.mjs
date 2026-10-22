import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Offsets are zero-based UTF-8 bytes, with an exclusive end. */
export async function readEvidence(path, sha256, start, end) {
  if (typeof path !== "string" || !path) {
    throw new Error("Expected a file path");
  }
  const target = await realpath(resolve(root, path));
  const inside = relative(await realpath(root), target);
  if (
    inside === ".." || inside.startsWith("../") || inside.startsWith("..\\") ||
    isAbsolute(inside)
  ) {
    throw new Error("Evidence must stay inside the staged directory");
  }
  if (
    sha256 !== undefined &&
    (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))
  ) {
    throw new Error("Expected a full lowercase SHA-256 digest");
  }
  if ((start !== undefined || end !== undefined) && sha256 === undefined) {
    throw new Error("Byte extraction requires the expected SHA-256");
  }
  const bytes = await readFile(target);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== undefined && digest !== sha256) {
    throw new Error("SHA-256 mismatch");
  }
  start ??= 0;
  end ??= bytes.length;
  if (
    !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
    end < start || end > bytes.length
  ) {
    throw new Error("Invalid UTF-8 byte range");
  }
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    .decode(bytes.subarray(start, end));
  return { path: target, sha256: digest, start, end, text };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--guard") {
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      const call = JSON.parse(input);
      const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
      const prefix = [
        quote(process.execPath),
        ...(process.versions.deno
          ? ["run", "--no-config", "--no-lock", quote(`--allow-read=${root}`)]
          : []),
        quote(fileURLToPath(import.meta.url)),
      ].join(" ") + " ";
      const command = call.tool_input?.command;
      if (
        call.tool_name !== "Bash" || typeof command !== "string" ||
        !command.startsWith(prefix) ||
        !/^[a-zA-Z0-9_./:\\ '"-]+$/.test(command.slice(prefix.length))
      ) {
        process.stderr.write(
          "Reviewer may run only the staged evidence helper with inert arguments\n",
        );
        process.exitCode = 2;
      }
    } else {
      if (![1, 2, 4].includes(args.length)) {
        throw new Error("Usage: FILE [SHA256 [START END]]");
      }
      const result = await readEvidence(
        args[0],
        args[1],
        args[2] === undefined ? undefined : Number(args[2]),
        args[3] === undefined ? undefined : Number(args[3]),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  } catch (error) {
    process.stderr.write(String(error.message ?? error) + "\n");
    // Claude blocks a PreToolUse call only on exit 2; malformed input fails shut.
    process.exitCode = process.argv[2] === "--guard" ? 2 : 1;
  }
}
