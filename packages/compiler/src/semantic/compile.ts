import {
  type ClosureResult,
  computeClosure,
  type SemanticEngineOptions,
} from "./engine.ts";
import type { SemanticWorld } from "./turtle.ts";

export interface SemanticDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly subject: string;
  readonly message: string;
  readonly witness: string;
  readonly derivation: readonly (readonly (string | number | boolean)[])[];
}

export interface SemanticCompilation {
  readonly world: SemanticWorld;
  readonly status: "green" | "yellow" | "red";
  readonly diagnostics: readonly SemanticDiagnostic[];
  readonly closure: ClosureResult;
}

export async function compileSemanticWorld(
  world: SemanticWorld,
  options: SemanticEngineOptions = {},
): Promise<SemanticCompilation> {
  const closure = await computeClosure(world, options);
  const diagnostics: SemanticDiagnostic[] = [];
  const because = closure.tables.because;
  function derivation(witness: string) {
    const visited = new Set<string>();
    const rows: (readonly (string | number | boolean)[])[] = [];
    function visit(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      for (const row of because.filter((row) => row[0] === id)) {
        rows.push(row);
        visit(String(row[2]));
        visit(String(row[3]));
      }
    }
    visit(witness);
    return rows;
  }
  for (const row of closure.tables.violation) {
    const [code, subject, target] = row.map(String);
    const witness = `violation|${code}|${subject}|${target}`;
    diagnostics.push({
      severity: "error",
      code,
      subject,
      message: `${code}: ${subject} conflicts with ${target}.`,
      witness,
      derivation: derivation(witness),
    });
  }
  for (const row of closure.tables.unresolved) {
    const [witness, subject, relation, target] = row.map(String);
    diagnostics.push({
      severity: "warning",
      code: "unresolved-obligation",
      subject,
      message:
        `Required ${relation} remains unresolved: ${subject} → ${target}.`,
      witness,
      derivation: derivation(witness),
    });
  }
  return {
    world,
    closure,
    diagnostics,
    status: diagnostics.some((d) => d.severity === "error")
      ? "red"
      : diagnostics.length
      ? "yellow"
      : "green",
  };
}
