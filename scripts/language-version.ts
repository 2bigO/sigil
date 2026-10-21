/**
 * The Sigil language version, read from the contract that owns it:
 * `docs/spec/sigil-config.sigil` states it once, as "the *language version*,
 * currently X.Y.Z". Repository scripts take the number from there; the Rust
 * core pins its own constant to the same sentence in a test.
 */
const CONTRACT = new URL("../docs/spec/sigil-config.sigil", import.meta.url);

export function languageVersionFromContract(text: string): string {
  const found = [
    ...text.matchAll(/\*language version\*,\s+currently\s+(\d+\.\d+\.\d+)/g),
  ];
  if (found.length !== 1) {
    throw new Error(
      `docs/spec/sigil-config.sigil: expected one "language version, currently X.Y.Z" sentence, found ${found.length}`,
    );
  }
  return found[0][1];
}

export const SIGIL_VERSION: string = languageVersionFromContract(
  await Deno.readTextFile(CONTRACT),
);
