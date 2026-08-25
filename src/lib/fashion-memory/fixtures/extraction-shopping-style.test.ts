import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFashionExtractionPrompt } from "../extraction/prompt";
import { recordFashionOpsResultSchema } from "../extraction/tool-schema";

describe("extraction_shopping_style", () => {
  it("prompt records shopping_style and depth_default", () => {
    const prompt = buildFashionExtractionPrompt();
    assert.match(prompt, /SHOPPING STYLE/);
    assert.match(prompt, /shopping_style/);
    assert.match(prompt, /depth_default/);
  });

  it("two Just show me taps → shopping_style quick inferred; always 5 → depth_default stated", () => {
    const parsed = recordFashionOpsResultSchema.parse({
      ops: [
        {
          op: "signal_add",
          person_ref: "self",
          source: "inferred",
          confidence: 0.6,
          evidence_quote: "Just show me",
          signal_type: "shopping_style",
          signal_value: "quick",
        },
        {
          op: "fact_add",
          person_ref: "self",
          source: "stated",
          confidence: 0.9,
          evidence_quote: "always show me 5",
          fact_type: "depth_default",
          value: { count: 5, unit: "looks" },
        },
      ],
      ambiguous_subjects: [],
    });
    assert.equal(parsed.ops.length, 2);
    assert.equal(parsed.ops[0]?.op, "signal_add");
    assert.equal(parsed.ops[1]?.op, "fact_add");
    if (parsed.ops[1]?.op === "fact_add") {
      assert.equal(parsed.ops[1].fact_type, "depth_default");
    }
  });
});
