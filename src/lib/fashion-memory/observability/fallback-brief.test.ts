import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFallbackBriefFromContext,
  inferGarmentsFromText,
} from "./fallback-brief";

describe("inferGarmentsFromText", () => {
  it("detects dress from a gift request", () => {
    assert.deepEqual(
      inferGarmentsFromText(
        "colorful v neck long dress for formal outing for my mother",
      ),
      ["dress"],
    );
  });

  it("detects blazer", () => {
    assert.deepEqual(inferGarmentsFromText("linen blazer for work"), [
      "blazer",
    ]);
  });
});

describe("buildFallbackBriefFromContext", () => {
  it("uses dress not outfit checklist when user asked for a dress", () => {
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
          {
            role: "user",
            content:
              "colorful v neck long dress for formal outing for my mother",
          },
        ],
      },
      reason: "test",
    });
    assert.deepEqual(brief.garments, ["dress"]);
    assert.equal(brief.request_type, "single_item");
    assert.equal(brief.occasion_context, "formal");
  });
});
