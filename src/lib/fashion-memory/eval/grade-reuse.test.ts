import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canReuseGrade,
  currentPromptHashes,
  transcriptGradeFingerprint,
} from "./grade-reuse";
import type { JudgeGrade } from "./judge-prompt";
import type { TranscriptTurn } from "./run-persona";

function sampleGrade(overall: number): JudgeGrade {
  const dim = { score: 3, why: "ok" };
  return {
    recognized: dim,
    asked_right: dim,
    not_interrogated: dim,
    no_silent_guess: dim,
    accuracy: dim,
    voice: dim,
    would_proceed: dim,
    would_buy: { score: 0, why: "n/a router stage" },
    overall,
    worst_moment: { quote: "", better: "" },
  };
}

const assistantTurn = (content: string, router?: TranscriptTurn["router"]): TranscriptTurn => ({
  role: "assistant",
  content,
  router,
  at: "2026-08-27T00:00:00.000Z",
});

describe("transcriptGradeFingerprint", () => {
  it("is stable for identical assistant lines and router payloads", () => {
    const router = {
      move: "ask_clarification" as const,
      reply: "Hi",
      questions: [{ text: "Size?", gap: "sizes", kind: "blocking" as const }],
    };
    const t = [
      assistantTurn("Hi", router),
      assistantTurn("Hi", router),
    ];
    assert.equal(transcriptGradeFingerprint(t), transcriptGradeFingerprint(t));
  });

  it("changes when assistant content differs", () => {
    const a = [assistantTurn("one")];
    const b = [assistantTurn("two")];
    assert.notEqual(transcriptGradeFingerprint(a), transcriptGradeFingerprint(b));
  });

  it("changes when router tool payload differs", () => {
    const a = [
      assistantTurn("Hi", {
        move: "ask_clarification",
        reply: "Hi",
        questions: [{ text: "A", gap: "sizes", kind: "blocking" }],
      }),
    ];
    const b = [
      assistantTurn("Hi", {
        move: "ask_clarification",
        reply: "Hi",
        questions: [{ text: "B", gap: "sizes", kind: "blocking" }],
      }),
    ];
    assert.notEqual(transcriptGradeFingerprint(a), transcriptGradeFingerprint(b));
  });

  it("ignores user turns", () => {
    const withUser: TranscriptTurn[] = [
      { role: "user", content: "hello", at: "t" },
      assistantTurn("reply"),
    ];
    const assistantOnly = [assistantTurn("reply")];
    assert.equal(
      transcriptGradeFingerprint(withUser),
      transcriptGradeFingerprint(assistantOnly),
    );
  });
});

describe("canReuseGrade", () => {
  const hashes = currentPromptHashes();

  it("reuses when fingerprint and router hash match", () => {
    const fp = "abc123";
    assert.equal(
      canReuseGrade({
        fingerprint: fp,
        currentPromptHashes: hashes,
        previous: {
          judge: sampleGrade(3.5),
          grade_fingerprint: fp,
          prompt_hashes: hashes,
        },
      }),
      true,
    );
  });

  it("refuses when router prompt hash changed", () => {
    const fp = "abc123";
    assert.equal(
      canReuseGrade({
        fingerprint: fp,
        currentPromptHashes: hashes,
        previous: {
          judge: sampleGrade(3.5),
          grade_fingerprint: fp,
          prompt_hashes: { router: "stale-hash" },
        },
      }),
      false,
    );
  });

  it("refuses when fingerprint differs", () => {
    assert.equal(
      canReuseGrade({
        fingerprint: "new",
        currentPromptHashes: hashes,
        previous: {
          judge: sampleGrade(3.5),
          grade_fingerprint: "old",
          prompt_hashes: hashes,
        },
      }),
      false,
    );
  });
});
