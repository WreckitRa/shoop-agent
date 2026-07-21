import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatResumeLabel } from "./resume-hint";

describe("formatResumeLabel", () => {
  it("turns a typo-heavy golf request into clean, warm copy", () => {
    assert.equal(
      formatResumeLabel(
        "am lookign for a nice golf outfit to make me look lik....",
        { allowGeneric: false },
      ),
      "that sharp golf look",
    );
  });

  it("paraphrases common high-intent shopping occasions", () => {
    assert.equal(
      formatResumeLabel("Help me find something for a beach wedding"),
      "the right wedding look",
    );
    assert.equal(
      formatResumeLabel("Rebuild my work wardrobe"),
      "that work wardrobe refresh",
    );
  });

  it("never echoes an unstructured raw message as fallback", () => {
    assert.equal(
      formatResumeLabel("can u help with ths thing...", {
        allowGeneric: false,
      }),
      null,
    );
  });
});
