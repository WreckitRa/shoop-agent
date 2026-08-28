import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BANNED_STYLIST_LINES,
  buildSpokenSearchReply,
  formatKnownSummarySpeech,
  isBannedStylistLine,
  knownSummaryPassesTemplate,
  replyUsesClientWords,
} from "../router/voice-hygiene";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";

describe("voice hygiene", () => {
  it("flags recurring script lines", () => {
    for (const line of BANNED_STYLIST_LINES) {
      assert.equal(isBannedStylistLine(line), true);
    }
    assert.equal(isBannedStylistLine("On it — dress for interview."), false);
  });

  it("rejects bare Going on: log dumps as known_summary", () => {
    assert.equal(knownSummaryPassesTemplate("Going on: mens, shirt."), false);
    assert.equal(
      knownSummaryPassesTemplate("I know you shop mens · tops L."),
      true,
    );
  });

  it("spoken ready reply uses client words", () => {
    const reply = buildSpokenSearchReply({
      lastUser: "looking for dress + sandals for job interview, size M",
      garments: ["dress", "sandals"],
      occasion: "job interview",
    });
    assert.match(reply, /dress|sandals|interview/i);
    assert.equal(
      replyUsesClientWords({
        reply,
        lastUser: "looking for dress + sandals for job interview, size M",
      }),
      true,
    );
    assert.doesNotMatch(reply, /^Going on:/i);
  });

  it("formatKnownSummarySpeech is warm not a log", () => {
    const s = formatKnownSummarySpeech({
      department: "womens",
      garments: ["shirt", "trousers"],
      sizeLines: ["tops S"],
    });
    assert.match(s ?? "", /I know/i);
    assert.doesNotMatch(s ?? "", /^Going on:/i);
  });

  it("prompt bans reuse of scripted lines", () => {
    assert.match(ROUTER_PROMPT_STATIC, /never reuse a line/i);
    assert.match(ROUTER_PROMPT_STATIC, /Happy to help/);
  });
});
