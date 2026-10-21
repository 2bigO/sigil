import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { treeSha256, writeJson } from "../agent-runner/files.ts";
import { CoverageError } from "./coverage.ts";
import {
  measureDesign,
  type MeasureInput,
  requirementInputs,
  sigilcIdentity,
} from "./measure.ts";
import { REPO_ROOT } from "./records.ts";
import { renderMeasureReport } from "./report.ts";
import { facetHandles, readDesignTree } from "./structure.ts";
import {
  coverageFile,
  SIGILC,
  tempDir,
  TWO_COMPONENTS,
  writeDesign,
} from "./testing.ts";

const BENCHMARK = "slotted-with-split";

async function cannedStore(): Promise<string> {
  const store = await tempDir();
  const dir = join(store, "claims", "interpretations");
  await mkdir(dir, { recursive: true });
  // A reading no current key matches; sigilc ignores it and may prune it, but
  // only in the scratch copy.
  await writeFile(join(dir, "0000.json"), '{"version":1}\n');
  return store;
}

async function input(
  root: string,
  store: string | null,
  extra: Partial<MeasureInput> = {},
): Promise<MeasureInput> {
  return {
    sigilc: SIGILC,
    root,
    store,
    coverage: { reason: "no coverage reading given" },
    requirements: await requirementInputs(BENCHMARK),
    ...extra,
  };
}

describe("measure mode", () => {
  test("AE2: measuring the same design and store twice gives byte-identical reports", async () => {
    const root = await writeDesign(await tempDir(), TWO_COMPONENTS);
    const store = await cannedStore();
    const sigilc = await sigilcIdentity(SIGILC);
    const render = async () =>
      renderMeasureReport({
        benchmark: BENCHMARK,
        sigilc,
        requirements: await requirementInputs(BENCHMARK),
        measures: await measureDesign(await input(root, store)),
      });
    const first = await render();
    expect(await render()).toBe(first);
    expect(first).toContain("| Design: components | 2 |");
  });

  test("leaves a committed design and its store byte-identical", async () => {
    const root = await writeDesign(await tempDir(), TWO_COMPONENTS);
    const store = await cannedStore();
    const before = [await treeSha256(root), await treeSha256(store)];
    await measureDesign(await input(root, store));
    expect([await treeSha256(root), await treeSha256(store)]).toEqual(before);
  });

  test("leaves examples/slotted byte-identical", async () => {
    const root = join(REPO_ROOT, "examples", "slotted");
    const store = await tempDir();
    const before = await treeSha256(root);
    const measures = await measureDesign(await input(root, store));
    expect(await treeSha256(root)).toBe(before);
    expect(measures.structure.components).toBe(7);
  });

  test("takes state, findings by class and law, and unread units from sigilc check", async () => {
    const root = await writeDesign(await tempDir(), TWO_COMPONENTS);
    const measures = await measureDesign(await input(root, await tempDir()));
    expect(measures.claims.status).toBe("available");
    if (measures.claims.status !== "available") return;
    const claims = measures.claims.value;
    // No readings are stored, so every unit is unread.
    expect(claims.state).toBe("incomplete");
    expect(claims.unreadUnits).toBeGreaterThan(0);
    expect(claims.interpretations).toBe(0);
    expect(Object.keys(claims.byClassLaw).every((key) => key.includes(" / ")))
      .toBe(true);
    expect(
      Object.values(claims.byClassLaw).reduce((sum, n) => sum + n, 0),
    ).toBe(claims.findings);
    expect(claims.guidanceFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a design that does not parse is measured structurally, with claims and coverage unavailable", async () => {
    const root = await writeDesign(await tempDir(), {
      "a.sigil": "component A {\n  goal {\n    Keep it.\n  }\n  state {\n",
    });
    const measures = await measureDesign(await input(root, null));
    expect(measures.structure.invalidSources).toEqual(["a.sigil"]);
    expect(measures.claims).toEqual({
      status: "unavailable",
      reason: "the design does not parse: a.sigil",
    });
    expect(measures.coverage.status).toBe("unavailable");
  });

  test("a claims stage that did not finish leaves claims unavailable without a check", async () => {
    const root = await writeDesign(await tempDir(), TWO_COMPONENTS);
    const measures = await measureDesign(
      await input(root, null, { claimsUnavailable: "claims stage failed" }),
    );
    expect(measures.claims).toEqual({
      status: "unavailable",
      reason: "claims stage failed",
    });
  });

  test("validates a coverage reading against the tree and the current requirement inputs", async () => {
    const root = await writeDesign(await tempDir(), TWO_COMPONENTS);
    const requirements = await requirementInputs(BENCHMARK);
    const ids = requirements.list.requirements.map((entry) => entry.id);
    const handle = facetHandles(await readDesignTree(SIGILC, root))[0]!;
    const digests = {
      list: requirements.listDigest,
      files: { [BENCHMARK]: requirements.requirementFileDigest },
    };
    const dir = await tempDir();
    const good = join(dir, "good.json");
    await writeJson(
      good,
      coverageFile(ids, digests, {
        R22: [{ id: handle.id, label: handle.label }],
      }),
    );
    const accepted = await measureDesign(
      await input(root, null, { coverage: { path: good } }),
    );
    expect(accepted.coverage.status).toBe("available");
    if (accepted.coverage.status === "available") {
      expect(accepted.coverage.value.answered).toBe(1);
      expect(accepted.coverage.value.none).toBe(ids.length - 1);
    }

    const bad = join(dir, "bad.json");
    await writeJson(
      bad,
      coverageFile(ids, digests, {
        R22: [{ id: "facet:not-in-tree", label: "x" }],
      }),
    );
    const rejected = measureDesign(
      await input(root, null, { coverage: { path: bad } }),
    );
    await expect(rejected).rejects.toBeInstanceOf(CoverageError);
    await expect(rejected).rejects.toThrow("facet:not-in-tree");
    const shown = await measureDesign(
      await input(root, null, {
        coverage: { path: bad },
        onCoverageError: "unavailable",
      }),
    );
    expect(shown.coverage.status).toBe("unavailable");
    if (shown.coverage.status === "unavailable") {
      expect(shown.coverage.reason).toContain("facet:not-in-tree");
    }
  });
});
