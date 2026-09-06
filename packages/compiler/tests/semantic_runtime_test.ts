import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  computeClosure,
  decodeClosureResponse,
} from "../src/semantic/engine.ts";
import { parseSemanticWorld } from "../src/semantic/turtle.ts";
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
  ignore: Deno.build.os === "windows" &&
    !Deno.env.get("SIGIL_UNCOOPERATIVE_ENGINE"),
  async fn() {
    const directory = await Deno.makeTempDir();
    try {
      const configured = Deno.env.get("SIGIL_UNCOOPERATIVE_ENGINE");
      const executable = configured ?? `${directory}/engine`;
      if (!configured) {
        // No descendants: this shell models the bridge ignoring graceful termination.
        await Deno.writeTextFile(
          executable,
          "#!/bin/sh\ntrap '' TERM\nwhile :; do :; done\n",
          { mode: 0o700 },
        );
      }
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
      if (!configured) {
        await Deno.writeTextFile(
          executable,
          '#!/bin/sh\nprintf \'{"version":1,"kernelVersion":"1","kernelFingerprint":"0000000000000000000000000000000000000000000000000000000000000000","tables":{}}\'\n',
        );
        await assertRejects(
          () => computeClosure(world, { binaryPath: executable }),
          Error,
          "tables",
        );
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test("canonical world revisions include metadata and detect corrupt immutable payloads", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const world = await parseSemanticWorld([]);
    const receipt = {
      version: 1 as const,
      worldFingerprint: world.fingerprint,
      sourceFingerprint: world.fingerprint,
      componentBindings: {},
    };
    const first = await writeSemanticState(directory, { world, receipt });
    const path = `${directory}/.sigil/world/${first.revision}/assertions.egg`;
    const original = await Deno.readTextFile(path);
    const repeated = await writeSemanticState(
      directory,
      { world, receipt },
      first.revision,
    );
    assertEquals(repeated.revision, first.revision);
    await assertRejects(
      () => writeSemanticState(directory, { world, receipt }),
      Error,
      "changed",
    );
    const changed = await writeSemanticState(directory, {
      world,
      receipt: { ...receipt, componentBindings: { a: "urn:changed" } },
    }, first.revision);
    assertEquals(changed.world.fingerprint, first.world.fingerprint);
    assertEquals(changed.revision === first.revision, false);
    await assertRejects(
      () => writeSemanticState(directory, { world, receipt }, first.revision),
      Error,
      "changed",
    );
    const restored = await writeSemanticState(
      directory,
      { world, receipt },
      changed.revision,
    );
    assertEquals(restored.revision, first.revision);
    await Deno.writeTextFile(path, original + "; altered bytes\n");
    await assertRejects(() => readSemanticState(directory), Error, "hash");
    await Deno.writeTextFile(path, original);
    assertEquals(
      (await readSemanticState(directory))?.revision,
      first.revision,
    );
    const entries = [];
    for await (const entry of Deno.readDir(`${directory}/.sigil/cache/tmp`)) {
      entries.push(entry.name);
    }
    assertEquals(entries, []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
