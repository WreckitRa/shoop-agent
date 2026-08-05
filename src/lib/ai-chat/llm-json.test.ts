import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLlmJsonObject } from "./llm-json";
import { onboardingExtractionSchema } from "@/lib/onboarding/memory-extract/types";
import { prefillFromExtraction } from "@/lib/onboarding/prefill";

describe("parseLlmJsonObject", () => {
  it("parses valid JSON", () => {
    const out = parseLlmJsonObject('{"observations":[],"isShoppingRelevant":true}');
    assert.ok(out);
    assert.equal(out.salvaged, false);
  });

  it("salvages JSON truncated inside profileUpdates", () => {
    const truncated = `{
  "isShoppingRelevant": true,
  "observations": [
    {
      "signalType": "profile",
      "rawText": "25 in Lebanon",
      "normalizedText": "User is 25 in Lebanon.",
      "scope": "global",
      "attributes": { "ageRange": "25-34", "country": "Lebanon" },
      "confidence": 0.9,
      "importance": 0.9,
      "stability": "stable",
      "source": "explicit",
      "shouldPromoteToMemory": true,
      "isHardRule": false
    },
    {
      "signalType": "size",
      "rawText": "tops M",
      "normalizedText": "Tops M.",
      "scope": "category",
      "attributes": { "topSize": "M" },
      "confidence": 0.9,
      "importance": 0.9,
      "stability": "stable",
      "source": "explicit",
      "shouldPromoteToMemory": true,
      "isHardRule": false
    }
  ],
  "profileUpdates": {
    "brandSummary": "likes nike",
    "dislikesSummary`;
    const out = parseLlmJsonObject(truncated);
    assert.ok(out);
    assert.equal(out.salvaged, true);
    const parsed = onboardingExtractionSchema.safeParse(out.value);
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.observations.length, 2);
      const prefill = prefillFromExtraction(parsed.data);
      assert.equal(prefill.ageRange, "25-34");
      assert.equal(prefill.shippingCountry, "Lebanon");
      assert.equal(prefill.topSize, "M");
    }
  });
});
