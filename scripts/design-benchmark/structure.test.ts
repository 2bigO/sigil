import { describe, expect, test } from "bun:test";
import {
  cycles,
  facetHandles,
  measureStructure,
  readDesignTree,
} from "./structure.ts";
import {
  component,
  SIGILC,
  tempDir,
  TWO_COMPONENTS,
  writeDesign,
} from "./testing.ts";

async function measured(files: Record<string, string>) {
  const root = await writeDesign(await tempDir(), files);
  return measureStructure(await readDesignTree(SIGILC, root));
}

const byName = (
  structure: Awaited<ReturnType<typeof measured>>,
  name: string,
) => structure.componentList.find((c) => c.name === name)!;

describe("Tag-mention coupling and import fan", () => {
  test("A mentioning B's Tag gives one edge, fan-out 1 for A and fan-in 1 for B", async () => {
    const s = await measured(TWO_COMPONENTS);
    expect(s.components).toBe(2);
    expect(s.coupling.map((edge) => [edge.from, edge.to])).toEqual([[
      "A",
      "B",
    ]]);
    expect(s.coupling[0]!.mentions).toBeGreaterThan(0);
    expect(byName(s, "A").fanOut).toBe(1);
    expect(byName(s, "A").fanIn).toBe(0);
    expect(byName(s, "B").fanIn).toBe(1);
    expect(byName(s, "B").fanOut).toBe(0);
    expect(byName(s, "B").mentionsIn).toBe(s.coupling[0]!.mentions);
    expect(s.importCycles).toEqual([]);
    expect(s.mentionCycles).toEqual([]);
  });
});

describe("cycles", () => {
  test("an import cycle and a separate Tag-mention cycle are each reported in their own graph", async () => {
    const s = await measured({
      "a.sigil": component("A", {
        goal: ["Keep each *anchor* fixed to a bolt."],
        interface: ["A provides the anchor."],
      }, [{ path: "b.sigil", provider: "B", names: ["bolt"] }]),
      "b.sigil": component("B", {
        goal: ["Hold every *bolt* beside its anchor."],
        interface: ["B provides the bolt."],
      }, [
        { path: "a.sigil", provider: "A", names: ["anchor"] },
        { path: "c.sigil", provider: "C", names: ["cable"] },
      ]),
      "c.sigil": component("C", {
        goal: ["Run each *cable* in one place."],
        interface: ["C provides the cable."],
      }, [{ path: "a.sigil", provider: "A", names: ["anchor"] }]),
    });
    // C imports A and B imports C, but neither uses the name it imports.
    expect(s.importCycles).toEqual([["A", "B", "C"]]);
    expect(s.mentionCycles).toEqual([["A", "B"]]);
  });

  test("cycles() keeps only sets of two or more", () => {
    expect(cycles(["X", "Y", "Z"], [
      { from: "X", to: "Y" },
      { from: "Y", to: "Z" },
    ])).toEqual([]);
    expect(cycles(["X", "Y", "Z", "W"], [
      { from: "Z", to: "W" },
      { from: "W", to: "Z" },
      { from: "X", to: "Y" },
      { from: "Y", to: "X" },
    ])).toEqual([["W", "Z"], ["X", "Y"]]);
  });
});

describe("roles and Interface Tags", () => {
  test("a component with only goal and interface is listed under no state, logic or cases", async () => {
    const s = await measured(TWO_COMPONENTS);
    expect(s.withoutStateLogicCases).toEqual([
      { name: "A", missing: ["logic", "cases"] },
      { name: "B", missing: ["state", "logic", "cases"] },
    ]);
    expect(byName(s, "B").facetsByRole).toEqual({
      goal: 1,
      state: 0,
      logic: 0,
      constraints: 0,
      cases: 0,
      interface: 1,
      decisions: 0,
    });
    expect(s.facetsByRole.goal).toBe(2);
    expect(s.facetsByRole.state).toBe(1);
  });

  test("an Interface Tag that nothing imports and none of state, logic or constraints backs is listed", async () => {
    const s = await measured(TWO_COMPONENTS);
    const a = byName(s, "A");
    const b = byName(s, "B");
    expect(a.interfaceTags).toEqual(["gadget"]);
    // Nothing imports A's gadget; B imports nothing at all.
    expect(a.unimportedInterfaceTags).toEqual(["gadget"]);
    expect(b.unimportedInterfaceTags).toEqual([]);
    // A's state mentions gadget; B has no state, logic or constraints.
    expect(a.unbackedInterfaceTags).toEqual([]);
    expect(b.unbackedInterfaceTags).toEqual(["widget"]);
    expect(s.unimportedInterfaceTags).toBe(1);
    expect(s.unbackedInterfaceTags).toBe(1);
  });
});

describe("Tag-sharing groups", () => {
  test("Facets sharing a Tag join one group; a Facet with no Tag stays apart", async () => {
    const s = await measured({
      "a.sigil": component("A", {
        goal: ["Keep each *gadget* and each *sprocket* in order."],
        state: [
          "A owns each gadget.",
          "A owns a *spare part* store.",
          "A keeps the spare part store small.",
        ],
        decisions: ["Nothing here mentions a Tag."],
        interface: ["A provides the gadget."],
      }),
    });
    const a = byName(s, "A");
    // goal, the first state Facet and interface share gadget; the two spare
    // part Facets share theirs; the decision mentions nothing.
    expect(a.tagGroups).toEqual([3, 2]);
    expect(a.untaggedFacets).toBe(1);
  });
});

describe("a design that does not parse", () => {
  test("is still measured structurally and names the invalid source", async () => {
    const s = await measured({
      "a.sigil":
        "component A {\n  goal {\n    Keep each *gadget*.\n  }\n  state {\n",
      "b.sigil": TWO_COMPONENTS["b.sigil"],
    });
    expect(s.invalidSources).toEqual(["a.sigil"]);
    expect(s.sources).toBe(2);
    expect(s.components).toBe(2);
    expect(s.facetsByRole.goal).toBe(2);
  });
});

describe("facetHandles (KTD9)", () => {
  test("numbers every Facet from #1 in tree-id order with a component, role and position label", async () => {
    const root = await writeDesign(await tempDir(), TWO_COMPONENTS);
    const handles = facetHandles(await readDesignTree(SIGILC, root));
    expect(handles.length).toBe(5);
    expect(handles.map((h) => h.handle)).toEqual([
      "#1",
      "#2",
      "#3",
      "#4",
      "#5",
    ]);
    const ids = handles.map((h) => h.id);
    expect(ids).toEqual([...ids].sort());
    expect(handles.map((h) => h.label).sort()).toEqual([
      "A goal 1",
      "A interface 1",
      "A state 1",
      "B goal 1",
      "B interface 1",
    ]);
    expect(handles.find((h) => h.label === "B goal 1")!.prose).toContain(
      "widget",
    );
  });
});
