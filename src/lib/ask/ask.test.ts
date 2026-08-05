import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapVerdictToShoopVote } from "./map-shoop-vote";
import { buildLookAskPublic, tallyVotes } from "./public-payload";
import type { LookScanVerdict } from "@/lib/tryon/look-scan-types";

function verdict(
  partial: Partial<LookScanVerdict> &
    Pick<LookScanVerdict, "verdict_title" | "verdict_body">,
): LookScanVerdict {
  return {
    annotations: ["a", "b", "c", "d"],
    whispers: ["w1", "w2", "w3", "w4"],
    checks: { fit: "pass", palette: "pass", nolist: "pass" },
    ...partial,
  };
}

describe("mapVerdictToShoopVote", () => {
  it("maps nolist fail to no", () => {
    assert.equal(
      mapVerdictToShoopVote(
        verdict({
          verdict_title: "Hard pass",
          verdict_body: "On your no-list.",
          checks: { fit: "pass", palette: "pass", nolist: "fail" },
        }),
      ),
      "no",
    );
  });

  it("maps heavy fit fail to almost", () => {
    assert.equal(
      mapVerdictToShoopVote(
        verdict({
          verdict_title: "Close",
          verdict_body: "Fix the size.",
          checks: { fit: "fail", palette: "pass", nolist: "pass" },
        }),
      ),
      "almost",
    );
  });

  it("maps love language + clean checks to love", () => {
    assert.equal(
      mapVerdictToShoopVote(
        verdict({
          verdict_title: "Love-it territory",
          verdict_body: "Get it.",
          checks: { fit: "pass", palette: "pass", nolist: "pass" },
        }),
      ),
      "love",
    );
  });
});

describe("buildLookAskPublic reveal gating", () => {
  const baseShare = {
    token: "abc",
    ownerUserId: "owner-1",
    askerName: "Sara",
    serial: 42,
    imageUrl: "https://example.com/look.jpg",
    pieces: [],
    killCount: null as number | null,
    shoopVote: "almost",
    shoopVerdict: verdict({
      verdict_title: "Almost",
      verdict_body: "Fix both.",
    }),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    votes: [] as Array<{
      choice: string;
      displayName: string;
      voterKey: string;
    }>,
    notes: [] as Array<{
      id: string;
      displayName: string;
      body: string;
      createdAt: Date;
    }>,
  };

  it("hides Shoop vote until visitor has voted", () => {
    const sealed = buildLookAskPublic({
      share: baseShare,
      viewerUserId: null,
      viewerVoterKey: "guest:x",
    });
    assert.equal(sealed.shoopRevealed, false);
    assert.equal(sealed.shoopVote, null);
    assert.equal(sealed.shoopVerdict, null);
    assert.equal(sealed.tallies.almost, 0);
  });

  it("reveals Shoop after visitor votes and includes Shoop in tallies", () => {
    const revealed = buildLookAskPublic({
      share: {
        ...baseShare,
        votes: [
          {
            choice: "love",
            displayName: "Maya",
            voterKey: "guest:x",
          },
        ],
      },
      viewerUserId: null,
      viewerVoterKey: "guest:x",
    });
    assert.equal(revealed.shoopRevealed, true);
    assert.equal(revealed.shoopVote, "almost");
    assert.equal(revealed.myVote, "love");
    assert.equal(revealed.tallies.love, 1);
    assert.equal(revealed.tallies.almost, 1);
    assert.ok(revealed.votes.some((v) => v.isShoop));
  });

  it("reveals for owner without voting", () => {
    const owner = buildLookAskPublic({
      share: baseShare,
      viewerUserId: "owner-1",
      viewerVoterKey: "user:owner-1",
    });
    assert.equal(owner.shoopRevealed, true);
    assert.equal(owner.isOwner, true);
    assert.equal(owner.shoopVote, "almost");
  });

  it("tallies only known choices", () => {
    assert.deepEqual(
      tallyVotes([
        { choice: "love" },
        { choice: "love" },
        { choice: "nope" },
      ]),
      { no: 0, meh: 0, almost: 0, love: 2 },
    );
  });
});
