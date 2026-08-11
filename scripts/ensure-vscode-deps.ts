const dependencyRoot = new URL(
  "../integrations/editor/vscode/node_modules/",
  import.meta.url,
);

try {
  await Deno.stat(new URL("esbuild/package.json", dependencyRoot));
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;

  const command = new Deno.Command("npm", {
    args: ["ci", "--prefix", "integrations/editor/vscode"],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const output = await command.output();
  if (!output.success) Deno.exit(output.code);
}
