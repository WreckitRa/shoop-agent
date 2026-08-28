import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  beginLineReuseRun,
  endLineReuseRun,
  lineReuseRates,
  priorSpokenCount,
  recordSpokenReply,
  shouldRejectSpokenReply,
  spokenReplyKey,
} from "../router/voice-line-reuse";

describe("voice line-reuse gate", () => {
  beforeEach(() => beginLineReuseRun());
  afterEach(() => endLineReuseRun());

  it("flags banned lines on first sight", () => {
    assert.equal(
      shouldRejectSpokenReply({
        reply: "Happy to help! What's the occasion you're shopping for?",
        conversationMessages: [],
      }),
      "banned",
    );
  });

  it("flags reuse only after ≥2 prior sightings", () => {
    const line = "Baptism looks — shopping that now.";
    assert.equal(
      shouldRejectSpokenReply({ reply: line, conversationMessages: [] }),
      null,
    );
    recordSpokenReply(line);
    recordSpokenReply(line);
    assert.equal(priorSpokenCount(spokenReplyKey(line), []), 2);
    assert.equal(
      shouldRejectSpokenReply({ reply: line, conversationMessages: [] }),
      "reuse",
    );
  });

  it("rates use spoken_turns as denominator", () => {
    const rates = lineReuseRates({
      spoken_turns: 10,
      flagged: 4,
      retries: 4,
      persisted: 1,
    });
    assert.equal(rates.line_reuse_rate, 40);
    assert.equal(rates.retry_rate, 40);
    assert.equal(rates.persisted_rate, 10);
  });
});

describe("post-router stock reply deletions", () => {
  it("does not hardcode the two salesman's stock replies", () => {
    const src = readFileSync(
      path.join(
        process.cwd(),
        "src/lib/fashion-memory/intake/post-router.ts",
      ),
      "utf8",
    );
    assert.doesNotMatch(
      src,
      /Same lane as last time, or something new\?/,
    );
    assert.doesNotMatch(src, /What pieces should I pull\?/);
  });
});
