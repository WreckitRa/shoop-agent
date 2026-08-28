import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBlockingClarification } from "../intake/identity-gate";
import {
  sizeBucketsForGarments,
  sizeFamiliesAskedFromQuestions,
} from "../intake/garment-size-fields";
import { normalizeClarificationSizeFields } from "../intake/normalize-size-questions";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";
import type { FashionSearchBrief } from "../router/types";

const outfitBrief: FashionSearchBrief = {
  recipient_person_id: "new",
  request_type: "outfit",
  garments: ["shirt", "trousers", "shoes"],
  occasion_context: "baptism",
  quantity_hint: "one look",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "Dressy head-to-toe for a baptism.",
  department_scope: "mens",
};

describe("baptism_size_families_one_turn", () => {
  it("prompt forces every decomposition size family onto the same turn", () => {
    assert.match(ROUTER_PROMPT_STATIC, /SIZE questions cover EVERY garment family/);
    assert.match(ROUTER_PROMPT_STATIC, /all on the SAME turn/);
    assert.match(ROUTER_PROMPT_STATIC, /re-ask violation/);
  });

  it("outfit brief + new person → one ask with tops, bottoms, shoes size rows", () => {
    assert.deepEqual(sizeBucketsForGarments(outfitBrief.garments).sort(), [
      "bottoms",
      "shoes",
      "tops",
    ]);

    const ask = buildBlockingClarification({
      brief: outfitBrief,
      facts: [],
      targetPersonId: "new",
      personLabel: "you",
    });
    const sizeQs = normalizeClarificationSizeFields(
      ask.questions.filter((q) => q.gap === "size"),
    );
    const asked = sizeFamiliesAskedFromQuestions(sizeQs).sort();
    assert.deepEqual(asked, ["bottoms", "shoes", "tops"]);
  });
});
