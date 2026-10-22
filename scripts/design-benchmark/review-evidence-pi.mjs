import { readEvidence } from "./review-evidence.mjs";

export default function (pi) {
  pi.registerTool({
    name: "review_evidence",
    label: "Read review evidence",
    description:
      "Hash an exact staged file and read UTF-8 bytes. Supply sha256 to verify identity before reading; start/end are zero-based byte offsets, end exclusive, and require sha256. No writes or commands.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        sha256: { type: "string" },
        start: { type: "integer", minimum: 0 },
        end: { type: "integer", minimum: 0 },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const result = await readEvidence(
        params.path,
        params.sha256,
        params.start,
        params.end,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
