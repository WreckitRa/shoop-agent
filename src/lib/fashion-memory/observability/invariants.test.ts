import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkBriefInvariants,
  coerceBriefRequestTypeForOutfitLanguage,
} from "./invariants";
import type { FashionSearchBrief } from "../router/types";

const baseBrief = (request_type: FashionSearchBrief["request_type"]): FashionSearchBrief => ({
  recipient_person_id: "self",
  request_type,
  garments: ["athleisure"],
  occasion_context: "general",
  quantity_hint: "a few",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "wfh",
});

describe("coerceBriefRequestTypeForOutfitLanguage", () => {
  it("upgrades multi_item to outfit when the user said outfit", () => {
    const brief = baseBrief("multi_item");
    const out = coerceBriefRequestTypeForOutfitLanguage({
      messages: [
        {
          role: "user",
          content: "looking for an outfit to wear at home, working as a wfh developer",
        },
      ],
      brief,
    });
    assert.equal(out.request_type, "outfit");
    assert.notEqual(out, brief);
  });

  it("upgrades single_item to outfit on look language", () => {
    const out = coerceBriefRequestTypeForOutfitLanguage({
      messages: [{ role: "user", content: "need a look for Friday drinks" }],
      brief: baseBrief("single_item"),
    });
    assert.equal(out.request_type, "outfit");
  });

  it("leaves capsule alone", () => {
    const brief = baseBrief("capsule");
    const out = coerceBriefRequestTypeForOutfitLanguage({
      messages: [{ role: "user", content: "a few outfits to rotate" }],
      brief,
    });
    assert.equal(out.request_type, "capsule");
    assert.equal(out, brief);
  });

  it("leaves multi_item alone when no outfit language", () => {
    const brief = baseBrief("multi_item");
    const out = coerceBriefRequestTypeForOutfitLanguage({
      messages: [{ role: "user", content: "shirts, pants, and shoes separately" }],
      brief,
    });
    assert.equal(out.request_type, "multi_item");
    assert.equal(out, brief);
  });
});

describe("checkBriefInvariants outfit language", () => {
  it("trips on multi_item + outfit wording", () => {
    const tripped = checkBriefInvariants({
      messages: [{ role: "user", content: "full outfit for the office" }],
      brief: baseBrief("multi_item"),
    });
    assert.ok(tripped.includes("outfit_language_multi_item_brief"));
  });
});
