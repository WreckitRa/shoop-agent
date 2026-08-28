import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRateLimitedResponse,
  retryAfterMs,
} from "./guest-fetch";

describe("guestFetch rate-limit helpers", () => {
  it("treats 429 and Too many requests body as rate limited", () => {
    assert.equal(
      isRateLimitedResponse(new Response(null, { status: 429 })),
      true,
    );
    assert.equal(
      isRateLimitedResponse(
        new Response(null, { status: 400 }),
        "Too many requests. Please slow down.",
      ),
      true,
    );
    assert.equal(
      isRateLimitedResponse(new Response(null, { status: 400 }), "Nope"),
      false,
    );
  });

  it("honors Retry-After seconds and caps wait", () => {
    const res = new Response(null, {
      status: 429,
      headers: { "Retry-After": "12" },
    });
    assert.equal(retryAfterMs(res, 0), 12_000);

    const long = new Response(null, {
      status: 429,
      headers: { "Retry-After": "120" },
    });
    assert.equal(retryAfterMs(long, 0), 30_000);
  });

  it("falls back to exponential backoff without Retry-After", () => {
    const res = new Response(null, { status: 429 });
    assert.equal(retryAfterMs(res, 0), 1000);
    assert.equal(retryAfterMs(res, 1), 2000);
    assert.equal(retryAfterMs(res, 4), 8000);
  });
});
