import {
  formatSigilDocument,
  parseSigilDocument,
  SIGIL_VERSION,
} from "@qoherent/sigil-core";
import type { SemanticCompilation } from "./compile.ts";
import { RDF_TYPE, SIGIL_ONTOLOGY } from "./ontology.ts";
import {
  resourceId,
  SemanticInputError,
  serializeSemanticWorld,
} from "./turtle.ts";

export interface SemanticProjection {
  readonly worldFingerprint: string;
  readonly turtle: string;
  readonly sigil: string;
  readonly componentIds: Readonly<Record<string, string>>;
}

export interface ImplementationSlice {
  readonly worldFingerprint: string;
  readonly subject: string;
  readonly workUnit: string;
  readonly role: readonly string[];
  readonly mustProvide: readonly string[];
  readonly mustDelegate: readonly string[];
  readonly mustNot: readonly string[];
  readonly dependencies: readonly string[];
  readonly invariants: readonly string[];
  readonly obligations: readonly {
    readonly id: string;
    readonly relation: string;
    readonly target: string;
    readonly expected: boolean;
  }[];
  readonly relatedContracts: readonly string[];
}

const SECTIONS = [
  "goal",
  "interface",
  "state",
  "logic",
  "constraints",
  "decisions",
  "cases",
] as const;
const propertySection: Readonly<Record<string, typeof SECTIONS[number]>> = {
  provides: "interface",
  requires: "interface",
  owns: "state",
  initialState: "state",
  transitionsTo: "state",
  invokes: "logic",
  uses: "logic",
  reads: "logic",
  writes: "logic",
  delegates: "logic",
  dependsOn: "constraints",
  excludes: "constraints",
  routesThrough: "constraints",
  persistsAt: "state",
  authorityFor: "constraints",
  trusts: "constraints",
};

function requireGreen(compilation: SemanticCompilation): void {
  if (compilation.status !== "green") {
    throw new SemanticInputError(
      "GREEN_WORLD_REQUIRED",
      "A semantic projection requires a green specification.",
    );
  }
}

function labels(compilation: SemanticCompilation): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const fact of compilation.world.facts) {
    if (fact.predicate === SIGIL_ONTOLOGY + "label" && !fact.object.language) {
      result.set(resourceId(fact.subject), fact.object.value);
    }
  }
  return result;
}

function nameFor(id: string, names: ReadonlyMap<string, string>): string {
  return names.get(id) ?? id.split(/[:/#]/).filter(Boolean).at(-1) ?? id;
}

function identifier(id: string, names: ReadonlyMap<string, string>): string {
  const name = nameFor(id, names).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 48);
  return /^[A-Za-z]/.test(name) ? name : `Entity_${name}`;
}

function prose(text: string, indentation: string): string {
  if (
    /[{}\n\r`]/.test(text) ||
    text.split(/\s+/).some((word) => [...word].length > 75)
  ) {
    const ticks = "`".repeat(
      Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
    );
    return `${indentation}The contract text follows.\n${indentation}${ticks}text\n${
      text.split("\n").map((line) => indentation + line).join("\n")
    }\n${indentation}${ticks}`;
  }
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (line && [...line + " " + word].length > 75) {
      lines.push(indentation + line);
      line = "";
    }
    line += (line ? " " : "") + word;
  }
  if (line) lines.push(indentation + line);
  return lines.join("\n");
}

