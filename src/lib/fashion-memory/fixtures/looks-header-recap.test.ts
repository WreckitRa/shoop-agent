import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agreedDepth } from "../agreed-depth";
import { curationLooksTarget } from "../curation/deliverables";
import {
  formatCountLabel,
  formatPullSheetRecap,
} from "../router/pull-sheet";
import type { FashionSearchBrief } from "../router/types";

const oneLook: FashionSearchBrief = {
  recipient_person_id: "self",
  request_type: "outfit",
  garments: ["shirt", "trousers", "shoes"],
  occasion_context: "baptism",
  quantity_hint: "one look",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "Dressy baptism",
  depth: { looks_wanted: 1, source: "stated" },
};

describe("looks_header_recap", () => {
  it("looks_wanted 1 → header and recap both say 1 look", () => {
    assert.equal(agreedDepth(oneLook).looks, 1);
    assert.equal(curationLooksTarget(oneLook), 1);
    assert.equal(formatCountLabel(1, "look", "looks"), "1 look");
    assert.equal(formatCountLabel(3, "look", "looks"), "3 looks");
    const recap = formatPullSheetRecap(oneLook);
    assert.match(recap ?? "", /\b1 look\b/);
    assert.doesNotMatch(recap ?? "", /1 looks/);
  });

  it("validate target does not lift toward 3", () => {
    assert.equal(curationLooksTarget(oneLook), 1);
    assert.equal(
      curationLooksTarget({
        ...oneLook,
        depth: { looks_wanted: 1, source: "you_decide" },
      }),
      1,
    );
  });
});
