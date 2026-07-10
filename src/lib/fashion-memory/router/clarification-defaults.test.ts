import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLARIFICATION_OTHER_OPTION,
  defaultQuickOptionsForGap,
  ensureClarificationQuickOptions,
  ensureQuestionsHaveQuickOptions,
} from "./clarification-defaults";

describe("clarification quick_options defaults", () => {
  it("fills shoe size chips when LLM omits options", () => {
    const filled = ensureClarificationQuickOptions({
      text: "What's his shoe size?",
      gap: "size",
      garment_type: "shoes",
    });
    assert.deepEqual(filled.quick_options, [
      "7",
      "8",
      "9",
      "10",
      "11",
      CLARIFICATION_OTHER_OPTION,
    ]);
  });

  it("appends Other when LLM provides chips without it", () => {
    const filled = ensureClarificationQuickOptions({
      text: "Which section?",
      gap: "department",
      quick_options: ["Men's", "Women's", "Mix it"],
    });
    assert.ok(filled.quick_options?.includes("Men's"));
    assert.equal(filled.quick_options?.at(-1), CLARIFICATION_OTHER_OPTION);
  });

  it("defaults recipient and garment gaps", () => {
    assert.ok(defaultQuickOptionsForGap("recipient").includes("For me"));
    assert.ok(defaultQuickOptionsForGap("garment").includes("One piece"));
  });

  it("ensures a whole questions array", () => {
    const out = ensureQuestionsHaveQuickOptions([
      { text: "Shoe size?", gap: "size", garment_type: "shoes" },
      {
        text: "On roster?",
        gap: "recipient",
        quick_options: ["He's in my contacts", "New person"],
      },
    ]);
    assert.equal(out[0]?.quick_options?.includes("9"), true);
    assert.equal(out[1]?.quick_options?.at(-1), CLARIFICATION_OTHER_OPTION);
  });
});
