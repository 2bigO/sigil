import { DenoSigilFileSystem } from "../src/filesystem.ts";

Deno.test("LSP filesystem excludes managed views from authored discovery", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-lsp-" });
  try {
    await Deno.mkdir(`${root}/.sigil/views`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/auth.sigil`,
      "component Auth {\n  goal {\n    Auth.\n  }\n}\n",
    );
    await Deno.writeTextFile(
      `${root}/.sigil/views/generated.sigil`,
      "component Generated {\n  goal {\n    Generated.\n  }\n}\n",
    );
    const files = await new DenoSigilFileSystem().listFiles(root);
    if (!files.some((path) => path.endsWith("/auth.sigil"))) {
      throw new Error("authored source was omitted");
    }
    if (files.some((path) => path.includes("/.sigil/views/"))) {
      throw new Error("managed view leaked into authored discovery");
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
