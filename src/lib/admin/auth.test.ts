import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_TOKEN_HEADER,
  isAdminConfigured,
  verifyAdminRequest,
  verifyAdminToken,
} from "./auth";

describe("admin token auth", () => {
  it("rejects missing config and mismatched tokens", () => {
    const prev = process.env.AI_CHAT_ADMIN_TOKEN;
    delete process.env.AI_CHAT_ADMIN_TOKEN;
    try {
      assert.equal(isAdminConfigured(), false);
      assert.equal(verifyAdminToken("x"), false);

      process.env.AI_CHAT_ADMIN_TOKEN = "admin-secret";
      assert.equal(isAdminConfigured(), true);
      assert.equal(verifyAdminToken("admin-secret"), true);
      assert.equal(verifyAdminToken("nope"), false);
      assert.equal(
        verifyAdminRequest(new Request("http://local", { headers: { [ADMIN_TOKEN_HEADER]: "nope" } })),
        false,
      );
      assert.equal(
        verifyAdminRequest(
          new Request("http://local", { headers: { [ADMIN_TOKEN_HEADER]: "admin-secret" } }),
        ),
        true,
      );
    } finally {
      if (prev) process.env.AI_CHAT_ADMIN_TOKEN = prev;
      else delete process.env.AI_CHAT_ADMIN_TOKEN;
    }
  });
});
