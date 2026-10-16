/**
 * Writes the differential formatter fixtures that the Rust core tests read:
 * `packages/core/tests/fixtures/format/differential.json`.
 *
 * Each case is one Sigil source in a small workspace, in three shapes (as
 * written, with its prose unwrapped, and unwrapped and indented), together with
 * what the TS formatter returns for it. Run it after a change to the TS
 * formatter or to a source in the corpus; the Rust test fails on any
 * difference, so it never needs Deno.
 */
import {
  formatSigilDocument,
  InMemorySigilFileSystem,
  loadSigilWorkspace,
  parseSigilDocument,
  resolveSigilWorkspace,
} from "../packages/core/src/mod.ts";

const root = new URL("..", import.meta.url).pathname;
const VERSION = "0.9.0";
const CONFIG = JSON.stringify({
  sigilVersion: VERSION,
  workspace: { name: "format-corpus" },
  files: { include: ["**/*.sigil"] },
});

async function git(...args: string[]): Promise<string[]> {
  const out = await new Deno.Command("git", { args, cwd: root }).output();
  return new TextDecoder().decode(out.stdout).split("\n").filter(Boolean);
}

type Files = Record<string, string>;
interface Workspace {
  name: string;
  files: Files;
}

/** Each tracked workspace config roots one workspace of its own sources. */
async function repositoryWorkspaces(): Promise<Workspace[]> {
  const configs = (await git("ls-files", "*.sigil/config.json")).concat(
    await git("ls-files", ".sigil/config.json"),
  );
  const roots = [
    ...new Set(configs.map((c) => c.replace(/\.sigil\/config\.json$/, ""))),
  ];
  const sources = await git("ls-files", "*.sigil");
  const workspaces: Workspace[] = [];
  for (const base of roots) {
    const nested = roots.filter((r) => r !== base && r.startsWith(base));
    const files: Files = {};
    for (const path of sources) {
      if (!path.startsWith(base) || nested.some((n) => path.startsWith(n))) {
        continue;
      }
      files[path.slice(base.length)] = await Deno.readTextFile(root + path);
    }
    if (Object.keys(files).length) {
      workspaces.push({ name: base || "repository", files });
    }
  }
  return workspaces;
}

async function fixtureWorkspaces(): Promise<Workspace[]> {
  const names = ["design-input-080", "design-cycle-080", "design-scope-080"];
  const out: Workspace[] = [];
  for (const name of names) {
    const value = JSON.parse(
      await Deno.readTextFile(
        `${root}packages/core/tests/fixtures/${name}.json`,
      ),
    ) as { sources: { path: string; text: string }[] };
    const files: Files = {};
    for (const source of value.sources) files[source.path] = source.text;
    out.push({ name, files });
  }
  return out;
}

/** Join each facet's prose lines into one line, optionally indented further. */
function unwrap(path: string, source: string, extraIndent: string): string {
  const { document } = parseSigilDocument(path, source, {
    sigilVersion: VERSION,
  });
  const map = document.source;
  if (!map || !document.complete) return source;
  const prose = new Map<number, number>();
  let facetId = 0;
  for (const component of document.components) {
    for (const section of component.sections) {
      for (const facet of section.units) {
        facetId++;
        const first = (map.locationAtByte(facet.proseRange.start)?.line ?? 1) -
          1;
        for (
          let i = first;
          i < map.lines.length && map.lines[i].start < facet.proseRange.end;
          i++
        ) prose.set(i, facetId);
      }
    }
  }
  const out: string[] = [];
  for (let i = 0; i < map.lines.length;) {
    const id = prose.get(i);
    if (id === undefined) {
      out.push(map.lines[i].content + map.lines[i].ending);
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < map.lines.length && prose.get(j + 1) === id) j++;
    const indent = map.lines[i].content.match(/^[ \t]*/)![0];
    const text = map.lines.slice(i, j + 1).map((l) => l.content.trim()).join(
      " ",
    );
    out.push(extraIndent + indent + text + map.lines[j].ending);
    i = j + 1;
  }
  return out.join("");
}

async function formatCase(files: Files, path: string, input: string) {
  const all: Files = { ".sigil/config.json": CONFIG, ...files, [path]: input };
  const workspace = await loadSigilWorkspace(new InMemorySigilFileSystem(all), {
    startPath: ".",
    explicitRoot: ".",
  });
  const resolved = resolveSigilWorkspace(workspace);
  const file = workspace.files.find((f) => f.path === path);
  if (!file) throw new Error(`not loaded: ${path}`);
  const result = formatSigilDocument(
    file.document,
    file.source ?? "",
    resolved,
  );
  return {
    formatted: result.formattedSource ?? null,
    changed: result.changed,
    codes: result.diagnostics.map((d) => d.code).sort(),
  };
}

const workspaces = [
  ...await repositoryWorkspaces(),
  ...await fixtureWorkspaces(),
];
const out = [];
for (const workspace of workspaces) {
  const cases = [];
  for (const path of Object.keys(workspace.files).sort()) {
    const original = workspace.files[path];
    const variants: [string, string][] = [
      ["as-written", original],
      ["unwrapped", unwrap(path, original, "")],
      ["unwrapped-indented", unwrap(path, original, "      ")],
    ];
    for (const [variant, input] of variants) {
      cases.push({
        path,
        variant,
        input,
        expected: await formatCase(workspace.files, path, input),
      });
    }
  }
  out.push({ name: workspace.name, files: workspace.files, cases });
}
const target = `${root}packages/core/tests/fixtures/format/differential.json`;
await Deno.mkdir(`${root}packages/core/tests/fixtures/format`, {
  recursive: true,
});
await Deno.writeTextFile(target, JSON.stringify(out, null, 2) + "\n");
const total = out.reduce((n, w) => n + w.cases.length, 0);
console.log(`${out.length} workspaces, ${total} cases`);
