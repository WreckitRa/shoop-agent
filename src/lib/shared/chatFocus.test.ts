import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatReturnPath,
  parseChatFocusFromSearchParams,
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
});
