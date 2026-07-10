import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyIntentBranchSplitsToMessages } from "./apply-splits-to-messages";
import type { ChatMessage, ConversationBranchSummary } from "../types";

const baseMsg = (
  id: string,
  role: ChatMessage["role"],
  branchId?: string,
): ChatMessage => ({
  id,
  conversationId: "conv1",
  role,
  content: "hello",
  status: "completed",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  branchId,
});

describe("applyIntentBranchSplitsToMessages", () => {
  it("assigns branch id to anchor user and following assistant", () => {
    const messages = [
      baseMsg("u1", "user", "boot"),
      baseMsg("a1", "assistant", "boot"),
      baseMsg("u2", "user", "boot"),
      baseMsg("a2", "assistant", "boot"),
    ];
    const branches: ConversationBranchSummary[] = [
      {
        id: "branch-gift",
        conversationId: "conv1",
        index: 1,
        title: "Gift for mom",
        anchorMessageId: "u2",
        sourceMessageId: "u2",
        createdAt: "2026-01-01T00:01:00.000Z",
      },
    ];

    const out = applyIntentBranchSplitsToMessages(messages, branches);
    assert.equal(out[2]?.branchId, "branch-gift");
    assert.equal(out[3]?.branchId, "branch-gift");
    assert.equal(out[0]?.branchId, "boot");
    assert.equal(out[1]?.branchId, "boot");
  });
});
