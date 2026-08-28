import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TranscriptTurn } from "./run-persona";
import {
  purchaseRecalled,
  stripeLeaksUserFacing,
  visit2Checks,
} from "./golden-visit-2";

function ask(
  text: string,
  gap: "depth" | "preference_anchor",
  known?: string,
): TranscriptTurn {
  return {
    role: "assistant",
    content: text,
    at: "2026-08-28T00:00:00.000Z",
    router: {
      move: "ask_clarification",
      reply: text,
      known_summary: known,
      questions: [
        {
          gap,
          kind: "consult",
          text,
          quick_options: [],
        },
      ],
    },
  };
}

function user(content: string): TranscriptTurn {
  return { role: "user", content, at: "2026-08-28T00:00:00.000Z" };
}

describe("golden-visit-2 checks", () => {
  it("passes when visit 2 is anchor-only: Percival recall, no depth, no stripes, zero consults", () => {
    const visit1 = {
      transcript: [
        user("need a shirt for a client dinner thursday"),
        ask("How many options?", "depth"),
        user("depth: 3 options"),
      ],
    };
    const visit2 = {
      transcript: [
        user("got another dinner coming up"),
        ask(
          "last time you took the navy Percival — same lane?",
          "preference_anchor",
          "last time you took the navy Percival",
        ),
      ],
    };
    const checks = visit2Checks({
      visit1,
      visit2,
      extractionDone: true,
    });
    assert.deepEqual(
      Object.fromEntries(checks.map((c) => [c.id, c.pass])),
      {
        extraction_finished: true,
        purchase_recalled: true,
        fewer_consults: true,
        visit2_anchor_only: true,
        no_depth_reask: true,
        no_stripe_user_facing: true,
      },
    );
    assert.equal(
      checks.find((c) => c.id === "fewer_consults")?.reason,
      "consults excluding preference_anchor visit1=1 visit2=0",
    );
  });

  it("fails fewer_consults when visit 2 re-asks depth (1–1 of real consults)", () => {
    const visit1 = {
      transcript: [
        user("need a shirt for a client dinner thursday"),
        ask("How many options?", "depth"),
        user("depth: 3 options"),
      ],
    };
    const visit2 = {
      transcript: [
        user("got another dinner coming up"),
        ask("How many this time?", "depth"),
      ],
    };
    const checks = visit2Checks({
      visit1,
      visit2,
      extractionDone: true,
    });
    assert.equal(checks.find((c) => c.id === "fewer_consults")?.pass, false);
    assert.equal(checks.find((c) => c.id === "visit2_anchor_only")?.pass, false);
    assert.equal(checks.find((c) => c.id === "no_depth_reask")?.pass, false);
  });

  it("passes fewer_consults when visit 1 also asked no consults (0–0)", () => {
    const visit1 = {
      transcript: [user("need a shirt for a client dinner thursday")],
    };
    const visit2 = {
      transcript: [
        user("got another dinner coming up"),
        ask(
          "last time you took the navy Percival — same lane?",
          "preference_anchor",
          "last time you took the navy Percival",
        ),
      ],
    };
    const checks = visit2Checks({
      visit1,
      visit2,
      extractionDone: true,
    });
    assert.equal(checks.find((c) => c.id === "fewer_consults")?.pass, true);
    assert.equal(checks.find((c) => c.id === "visit2_anchor_only")?.pass, true);
  });

  it("fails when stripes leak or Percival is unnamed", () => {
    assert.equal(purchaseRecalled("navy shirt"), false);
    assert.equal(purchaseRecalled("navy Percival"), true);
    assert.equal(stripeLeaksUserFacing("not the striped one"), true);
    assert.equal(stripeLeaksUserFacing("navy Percival — same lane?"), false);
  });
});
