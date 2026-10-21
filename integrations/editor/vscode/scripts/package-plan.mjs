/** The platforms a package can target, by the name `vsce package --target` takes. */
export const TARGETS = [
  "win32-x64",
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
];

/** The file name the extension looks for inside its `bin` folder. */
export function binaryFileName(target) {
  return target.startsWith("win32-") ? "sigil.exe" : "sigil";
}

/**
 * Reads `--target <vsce target> --binary <path>`. Neither means a package
 * without a shipped `sigil`, which relies on the setting or the `PATH`.
 */
export function parsePackageArguments(argv) {
  const options = { target: undefined, binary: undefined };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag !== "--target" && flag !== "--binary") {
      throw new Error(`Unknown option ${flag}; use --target and --binary.`);
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value.`);
    }
    options[flag.slice(2)] = value;
  }
  if (options.target !== undefined && !TARGETS.includes(options.target)) {
    throw new Error(
      `Unknown target ${options.target}; use one of ${TARGETS.join(", ")}.`,
    );
  }
  if (options.binary !== undefined && options.target === undefined) {
    throw new Error("--binary needs --target to say which platform it is for.");
  }
  return options;
}

/** Checks the binary's file name against the target, and names the package. */
export function packagePlan(manifestVersion, options) {
  if (options.target && options.binary) {
    const expected = binaryFileName(options.target);
    const name = options.binary.split(/[\\/]/).pop();
    if (name !== expected) {
      throw new Error(
        `The ${options.target} binary must be named ${expected}, not ${name}.`,
      );
    }
  }
  return {
    output: `build/sigil-vscode-${manifestVersion}${
      options.target ? `-${options.target}` : ""
    }.vsix`,
    shipped: options.binary
      ? `bin/${binaryFileName(options.target)}`
      : undefined,
  };
}
