import path from "node:path";

export type ServerExecutableSource = "setting" | "bundled" | "path";

export interface ServerExecutable {
  command: string;
  source: ServerExecutableSource;
}

export interface ServerExecutableInputs {
  /** The `sigil.executable` setting, as the user wrote it. */
  setting: string | undefined;
  /** The folder the extension is installed in. */
  extensionPath: string;
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
}

/**
 * The `sigil` the extension runs `lsp` from: the setting, then the `sigil`
 * shipped in the extension's `bin` folder, then `sigil` on the path.
 */
export function resolveServerExecutable(
  inputs: ServerExecutableInputs,
): ServerExecutable {
  const setting = inputs.setting?.trim();
  if (setting) return { command: setting, source: "setting" };
  const windows = inputs.platform === "win32";
  const bundled = (windows ? path.win32 : path.posix).join(
    inputs.extensionPath,
    "bin",
    windows ? "sigil.exe" : "sigil",
  );
  if (inputs.exists(bundled)) return { command: bundled, source: "bundled" };
  return { command: "sigil", source: "path" };
}

/**
 * A `.vsix` is a zip, which does not reliably keep the mode bit of a shipped
 * binary, so make it executable before it is started. A failure is logged: the
 * start that follows reports the real problem if the file cannot run.
 */
export async function prepareBundledExecutable(
  executable: ServerExecutable,
  platform: NodeJS.Platform,
  chmod: (path: string, mode: number) => Promise<void>,
  log: (line: string) => void,
): Promise<void> {
  if (executable.source !== "bundled" || platform === "win32") return;
  try {
    await chmod(executable.command, 0o755);
  } catch (error) {
    log(
      `Could not make ${executable.command} executable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