/** Human syntax is a view. The paired Turtle remains the canonical meaning. */
export function projectGreenSemanticWorld(
  compilation: SemanticCompilation,
): SemanticProjection {
  requireGreen(compilation);
  const { world } = compilation;
  const names = labels(compilation);
  const ids = [
    ...new Set(
      world.facts.filter((f) =>
        f.predicate === RDF_TYPE &&
        ["Component", "System"].some((c) =>
          f.object.value === SIGIL_ONTOLOGY + c
        )
      ).map((f) => resourceId(f.subject)),
    ),
  ].sort();
  if (!ids.length) {
    throw new SemanticInputError(
      "COMPONENT_REQUIRED",
      "A Sigil projection needs a Component or System entity.",
    );
  }
  const componentIds: Record<string, string> = {};
  const blocks: string[] = [];
  for (const id of ids) {
    let name = identifier(id, names);
    let suffix = 2;
    while (componentIds[name]) name = `${identifier(id, names)}_${suffix++}`;
    componentIds[name] = id;
    const content = new Map<string, string[]>(
      SECTIONS.map((section) => [section, []]),
    );
    const contracts = new Set(
      world.facts.filter((f) =>
        f.subject.value === id && f.predicate === SIGIL_ONTOLOGY + "hasContract"
      ).map((f) => f.object.value),
    );
    for (const row of compilation.closure.tables.proposition) {
      if (row[1] === id) contracts.add(String(row[0]));
    }
    for (const contract of [...contracts].sort()) {
      const facts = world.facts.filter((f) => f.subject.value === contract);
      const section = facts.find((f) =>
        f.predicate === SIGIL_ONTOLOGY + "section"
      )?.object.value ?? "constraints";
      const targetSection =
        SECTIONS.includes(section as typeof SECTIONS[number])
          ? section
          : "constraints";
      const descriptions = facts.filter((f) =>
        f.predicate === SIGIL_ONTOLOGY + "description"
      ).map((f) => f.object.value);
      const propositions = compilation.closure.tables.proposition.filter((
        row,
      ) => row[0] === contract).map((row) =>
        `${nameFor(String(row[1]), names)} must ${
          row[4] === "false" ? "not " : ""
        }${row[2]} ${nameFor(String(row[3]), names)}.`
      );
      const body = [...descriptions, ...propositions].join("\n\n");
      if (body) content.get(targetSection)!.push(body);
    }
    for (const fact of world.facts.filter((f) => f.subject.value === id)) {
      if (
        fact.predicate === RDF_TYPE ||
        ["label", "hasContract"].some((p) =>
          fact.predicate === SIGIL_ONTOLOGY + p
        )
      ) continue;
      const property = fact.predicate.slice(SIGIL_ONTOLOGY.length);
      if (property === "description") {
        content.get("goal")!.push(fact.object.value);
        continue;
      }
      content.get(propertySection[property] ?? "decisions")!.push(
        `${name} ${property} ${
          fact.object.kind === "literal"
            ? JSON.stringify(fact.object.value)
            : nameFor(resourceId(fact.object), names)
        }.`,
      );
    }
    if (!content.get("goal")!.length) {
      content.get("goal")!.push(
        `Represent the ${name} contract in the canonical semantic world.`,
      );
    }
    if (!content.get("interface")!.length) {
      content.get("interface")!.push(
        "No public capability is asserted for this component.",
      );
    }
    const sections = SECTIONS.filter((section) => content.get(section)!.length)
      .map((section) => {
        const units = content.get(section)!;
        if (section === "goal") {
          return `  goal {\n${
            units.map((unit) => prose(unit, "    ")).join("\n\n")
          }\n  }`;
        }
        return `  ${section} {\n${
          units.map((unit, index) =>
            `    ${section[0].toUpperCase() + section.slice(1)}Contract${
              index + 1
            } {\n${prose(unit, "      ")}\n    }`
          ).join("\n\n")
        }\n  }`;
      });
    // The existing language reserves non-public sections for expansions.
    const declaration = sections.filter((s) =>
      /^ {2}(goal|interface) \{/.test(s)
    );
    const expansion = sections.filter((s) => !/^ {2}(goal|interface) \{/.test(s));
    blocks.push(`component ${name} {\n${declaration.join("\n\n")}\n}`);
    if (expansion.length) {
      blocks.push(`expand ${name} {\n${expansion.join("\n\n")}\n}`);
    }
  }
  const source = blocks.join("\n\n") + "\n";
  const parsed = parseSigilDocument("semantic-projection.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  const errors = parsed.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) {
    throw new Error(
      `Invalid semantic projection: ${errors.map((d) => d.message).join("; ")}`,
    );
  }
  return {
    worldFingerprint: world.fingerprint,
    turtle: serializeSemanticWorld(world),
    sigil: formatSigilDocument(parsed.document, source).formattedSource ??
      source,
    componentIds,
  };
}

export function implementationSlice(
  compilation: SemanticCompilation,
  subject: string,
): ImplementationSlice {
  requireGreen(compilation);
  const names = labels(compilation);
  const facts = compilation.world.facts.filter((f) =>
    resourceId(f.subject) === subject
  );
  if (
    !facts.some((f) =>
      f.predicate === RDF_TYPE &&
      ["Component", "System"].some((c) => f.object.value === SIGIL_ONTOLOGY + c)
    )
  ) {
    throw new SemanticInputError(
      "UNKNOWN_COMPONENT",
      `No component matches ${subject}.`,
    );
  }
  const targets = (predicate: string) =>
    [
      ...new Set(
        compilation.closure.tables.known.filter((row) =>
          row[0] === subject && row[1] === predicate
        ).map((row) => nameFor(String(row[2]), names)),
      ),
    ].sort();
  const obligations = compilation.closure.tables.coverage.filter((row) =>
    row[1] === subject
  ).map((row) => ({
    id: String(row[0]),
    relation: String(row[2]),
    target: String(row[3]),
    expected: row[4] === "true",
  }));
  const contracts = new Set(
    facts.filter((f) => f.predicate === SIGIL_ONTOLOGY + "hasContract").map((
      f,
    ) => f.object.value),
  );
  for (const row of compilation.closure.tables.proposition) {
    if (row[1] === subject) contracts.add(String(row[0]));
  }
  return {
    worldFingerprint: compilation.world.fingerprint,
    subject,
    workUnit: nameFor(subject, names),
    role: facts.filter((f) => f.predicate === SIGIL_ONTOLOGY + "description")
      .map((f) => f.object.value),
    mustProvide: targets("provides"),
    mustDelegate: targets("delegates"),
    mustNot: targets("excludes"),
    dependencies: targets("dependsOn"),
    invariants: [
      ...targets("routesThrough").map((target) =>
        `Operations route through ${target}.`
      ),
      ...compilation.closure.tables.proposition.filter((row) =>
        row[1] === subject
      ).map((row) =>
        `${row[4] === "false" ? "Must not" : "Must"} ${row[2]} ${
          nameFor(String(row[3]), names)
        }.`
      ),
    ],
    obligations,
    relatedContracts: [...contracts].sort(),
  };
}

export function renderImplementationSlice(slice: ImplementationSlice): string {
  const list = (title: string, values: readonly string[]) =>
    values.length
      ? `${title}\n${values.map((v) => `- ${v}`).join("\n")}\n`
      : "";
  return `WORK UNIT\n${slice.workUnit}\n\n` + [
    list("ROLE", slice.role),
    list("MUST PROVIDE", slice.mustProvide),
    list("MUST DELEGATE", slice.mustDelegate),
    list("MUST NOT", slice.mustNot),
    list("DEPENDENCIES", slice.dependencies),
    list("INVARIANTS", slice.invariants),
    list(
      "OBLIGATIONS",
      slice.obligations.map((o) =>
        `${o.id}: ${
          o.expected ? "establish" : "exclude"
        } ${o.relation} ${o.target}`
      ),
    ),
    list("RELATED CONTRACTS", slice.relatedContracts),
  ].filter(Boolean).join("\n");
}
