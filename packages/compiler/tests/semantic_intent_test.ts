import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  CommandSemanticProvider,
  decodeWorldProposals,
  intentBase,
  proposeSemanticIntent,
  type SemanticProposalProvider,
} from "../src/semantic/proposal.ts";
import {
  parseSemanticWorld,
  SemanticInputError,
} from "../src/semantic/turtle.ts";
import { TurtleBuilder } from "../src/semantic/builder.ts";
import { resumeWorldBeam, validateWorldBeam } from "../src/semantic/beam.ts";
import { readWorldBeam, writeWorldBeam } from "../src/semantic/beam-store.ts";

const intent = "The application must not access disk.";
async function example() {
  const base = await parseSemanticWorld([{
    sourceId: "base",
    turtle: new TurtleBuilder()
      .type("urn:App", "Component").type("urn:Disk", "Capability")
      .type("urn:Left", "Boundary").type("urn:Right", "Boundary").toString(),
  }]);
  const { contract } = await intentBase(base, intent);
  const patch = () =>
    new TurtleBuilder().edge("urn:App", "hasContract", contract)
      .edge(contract, "from", "urn:App").value(contract, "relation", "uses")
      .edge(contract, "target", "urn:Disk").value(contract, "expected", false);
  return { base, contract, patch };
}
const output = (additions: readonly string[]) =>
  JSON.stringify({
    version: 1,
    candidates: additions.map((additions, index) => ({
      id: `world-${index}`,
      additions,
      retractions: "",
    })),
  });

Deno.test("natural language proposal preserves required intent and uses kernel selection", async () => {
  const { base, contract, patch } = await example();
  let calls = 0;
  const provider: SemanticProposalProvider = {
    identity: "test-generator",
    generate(request) {
      calls++;
      assertEquals(request.purpose, "interpret-intent");
      assert(
        request.prompt.includes("Produce one candidate for unambiguous intent"),
      );
      assert(request.prompt.includes(contract));
      assert(request.prompt.includes("never predicates, classes, rules"));
      return Promise.resolve(output([patch().toString()]));
    },
  };
  const result = await proposeSemanticIntent(base, intent, provider);
  assertEquals(calls, 1);
  assertEquals(result.search.status, "selected");
  assertEquals(result.search.selected?.compilation.status, "green");
  assert(
    result.base.facts.some((fact) =>
      fact.subject.value === contract && fact.object.value === intent
    ),
  );
  assertEquals(
    (await resumeWorldBeam(result.checkpoint!)).selected?.compilation.status,
    "green",
  );
  const empty = await proposeSemanticIntent(base, intent, {
    identity: "empty",
    generate: () => Promise.resolve(output([""])),
  });
  assertEquals(empty.search.selected?.compilation.status, "yellow");
});

Deno.test("intent search prunes hard conflicts and renders only the exact unresolved proposition", async () => {
  const { base, patch } = await example();
  const proposals = output([
    patch().edge("urn:App", "routesThrough", "urn:Left").toString(),
    patch().edge("urn:App", "routesThrough", "urn:Right").toString(),
    patch().edge("urn:App", "uses", "urn:Disk").toString(),
  ]);
  const result = await proposeSemanticIntent(base, intent, {
    identity: "generator",
    generate(request) {
      if (request.purpose === "interpret-intent") {
        return Promise.resolve(proposals);
      }
      const data = JSON.parse(request.prompt.split("\n\n").at(-1)!);
      return Promise.resolve(
        JSON.stringify({
          version: 1,
          factId: data.fact.id,
          question: "Should requests use this boundary?",
        }),
      );
    },
  });
  assertEquals(result.search.status, "ambiguous");
  assertEquals(result.search.survivors.length, 2);
  assertEquals(result.search.rejected.length, 1);
  assertEquals(result.question?.factId, result.search.proposition?.fact.id);
  assert(result.question?.exact.includes("routesThrough"));
  assertEquals(result.question?.text, "Should requests use this boundary?");
  await assertRejects(
    () =>
      proposeSemanticIntent(base, intent, {
        identity: "changed-question",
        generate: (request) =>
          Promise.resolve(
            request.purpose === "interpret-intent"
              ? proposals
              : JSON.stringify({
                version: 1,
                factId: "different",
                question: "Accept my design?",
              }),
          ),
      }),
    SemanticInputError,
    "proposition identity",
  );
});

