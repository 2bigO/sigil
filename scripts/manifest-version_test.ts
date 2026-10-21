import { deepStrictEqual as equal, throws } from "node:assert/strict";
import { resolve } from "node:path";
import {
  cargoPackageVersion,
  readCargoPackageVersion,
} from "./manifest-version.ts";
import {
  languageVersionFromContract,
  SIGIL_VERSION,
} from "./language-version.ts";

const root = resolve(import.meta.dirname!, "..");

Deno.test("the CLI manifest's version is read from its [package] table", async () => {
  const version = await readCargoPackageVersion(
    resolve(root, "packages/cli/Cargo.toml"),
  );
  equal(/^\d+\.\d+\.\d+$/.test(version), true);
});

Deno.test("a version outside [package] is not the package version", () => {
  const text = [
    "[package]",
    'name = "demo"',
    'version = "1.2.3"  # the release',
    "",
    "[dependencies]",
    'serde = { version = "1", features = ["derive"] }',
    "",
    "[profile.release]",
    'version = "9.9.9"',
  ].join("\n");
  equal(cargoPackageVersion(text, "demo/Cargo.toml"), "1.2.3");
});

Deno.test("a manifest with no package version is refused", () => {
  throws(
    () =>
      cargoPackageVersion(
        '[package]\nname = "demo"\n\n[dependencies]\nversion = "2"\n',
        "demo/Cargo.toml",
      ),
    /demo\/Cargo.toml: \[package\] declares no version/,
  );
});

Deno.test("a manifest that declares two package versions is refused", () => {
  throws(
    () =>
      cargoPackageVersion(
        '[package]\nversion = "1.0.0"\nversion = "1.0.1"\n',
        "demo/Cargo.toml",
      ),
    /more than one version/,
  );
});

Deno.test("the language version is the contract's one stated version", () => {
  equal(SIGIL_VERSION, "0.9.0");
  equal(
    languageVersionFromContract(
      "SpecWorkspaceConfig provides the *language version*, currently 0.10.2, which\ntells a tool.",
    ),
    "0.10.2",
  );
});

Deno.test("a contract with no or several language version sentences is refused", () => {
  throws(() => languageVersionFromContract("nothing here"), /found 0/);
  throws(
    () =>
      languageVersionFromContract(
        "the *language version*, currently 0.9.0\nthe *language version*, currently 0.9.1",
      ),
    /found 2/,
  );
});
