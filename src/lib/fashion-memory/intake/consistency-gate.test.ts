import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chipsFromClarificationTurn,
  findConsistencyMismatches,
  hardSetBriefFromChips,
  parseDepthChipAnswer,
} from "./consistency-gate";
import type { FashionSearchBrief } from "../router/types";

const baseBrief = (): FashionSearchBrief => ({
  recipient_person_id: "self",
  request_type: "outfit",
  garments: ["shirt", "trousers"],
  occasion_context: "office",
  quantity_hint: "a few",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "",
  depth: { looks_wanted: 1, source: "assumed" },
});

describe("consistency-gate", () => {
  it("parseDepthChipAnswer reads looks / you decide", () => {
    assert.deepEqual(parseDepthChipAnswer("2 looks"), { looks: 2 });
    assert.deepEqual(parseDepthChipAnswer("You decide"), { youDecide: true });
  });

  it("depth chip vs assumed brief → mismatch then hard-set", () => {
    const chips = chipsFromClarificationTurn({
      questions: [
        {
          text: "How many looks?",
          gap: "depth",
          kind: "consult",
          quick_options: ["2 looks", "3 looks"],
        },
      ],
      userMessage: "2 looks",
      answers: { depth: "2 looks" },
    });
    assert.equal(chips.depthLooks, 2);
    const brief = baseBrief();
    const mismatches = findConsistencyMismatches({ brief, chips });
    assert.equal(mismatches[0]?.gap, "depth");
    const fixed = hardSetBriefFromChips(brief, chips, ["depth"]);
    assert.equal(fixed.depth?.looks_wanted, 2);
    assert.equal(fixed.depth?.source, "stated");
  });

  it("slots family mismatch → hard-set garments", () => {
    const chips = {
      slotsGarments: ["blazer", "trousers"],
    };
    const brief = { ...baseBrief(), garments: ["shirt"] };
    const mismatches = findConsistencyMismatches({ brief, chips });
    assert.equal(mismatches[0]?.gap, "slots");
    const fixed = hardSetBriefFromChips(brief, chips, ["slots"]);
    assert.deepEqual(fixed.garments, ["blazer", "trousers"]);
  });
});
