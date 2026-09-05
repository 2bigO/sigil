/** Build the pinned native egglog bridge used by semantic compilation. */
import { fileURLToPath } from "node:url";
const manifest = fileURLToPath(
  new URL("../packages/compiler/native/Cargo.toml", import.meta.url),
);
let cargo = "cargo";
try {
  const probe = await new Deno.Command(cargo, {
    args: ["--version"],
    stdout: "null",
  }).output();
  if (!probe.success) throw new Error("cargo unavailable");
} catch {
  const userDirectory = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!userDirectory) {
    throw new Error(
      "Install Rust with rustup, then make cargo available on PATH.",
    );
  }
  cargo = `${userDirectory}/.cargo/bin/cargo`;
}
const result = await new Deno.Command(cargo, {
  args: ["build", "--manifest-path", manifest, "--release", "--locked"],
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!result.success) Deno.exit(result.code);
