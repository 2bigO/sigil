import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  computeClosure,
  decodeClosureResponse,
} from "../src/semantic/engine.ts";
import {
  parseSemanticWorld,
  serializeSemanticWorld,
} from "../src/semantic/turtle.ts";
import {
  readSemanticState,
  writeSemanticState,
} from "../src/semantic/store.ts";

Deno.test("engine protocol rejects missing tables and malformed rows before status calculation", async () => {
  const world = await parseSemanticWorld([]);
  const result = await computeClosure(world);
  assertEquals(decodeClosureResponse(JSON.stringify(result)), result);
  const malformed = [
    null,
    [],
    {},
    { ...result, tables: {} },
    { ...result, tables: { ...result.tables, invented: [] } },
    { ...result, tables: { ...result.tables, violation: [["too", "short"]] } },
    {
      ...result,
      tables: { ...result.tables, "path-cost": [["a", "b", "NaN"]] },
    },
    { ...result, tables: { ...result.tables, "risk-score": [["a", -1]] } },
    { ...result, tables: { ...result.tables, known: [null] } },
  ];
  for (const value of malformed) {
    assertThrows(() => decodeClosureResponse(JSON.stringify(value)));
  }
  assertThrows(
    () => decodeClosureResponse(" ".repeat(16 * 1024 * 1024 + 1)),
    Error,
    "limit",
  );
});

Deno.test({
  name: "engine timeout and cancellation reap an uncooperative native process",
  ignore: Deno.build.os === "windows",
  async fn() {
    const directory = await Deno.makeTempDir();
    try {
      const executable = `${directory}/engine`;
      // No descendants: this shell models the bridge ignoring graceful termination.
      await Deno.writeTextFile(
        executable,
        "#!/bin/sh\ntrap '' TERM\nwhile :; do :; done\n",
        { mode: 0o700 },
      );
      const world = await parseSemanticWorld([]);
      await assertRejects(
        () => computeClosure(world, { binaryPath: executable, timeoutMs: 40 }),
        DOMException,
        "timed out",
      );
      const cancellation = new AbortController();
      const timer = setTimeout(
        () => cancellation.abort(new Error("host reason")),
        40,
      );
      try {
        await assertRejects(
          () =>
            computeClosure(world, {
              binaryPath: executable,
              signal: cancellation.signal,
            }),
          Error,
          "host reason",
        );
      } finally {
        clearTimeout(timer);
      }
      await Deno.writeTextFile(
        executable,
        '#!/bin/sh\nprintf \'{"version":1,"kernelVersion":"1","tables":{}}\'\n',
      );
      await assertRejects(
        () => computeClosure(world, { binaryPath: executable }),
        Error,
        "tables",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test("canonical writes retain immutable snapshots and release locks on stale or corrupt state", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const world = await parseSemanticWorld([]);
    const receipt = {
      version: 1 as const,
      worldFingerprint: world.fingerprint,
      sourceFingerprint: world.fingerprint,
      componentBindings: {},
    };
    await writeSemanticState(directory, { world, receipt });
    const path = `${directory}/.sigil/worlds/${world.fingerprint}.ttl`;
    const commented = "# preserved snapshot bytes\n" +
      serializeSemanticWorld(world);
    await Deno.writeTextFile(path, commented);
    await writeSemanticState(directory, { world, receipt }, world.fingerprint);
    assertEquals(await Deno.readTextFile(path), commented);
    await assertRejects(
      () => writeSemanticState(directory, { world, receipt }),
      Error,
      "changed",
    );
    await writeSemanticState(directory, { world, receipt }, world.fingerprint);
    const next = await parseSemanticWorld([{
      sourceId: "next",
      turtle: "<urn:x> a <https://sigil.dev/ontology/1#Component> .",
    }]);
    const nextReceipt = { ...receipt, worldFingerprint: next.fingerprint };
    const nextPath = `${directory}/.sigil/worlds/${next.fingerprint}.ttl`;
    await Deno.writeTextFile(nextPath, commented);
    await assertRejects(
      () =>
        writeSemanticState(
          directory,
          { world: next, receipt: nextReceipt },
          world.fingerprint,
        ),
      Error,
      "immutable",
    );
    assertEquals(
      (await readSemanticState(directory))?.world.fingerprint,
      world.fingerprint,
    );
    await Deno.remove(nextPath);
    await writeSemanticState(
      directory,
      { world: next, receipt: nextReceipt },
      world.fingerprint,
    );
    assertEquals(
      (await readSemanticState(directory))?.world.fingerprint,
      next.fingerprint,
    );
    assertEquals(await Deno.readTextFile(path), commented);
    const entries = [];
    for await (const entry of Deno.readDir(`${directory}/.sigil`)) {
      entries.push(entry.name);
    }
    assertEquals(entries.sort(), ["semantic.json", "worlds"]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
