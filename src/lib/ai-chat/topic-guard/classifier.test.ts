import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatTopicGuardHistoryBlock,
  type TopicGuardHistoryTurn,
} from "./history";
import { topicGuardClassifierUserPrompt } from "./classifier";

describe("topicGuardClassifierUserPrompt", () => {
  it("includes conversation history when provided", () => {
    const history: TopicGuardHistoryTurn[] = [
      { role: "user", content: "gift ideas for my brother" },
      { role: "assistant", content: "What is his age range?" },
    ];
    const prompt = topicGuardClassifierUserPrompt({
      latestMessage: "under $80",
      history,
    });
    assert.match(prompt, /conversation_history/);
    assert.match(prompt, /gift ideas for my brother/);
    assert.match(prompt, /latest_user_message/);
    assert.match(prompt, /under \$80/);
  });

  it("omits history block when empty", () => {
    const prompt = topicGuardClassifierUserPrompt({
      latestMessage: "find running shoes",
      history: [],
    });
    assert.doesNotMatch(prompt, /conversation_history/);
    assert.match(prompt, /find running shoes/);
  });
});

describe("formatTopicGuardHistoryBlock", () => {
  it("formats roles for the classifier", () => {
    const block = formatTopicGuardHistoryBlock([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi there" },
    ]);
    assert.match(block, /User: hello/);
    assert.match(block, /Assistant: Hi there/);
  });
});