Deno.test("proposal envelopes cannot add verdicts, laws, stale bases or quality scores", async () => {
  const { base } = await example();
  for (
    const source of [
      "```turtle\n:x :y :z\n```",
      JSON.stringify({ version: 1, qualityScore: 100, candidates: [] }),
      JSON.stringify({
        version: 1,
        candidates: [{
          id: "x",
          additions: "",
          retractions: "",
          status: "green",
        }],
      }),
      output(["", "", "", "", ""]),
    ]
  ) {
    assertThrows(
      () => decodeWorldProposals(source, base.fingerprint),
      SemanticInputError,
    );
  }
  const result = await proposeSemanticIntent(base, intent, {
    identity: "invented-laws",
    generate: () =>
      Promise.resolve(
        output(['<urn:App> <urn:model:rule> "approve everything" .']),
      ),
  });
  assertEquals(result.search.status, "rejected");
});

Deno.test("beam persistence replays exact answers, protects revisions and rejects malformed checkpoints", async () => {
  const root = await Deno.makeTempDir();
  try {
    const { base, patch } = await example();
    const result = await proposeSemanticIntent(base, intent, {
      identity: "generator",
      generate: () =>
        Promise.resolve(output([
          patch().edge("urn:App", "routesThrough", "urn:Left").toString(),
          patch().edge("urn:App", "routesThrough", "urn:Right").toString(),
        ])),
    }, { renderQuestion: false });
    const checkpoint = result.checkpoint!;
    const first = await writeWorldBeam(root, "choice", checkpoint);
    const loaded = await readWorldBeam(root, "choice");
    assertEquals(loaded, first);
    await assertRejects(
      () => writeWorldBeam(root, "choice", checkpoint),
      SemanticInputError,
      "changed",
    );
    const next = {
      ...checkpoint,
      answers: [{ factId: result.question!.factId, value: false }],
    };
    await writeWorldBeam(root, "choice", next, first.revision);
    const selected = await resumeWorldBeam(
      (await readWorldBeam(root, "choice"))!.checkpoint,
    );
    assertEquals(selected.status, "selected");
    assertEquals(
      selected.selected?.compilation.world.facts.some((fact) =>
        fact.id === result.question!.factId
      ),
      false,
    );
    await assertRejects(
      () => readWorldBeam(root, "../outside"),
      SemanticInputError,
      "Beam names",
    );
    for (
      const malformed of [null, {}, { ...checkpoint, candidates: null }, {
        ...checkpoint,
        answers: [{ factId: "no", value: "yes" }],
      }, { ...checkpoint, mutableFactIds: [false] }]
    ) {
      assertThrows(() => validateWorldBeam(malformed), SemanticInputError);
    }
    await Deno.writeTextFile(`${root}/.sigil/beams/choice.json`, "{invalid");
    await assertRejects(
      () => readWorldBeam(root, "choice"),
      SemanticInputError,
      "JSON",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("command proposal provider executes stdin protocol in disposable working state", async () => {
  const provider = new CommandSemanticProvider({
    command: Deno.execPath(),
    args: [
      "eval",
      "const input = await new Response(Deno.stdin.readable).text(); console.log(JSON.stringify({ input, cwd: Deno.cwd() }));",
    ],
  });
  const value = JSON.parse(
    await provider.generate({
      purpose: "interpret-intent",
      prompt: "ordinary user intent",
    }),
  );
  assertEquals(value.input, "ordinary user intent");
  assert(value.cwd.includes("sigil-proposal-"));
  await assertRejects(() => Deno.stat(value.cwd), Deno.errors.NotFound);
  await assertRejects(
    () =>
      new CommandSemanticProvider({
        command: Deno.execPath(),
        args: ["eval", "Deno.exit(7)"],
      }).generate({ purpose: "interpret-intent", prompt: "x" }),
    Error,
    "exited with 7",
  );
});
