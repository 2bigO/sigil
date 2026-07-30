import assert from "node:assert/strict";
import test from "node:test";
import {
  type CompilerDiagnostic,
  componentAt,
  diagnosticDisplayRange,
  parseCompilationEvent,
} from "../../src/compilation.ts";

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

// @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::CompilationSurface logic,constraints
test("projects a direct semantic unit as the diagnostic display range", () => {
  const diagnostic = {
    code: "ARCHITECTURE_BOUNDARY",
    severity: "error",
    message: "Conflicting agent startup contract.",
    filePath: "packages/compiler/src/compiler.sigil",
    range: {
      start: { line: 72, column: 20 },
      end: { line: 72, column: 21 },
    },
    semanticSubjects: [{
      relation: "direct",
      sigilPath: "packages/compiler/src/compiler.sigil",
      componentName: "SigilCompiler",
      ownerKind: "expand",
      ownerName: "SigilCompiler",
      sectionName: "logic",
      conceptIdentifier: "AgentWorkspaceInspection",
      semanticUnit: {
        range: {
          start: { line: 71, column: 7 },
          end: { line: 72, column: 68 },
        },
        fingerprint: "unit",
      },
    }],
  } satisfies CompilerDiagnostic;

  assert.deepEqual(diagnosticDisplayRange(diagnostic), {
    start: { line: 71, column: 7 },
    end: { line: 72, column: 68 },
  });
});

// @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::CompilationSurface logic,constraints
test("falls back to the physical diagnostic range without a direct unit", () => {
  const diagnostic = {
    code: "ARCHITECTURE_BOUNDARY",
    severity: "error",
    message: "Conflicting agent startup contract.",
    filePath: "packages/compiler/src/compiler.sigil",
    range: {
      start: { line: 72, column: 20 },
      end: { line: 72, column: 21 },
    },
    semanticSubjects: [],
  } satisfies CompilerDiagnostic;

  assert.equal(diagnosticDisplayRange(diagnostic), diagnostic.range);
});
