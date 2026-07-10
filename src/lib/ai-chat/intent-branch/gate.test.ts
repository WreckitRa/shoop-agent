import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { intentShiftClassificationSchema } from "./classify-shift";

describe("intentShiftClassificationSchema", () => {
  it("parses valid classifier output", () => {
    const out = intentShiftClassificationSchema.safeParse({
      isNewIntent: true,
      confidence: 0.9,
      suggestedTitle: "Gift for mom",
    });
    assert.equal(out.success, true);
  });

  it("accepts empty suggestedTitle when not splitting", () => {
    const out = intentShiftClassificationSchema.safeParse({
      isNewIntent: false,
      confidence: 0.95,
    });
    assert.equal(out.success, true);
    if (out.success) {
      assert.equal(out.data.suggestedTitle, "");
      assert.equal(out.data.isNewIntent, false);
    }
  });
});
