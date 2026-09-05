import { assert, assertEquals, assertRejects } from "@std/assert";
import { analyzeTypeScript7 } from "../src/semantic/typescript7.ts";

async function workspace(app: string, files: Record<string, string> = {}) {
  const root = await Deno.makeTempDir({ prefix: "sigil-ts7-test-" });
  await Deno.writeTextFile(
    `${root}/tsconfig.json`,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "nodenext",
        target: "es2022",
        allowImportingTsExtensions: true,
      },
      files: ["app.ts"],
    }),
  );
  await Deno.writeTextFile(`${root}/app.ts`, app);
  for (const [file, text] of Object.entries(files)) {
    await Deno.writeTextFile(`${root}/${file}`, text);
  }
  return root;
}

Deno.test("TypeScript 7 native snapshot provides type diagnostics, AST imports and resolved call targets", async () => {
  const app =
    'import { bridge as delegate } from "./bridge.ts";\nexport const value: number = delegate("wrong");\n';
  const root = await workspace(app, {
    "bridge.ts":
      "export function bridge(value: number): number { return value; }\n",
  });
  try {
    const result = await analyzeTypeScript7({ root, project: "tsconfig.json" });
    assertEquals(result.analyzer, "typescript@7.0.2");
    assertEquals(result.files.map((f) => f.file).sort(), [
      "app.ts",
      "bridge.ts",
    ]);
    assert(
      result.diagnostics.some((d) =>
        d.code === 2345 && d.fileName === "app.ts"
      ),
    );
    assertEquals(
      result.dependencies.map((d) => [d.specifier, d.resolvedFile, d.typeOnly]),
      [["./bridge.ts", "bridge.ts", false]],
    );
    const call = result.calls.find((call) => call.expression === "delegate");
    assertEquals(call?.declaration?.file, "bridge.ts");
    assertEquals(call?.global, undefined);
    assertEquals(call?.line, 2);
    assertEquals(await Deno.readTextFile(`${root}/app.ts`), app);
    assertEquals(
      (await analyzeTypeScript7({ root, project: "tsconfig.json" }))
        .fingerprint,
      result.fingerprint,
    );
    await Deno.writeTextFile(`${root}/app.ts`, app.replace('"wrong"', "5"));
    const repaired = await analyzeTypeScript7({
      root,
      project: "tsconfig.json",
    });
    assertEquals(repaired.diagnostics.length, 0);
    assert(repaired.fingerprint !== result.fingerprint);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("TypeScript 7 distinguishes lexical shadowing and records opaque dynamic behavior", async () => {
  const root = await workspace(
    `export function local(Deno: {readTextFile(x:string):string}) { return Deno.readTextFile("local"); }
export const actual = Deno.readTextFile("global");
export async function dynamic(name: string, object: any) { await import(name); return object[name](); }
`,
  );
  try {
    const result = await analyzeTypeScript7({ root, project: "tsconfig.json" });
    const calls = result.calls.filter((call) =>
      call.expression === "Deno.readTextFile"
    );
    assertEquals(calls.length, 2);
    assertEquals(calls[0].global, undefined);
    assertEquals(calls[1].global, "Deno.readTextFile");
    assert(result.issues.some((issue) => issue.reason === "computed-import"));
    assert(result.issues.some((issue) => issue.reason === "computed-access"));
    assert(result.issues.some((issue) => issue.reason === "unresolved-call"));
    assert(result.diagnostics.some((d) => d.text.includes("Deno")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("TypeScript 7 syntax failures remain explicit diagnostics", async () => {
  const root = await workspace("export function broken( {\n");
  try {
    const result = await analyzeTypeScript7({ root, project: "tsconfig.json" });
    assert(result.diagnostics.some((diagnostic) => diagnostic.category === 1));
    assertEquals(result.files[0].file, "app.ts");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("TypeScript 7 cancellation and timeout reap native resources", async () => {
  const root = await workspace(
    Array.from(
      { length: 8000 },
      (_, i) => `export function item${i}(x: number): number { return x; }`,
    ).join("\n"),
  );
  try {
    const cancellation = new AbortController();
    const timer = setTimeout(() => cancellation.abort(), 15);
    try {
      await assertRejects(
        () =>
          analyzeTypeScript7({
            root,
            project: "tsconfig.json",
            signal: cancellation.signal,
          }),
        DOMException,
      );
    } finally {
      clearTimeout(timer);
    }
    await assertRejects(
      () =>
        analyzeTypeScript7({ root, project: "tsconfig.json", timeoutMs: 1 }),
      DOMException,
      "timed out",
    );
    const already = new AbortController();
    already.abort();
    await assertRejects(
      () =>
        analyzeTypeScript7({
          root,
          project: "tsconfig.json",
          signal: already.signal,
        }),
      DOMException,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
