import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expertiseCorpusStats, formatExpertiseCorpus } from "../judgment/expertise-corpus";

describe("expertise corpus", () => {
  it("returns fashion precedents for blazer queries", () => {
    const text = formatExpertiseCorpus("black men's blazer tailored", "blazer");
    assert.match(text, /Precedents you've seen:/);
    assert.match(text, /office|nightlife|navy/i);
  });

  it("has at least 30 seeded principles", () => {
    const stats = expertiseCorpusStats();
    assert.ok(stats.principles >= 30);
  });
});
