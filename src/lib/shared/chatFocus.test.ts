import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatReturnPath,
  parseChatFocusFromSearchParams,
  resolveProductBackHref,
} from "./chatFocus";

describe("chatFocus", () => {
  it("builds and parses a return path with message and product", () => {
    const path = buildChatReturnPath("conv123abc456", {
      messageId: "msg123abc456",
      productId: "gid://shopify/p/abc",
    });
    assert.match(path, /\/c\/conv123abc456/);
    const parsed = parseChatFocusFromSearchParams(new URL(path, "https://x").searchParams);
    assert.deepEqual(parsed, {
      messageId: "msg123abc456",
      productId: "gid://shopify/p/abc",
    });
  });

  it("rejects invalid message ids", () => {
    assert.equal(
      parseChatFocusFromSearchParams(
        new URLSearchParams({ msg: "../../etc/passwd" }),
      ),
      null,
    );
  });

  it("sanitizes product back href and strips unknown params", () => {
    const from = encodeURIComponent(
      "/c/conv1?msg=msg123abc456&product=gid%3A%2F%2Fshopify%2Fp%2F1&evil=1",
    );
    assert.equal(
      resolveProductBackHref(from),
      "/c/conv1?msg=msg123abc456&product=gid%3A%2F%2Fshopify%2Fp%2F1",
    );
  });

  it("blocks open redirects in back href", () => {
    assert.equal(resolveProductBackHref(encodeURIComponent("//evil.com")), "/");
    assert.equal(
      resolveProductBackHref(encodeURIComponent("https://evil.com")),
      "/",
    );
  });

  it("rejects non-chat app paths in back href", () => {
    assert.equal(resolveProductBackHref(encodeURIComponent("/chat/conv1")), "/");
    assert.equal(resolveProductBackHref(encodeURIComponent("/profile")), "/");
  });
});
