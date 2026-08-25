import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatPostBodySchema,
  conversationPostSchema,
} from "./validators";
import { MAX_USER_MESSAGE_LENGTH } from "./constants";

const CUID = "clh6x1v0k000008l8abcdefgh";

describe("chat and conversation request schemas", () => {
  it("requires a message on send and rejects unknown keys", () => {
    assert.equal(chatPostBodySchema.safeParse({}).success, false);
    assert.equal(chatPostBodySchema.safeParse({ message: "   " }).success, false);
    assert.equal(chatPostBodySchema.safeParse({ message: "navy knit polo" }).success, true);
    assert.equal(
      chatPostBodySchema.safeParse({ message: "hi", extra: true }).success,
      false,
    );
  });

  it("requires target and conversation ids for edit and regenerate", () => {
    assert.equal(
      chatPostBodySchema.safeParse({
        mode: "edit",
        message: "revised",
        conversationId: CUID,
      }).success,
      false,
    );
    assert.equal(
      chatPostBodySchema.safeParse({
        mode: "regenerate",
        conversationId: CUID,
        targetMessageId: CUID,
      }).success,
      true,
    );
    assert.equal(
      chatPostBodySchema.safeParse({
        mode: "edit",
        message: "revised",
        conversationId: CUID,
        targetMessageId: CUID,
      }).success,
      true,
    );
  });

  it("rejects oversized user messages", () => {
    assert.equal(
      chatPostBodySchema.safeParse({
        message: "x".repeat(MAX_USER_MESSAGE_LENGTH + 1),
      }).success,
      false,
    );
  });

  it("conversation create schema is strict", () => {
    assert.equal(conversationPostSchema.safeParse({}).success, true);
    assert.equal(conversationPostSchema.safeParse({ title: "Trip" }).success, true);
    assert.equal(
      conversationPostSchema.safeParse({ title: "Trip", unknown: 1 }).success,
      false,
    );
  });
});
