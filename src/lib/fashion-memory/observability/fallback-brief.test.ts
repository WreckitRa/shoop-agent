import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFallbackBriefFromContext } from "./fallback-brief";
import { pendingBriefMeta } from "../intake/pending-brief";
import type { FashionSearchBrief } from "../router/types";

const dressBrief = (): FashionSearchBrief => ({
  recipient_person_id: "mother-id",
  request_type: "single_item",
  garments: ["dress"],
  occasion_context: "formal",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "colorful v neck long dress for formal outing",
});

describe("buildFallbackBriefFromContext", () => {
  it("returns null without a parked pending brief — no keyword invent", () => {
    const out = buildFallbackBriefFromContext({
      context: {
        roster: "#abcd self\n#efgh mother",
        profiles: "",
        currentDate: "2026-07-09",
        personShortIds: {
          abcd: "self-id",
          efgh: "mother-id",
        },
        conversationMessages: [
          {
            role: "user",
            content:
              "colorful v neck long dress for formal outing for my mother",
          },
        ],
      },
      reason: "test",
    });
    assert.equal(out, null);
  });

  it("resumes parked pending brief only", () => {
    const pending = pendingBriefMeta(dressBrief(), "mother-id");
    const { brief } = buildFallbackBriefFromContext({
      context: {
        roster: "#abcd self\n#efgh mother",
        profiles: "",
        currentDate: "2026-07-09",
        personShortIds: {
          abcd: "self-id",
          efgh: "mother-id",
        },
        conversationMessages: [
          { role: "user", content: "M" },
        ],
      },
      pendingBrief: pending,
      reason: "test",
    })!;
    assert.deepEqual(brief.garments, ["dress"]);
    assert.equal(brief.request_type, "single_item");
    assert.equal(brief.occasion_context, "formal");
  });
});
