import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBrief } from "../search/archetype";
import {
  buildTierJudgeSystemPrompt,
  buildTierJudgeTriageSystemPrompt,
  cleanDirectionLabel,
  composeClientPicture,
  composeSpecialistFrame,
  getRetrievedExpertiseForBrief,
} from "./prompt-assembler";

describe("gift direction prompt assembly", () => {
  const brief = buildSearchBrief({
    query: "premium kitchen cooking food gift for women",
    fields: {
      archetype: "gift_directed",
      direction_label: "🍳 Premium Kitchen & Food",
      use_case: "anniversary",
      recipient: {
        kind: "other",
        label: "wife",
        known_interests: ["travel", "cooking", "wellness"],
      },
    },
  });

  it("strips emoji from direction labels", () => {
    assert.equal(
      cleanDirectionLabel("✈️ Luxury Travel Accessories"),
      "Luxury Travel Accessories",
    );
  });

  it("frames specialist as direction expert", () => {
    const frame = composeSpecialistFrame(brief);
    assert.match(frame, /Premium Kitchen & Food specialist/i);
    assert.match(frame, /expert in Premium Kitchen & Food/i);
    assert.doesNotMatch(frame, /premium kitchen cooking food gift/i);
  });

  it("client picture leads with direction lane, not polluted query", () => {
    const picture = composeClientPicture(brief);
    assert.match(picture, /explore this gift direction: Premium Kitchen & Food/i);
    assert.match(picture, /Catalog seed query:/i);
    assert.match(picture, /anniversary/i);
    assert.doesNotMatch(picture, /They asked for:/i);
  });

  it("retrieved expertise is keyed to direction lane", () => {
    const expertise = getRetrievedExpertiseForBrief(brief);
    assert.match(expertise, /Premium Kitchen & Food/i);
    assert.match(expertise, /direction/i);
  });

  it("system prompt elicits buying rules before tier sort", () => {
    const triage = buildTierJudgeTriageSystemPrompt();
    assert.match(triage, /4–5 rules a master stylist or buyer/i);
    assert.match(triage, /WIDE TRIAGE/i);
    assert.match(triage, /emit_triage_verdicts/i);

    const compare = buildTierJudgeSystemPrompt();
    assert.match(compare, /product photo/i);
    assert.match(compare, /silhouette/i);
    assert.match(compare, /JUDGE COMPARATIVELY/i);
    assert.match(compare, /head_to_head/i);
    assert.match(compare, /checks/i);
    assert.match(compare, /DEEP COMPARE/i);
  });
});
