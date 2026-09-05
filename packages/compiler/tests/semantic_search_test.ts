import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  checkpointWorldBeam,
  patchBetweenWorlds,
  resumeWorldBeam,
  selectWorldBeamAnswer,
} from "../src/semantic/beam.ts";
import {
  applyTurtlePatch,
  searchSemanticWorlds,
} from "../src/semantic/search.ts";
import {
  parseSemanticWorld,
  SemanticInputError,
} from "../src/semantic/turtle.ts";

const prefix =
  `@prefix s: <https://sigil.dev/ontology/1#> . @prefix : <urn:test:> .\n`;
const world = (turtle: string) =>
  parseSemanticWorld([{ sourceId: "test", turtle: prefix + turtle }]);

Deno.test("candidate search prunes contradictions before evaluating quality", async () => {
  const base = await world(`:A s:requires :Parse; s:excludes :Disk .`);
  const result = await searchSemanticWorlds(base, [
    {
      id: "valid",
      patch: {
        baseFingerprint: base.fingerprint,
        additions: prefix + `:A s:provides :Parse .`,
      },
    },
    {
      id: "invalid",
      patch: {
        baseFingerprint: base.fingerprint,
        additions: prefix + `:A s:provides :Parse; s:uses :Disk .`,
      },
    },
  ]);
  assertEquals(result.status, "selected");
  assertEquals(result.selected?.id, "valid");
  assertEquals(result.rejected.length, 1);
});

Deno.test("inventing fulfilled requirements cannot beat established intent", async () => {
  const base = await world(`:A s:requires :Parse .`);
  const result = await searchSemanticWorlds(base, [
    {
      id: "fulfills-intent",
      patch: {
        baseFingerprint: base.fingerprint,
        additions: prefix + `:A s:provides :Parse .`,
      },
    },
    {
      id: "invents-credit",
      patch: {
        baseFingerprint: base.fingerprint,
        additions: prefix + `:A s:requires :X, :Y, :Z; s:provides :X, :Y, :Z .`,
      },
    },
  ]);
  assertEquals(result.selected?.id, "fulfills-intent");
});

Deno.test("material architecture alternatives remain ambiguous with an exact proposition", async () => {
  const base = await world(
    `:A s:requires :Parse . :Local s:provides :Parse . :Remote s:provides :Parse .`,
  );
  const result = await searchSemanticWorlds(base, [
    {
      id: "local",
      patch: {
        baseFingerprint: base.fingerprint,
        additions: prefix + `:A s:delegates :Local .`,
      },
    },
    {
      id: "remote",
      patch: {
        baseFingerprint: base.fingerprint,
        additions: prefix + `:A s:delegates :Remote .`,
      },
    },
  ]);
  assertEquals(result.status, "ambiguous");
  assertEquals(result.proposition?.informationGainBits, 1);
  assertEquals(
    result.proposition?.fact.predicate,
    "https://sigil.dev/ontology/1#delegates",
  );
  const selected = selectWorldBeamAnswer(result, true);
  assertEquals(selected.selected?.id, result.proposition?.yes[0]);
  const patch = await patchBetweenWorlds(
    base,
    selected.selected!.compilation.world,
  );
  const applied = await applyTurtlePatch(base, patch, "intent-answer");
  assertEquals(
    applied.fingerprint,
    selected.selected!.compilation.world.fingerprint,
  );
  const checkpoint = await checkpointWorldBeam(base, result, [], [{
    factId: result.proposition!.fact.id,
    value: true,
  }]);
  const resumed = await resumeWorldBeam(JSON.parse(JSON.stringify(checkpoint)));
  assertEquals(resumed.selected?.id, selected.selected?.id);
});

Deno.test("patches reject stale bases and unauthorized removal of established facts", async () => {
  const base = await world(`:A s:excludes :Disk .`);
  await assertRejects(
    () =>
      applyTurtlePatch(base, { baseFingerprint: "stale", additions: "" }, "x"),
    SemanticInputError,
    "fingerprint",
  );
  const patch = {
    baseFingerprint: base.fingerprint,
    additions: "",
    retractions: prefix + `:A s:excludes :Disk .`,
  };
  await assertRejects(
    () => applyTurtlePatch(base, patch, "x"),
    SemanticInputError,
    "established intent",
  );
  assertEquals(
    (await applyTurtlePatch(base, patch, "x", base.facts.map((f) => f.id)))
      .facts.length,
    0,
  );
});

Deno.test("equivalent wording and anonymous hypotheses do not force clarification", async () => {
  const base = await world(`:A a s:Component .`);
  const result = await searchSemanticWorlds(base, [
    {
      id: "a",
      patch: {
        baseFingerprint: base.fingerprint,
        additions: prefix +
          `:A s:owns [ a s:State ]; s:label "First wording" .`,
      },
    },
    {
      id: "b",
      patch: {
        baseFingerprint: base.fingerprint,
        additions: prefix +
          `:A s:owns [ a s:State ]; s:label "Second wording" .`,
      },
    },
  ]);
  assertEquals(result.status, "selected");
  const checkpoint = await checkpointWorldBeam(base, result);
  assertEquals(
    (await resumeWorldBeam(checkpoint)).selected?.compilation.world.fingerprint,
    result.selected?.compilation.world.fingerprint,
  );
});

Deno.test("malformed candidates are pruned, engine failure remains operational", async () => {
  const base = await world(`:A a s:Component .`);
  const candidate = {
    id: "a",
    patch: {
      baseFingerprint: base.fingerprint,
      additions: prefix + `:A s:qualityScore 1 .`,
    },
  };
  assertEquals(
    (await searchSemanticWorlds(base, [candidate])).status,
    "rejected",
  );
  await assertRejects(
    () =>
      searchSemanticWorlds(base, [candidate], {
        binaryPath: "/no-such-egglog",
      }),
    Error,
    "Cannot start",
  );
  await assertRejects(
    () => searchSemanticWorlds(base, [candidate, candidate]),
    SemanticInputError,
    "unique",
  );
  const checkpoint = await checkpointWorldBeam(
    base,
    await searchSemanticWorlds(base, [{
      ...candidate,
      patch: { ...candidate.patch, additions: "" },
    }]),
  );
  await assertRejects(
    () =>
      resumeWorldBeam({
        ...checkpoint,
        base: { ...checkpoint.base, fingerprint: "corrupt" },
      }),
    SemanticInputError,
  );
  assert(checkpoint.candidates.length === 1);
});
