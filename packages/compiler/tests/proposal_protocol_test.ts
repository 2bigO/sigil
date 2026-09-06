import { assertEquals, assertThrows } from "@std/assert";
import {
  decodeProposalEnvelope,
  decodeQuestionEnvelope,
  parseUniqueJson,
} from "../src/semantic/proposal-protocol.ts";

Deno.test("proposal transport rejects duplicate keys and non-envelope text", () => {
  assertThrows(() => parseUniqueJson('{"version":1,"version":1}'));
  assertThrows(() => decodeProposalEnvelope('```json\n{"version":1}\n```'));
  assertThrows(() =>
    decodeProposalEnvelope(JSON.stringify({
      version: 1,
      candidates: [{
        id: "a",
        additions: "",
        retractions: "",
        status: "green",
      }],
    }))
  );
});

Deno.test("proposal and question envelopes retain exact identities", () => {
  const proposal = decodeProposalEnvelope(JSON.stringify({
    version: 1,
    candidates: [{ id: "a", additions: "", retractions: "" }],
  }));
  assertEquals(proposal.candidates[0].id, "a");
  const question = decodeQuestionEnvelope(
    JSON.stringify({ version: 1, factId: "fact:abc", question: "Why?" }),
    "fact:abc",
  );
  assertEquals(question.question, "Why?");
  assertThrows(() =>
    decodeQuestionEnvelope(
      JSON.stringify({ version: 1, factId: "fact:def", question: "Why?" }),
      "fact:abc",
    )
  );
});
