import assert from "node:assert/strict";
import test from "node:test";
import {
  packagePlan,
  parsePackageArguments,
  TARGETS,
} from "../../scripts/package-plan.mjs";

/*
 * @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::ExtensionPackage interface,constraints,cases
 */
test("an unknown target is rejected and the valid ones are listed", () => {
  assert.throws(
    () => parsePackageArguments(["--target", "plan9-x64"]),
    (error: Error) =>
      error.message.includes("plan9-x64") &&
      TARGETS.every((target) => error.message.includes(target)),
  );
});

test("a flag without a value, an unknown flag and a binary without a target are rejected", () => {
  assert.throws(() => parsePackageArguments(["--target"]), /needs a value/);
  assert.throws(
    () => parsePackageArguments(["--target", "--binary", "x"]),
    /needs a value/,
  );
  assert.throws(
    () => parsePackageArguments(["--bogus", "x"]),
    /Unknown option/,
  );
  assert.throws(
    () => parsePackageArguments(["--binary", "/x/sigil"]),
    /needs --target/,
  );
});

test("a Windows binary must be named sigil.exe and the others sigil", () => {
  assert.throws(
    () => packagePlan("0.8.0", { target: "win32-x64", binary: "C:\\b\\sigil" }),
    /must be named sigil\.exe, not sigil/,
  );
  assert.throws(
    () => packagePlan("0.8.0", { target: "linux-x64", binary: "/b/sigil.exe" }),
    /must be named sigil, not sigil\.exe/,
  );
  assert.equal(
    packagePlan("0.8.0", { target: "win32-x64", binary: "C:\\b\\sigil.exe" })
      .shipped,
    "bin/sigil.exe",
  );
});

test("the package name carries the target so the five files can be told apart", () => {
  assert.equal(
    packagePlan("0.8.0", { target: "darwin-arm64", binary: "/b/sigil" })
      .output,
    "build/sigil-vscode-0.8.0-darwin-arm64.vsix",
  );
  assert.deepEqual(
    TARGETS,
    ["win32-x64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"],
  );
});

test("with no flags the package is the plain one and ships no sigil", () => {
  assert.deepEqual(parsePackageArguments([]), {
    target: undefined,
    binary: undefined,
  });
  assert.deepEqual(packagePlan("0.8.0", {}), {
    output: "build/sigil-vscode-0.8.0.vsix",
    shipped: undefined,
  });
});
