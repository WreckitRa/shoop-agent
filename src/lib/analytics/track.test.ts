import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { isProductEventName, PRODUCT_EVENT_NAMES } from "./names";
import {
  beginProductEventCapture,
  endProductEventCapture,
  trackProductEvent,
} from "./track";

describe("product analytics", () => {
  afterEach(() => {
    endProductEventCapture();
  });

  it("covers the minimum North Star event set", () => {
    assert.deepEqual([...PRODUCT_EVENT_NAMES], [
      "signup_completed",
      "photo_uploaded",
      "twin_render_started",
      "twin_render_completed",
      "twin_render_failed",
      "look_viewed",
      "item_reacted",
      "friend_ask_sent",
      "friend_vote_received",
      "checkout_start",
      "outbound_click",
    ]);
  });

  it("validates event names", () => {
    assert.equal(isProductEventName("item_reacted"), true);
    assert.equal(isProductEventName("not_a_real_event"), false);
  });

  it("captures trackProductEvent with user + session", async () => {
    const capture = beginProductEventCapture();
    trackProductEvent({
      name: "item_reacted",
      userId: "user-1",
      sessionId: "11111111-1111-4111-8111-111111111111",
      props: { item_id: "p1", reaction: "accept" },
    });
    await Promise.resolve();
    assert.equal(capture.length, 1);
    assert.equal(capture[0]?.name, "item_reacted");
    assert.equal(capture[0]?.userId, "user-1");
    assert.equal(capture[0]?.sessionId, "11111111-1111-4111-8111-111111111111");
    assert.deepEqual(capture[0]?.props, {
      item_id: "p1",
      reaction: "accept",
    });
  });

  it("skips events missing session when none can be resolved", async () => {
    const capture = beginProductEventCapture();
    trackProductEvent({
      name: "signup_completed",
      userId: "user-1",
      sessionId: null,
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(capture.length, 0);
  });
});
