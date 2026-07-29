import assert from "node:assert/strict";
import test from "node:test";
import { componentAt, parseCompilationEvent } from "../../src/compilation.ts";

// @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::CompilationSurface logic,constraints,cases
test("validates compiler protocol envelopes", () => {
  const event = parseCompilationEvent(JSON.stringify({
    protocolVersion: 1,
    runId: "run",
    sequence: 1,
    type: "started",
    payload: {},
  }));
  assert.equal(event.sequence, 1);
  assert.throws(() =>
    parseCompilationEvent(JSON.stringify({
      protocolVersion: 2,
      runId: "run",
      sequence: 1,
      type: "started",
      payload: {},
    }))
  );
});

// @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::CompilationSurface logic,cases
test("resolves the nearest component declaration at the cursor", () => {
  const source = `component One {
  goal {
    First.
  }
}

component Two {
  goal {
    Second.
  }
}`;
  assert.equal(componentAt(source, 2), "One");
  assert.equal(componentAt(source, 8), "Two");
});
