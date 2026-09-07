import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapVerdictToShoopVote } from "./map-shoop-vote";
import { buildLookAskPublic, tallyVotes } from "./public-payload";
import { askLookLabel } from "./types";
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

  it("maps buy language to love even when body says fine/ok", () => {
    assert.equal(
      mapVerdictToShoopVote(
        verdict({
          verdict_title: "Buy this",
          verdict_body: "The length is fine and the knit looks okay — **buy it**.",
          checks: { fit: "pass", palette: "pass", nolist: "pass" },
        }),
      ),
      "love",
    );
  });

  it("does not treat fine/ok alone as meh", () => {
    assert.equal(
      mapVerdictToShoopVote(
        verdict({
          verdict_title: "Quiet win",
          verdict_body: "Fit is fine. Palette is okay. Clean and wearable.",
          checks: { fit: "pass", palette: "pass", nolist: "pass" },
        }),
      ),
      "love",
    );
  });

  it("honors explicit vote from the scan", () => {
    assert.equal(
      mapVerdictToShoopVote(
        verdict({
          verdict_title: "Soft take",
          verdict_body: "Fine for now.",
          vote: "love",
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

  it("hides friend tallies and vote rows until visitor has voted", () => {
    const sealed = buildLookAskPublic({
      share: {
        ...baseShare,
        votes: [
          {
            choice: "love",
            displayName: "Prior",
            voterKey: "guest:prior",
          },
        ],
      },
      viewerUserId: null,
      viewerVoterKey: "guest:x",
    });
    assert.equal(sealed.shoopRevealed, false);
    assert.equal(sealed.votes.length, 0);
    assert.equal(sealed.tallies.love, 0);
    assert.equal(sealed.notes.length, 0);
    assert.equal(sealed.ownerVote, null);
  });

  it("hides Shoop vote until visitor has voted", () => {
    const sealed = buildLookAskPublic({
      share: baseShare,
      viewerUserId: null,
      viewerVoterKey: "guest:x",
    });
    assert.equal(sealed.shoopRevealed, false);
    assert.equal(sealed.shoopVote, null);
    assert.equal(sealed.shoopVerdict, null);
    assert.equal(sealed.imageUrl, "/api/ask/abc/image");
    assert.equal(sealed.tallies.almost, 0);
    assert.equal(sealed.pollMode, "rate");
  });

  it("exposes compare images and a|b choices", () => {
    const sealed = buildLookAskPublic({
      share: {
        ...baseShare,
        pollMode: "compare",
        altImageUrl: "path:alt.jpg",
        shoopVote: "a",
      },
      viewerUserId: null,
      viewerVoterKey: "guest:x",
    });
    assert.equal(sealed.pollMode, "compare");
    assert.equal(sealed.altImageUrl, "/api/ask/abc/image?side=alt");
    assert.equal(sealed.looks.length, 2);
    assert.equal(sealed.looks[0]?.title, "Look 1");
    assert.equal(sealed.looks[1]?.title, "Look 2");
    assert.equal(sealed.shoopRevealed, false);

    const revealed = buildLookAskPublic({
      share: {
        ...baseShare,
        pollMode: "compare",
        altImageUrl: "path:alt.jpg",
        shoopVote: "a",
        votes: [
          {
            choice: "b",
            displayName: "Maya",
            voterKey: "guest:x",
          },
        ],
      },
      viewerUserId: null,
      viewerVoterKey: "guest:x",
    });
    assert.equal(revealed.shoopRevealed, true);
    assert.equal(revealed.myVote, "b");
    assert.equal(revealed.shoopVote, "a");
    assert.equal(revealed.tallies.a, 1);
    assert.equal(revealed.tallies.b, 1);
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
    assert.equal(owner.ownerVote, null);
  });

  it("surfaces owner strip vote with isOwner on the vote row", () => {
    const owner = buildLookAskPublic({
      share: {
        ...baseShare,
        votes: [
          {
            choice: "love",
            displayName: "Sara",
            voterKey: "user:owner-1",
          },
        ],
      },
      viewerUserId: "guest",
      viewerVoterKey: "guest:x",
    });
    // Guest hasn't voted — sealed.
    assert.equal(owner.shoopRevealed, false);
    assert.equal(owner.ownerVote, null);

    const friend = buildLookAskPublic({
      share: {
        ...baseShare,
        votes: [
          {
            choice: "love",
            displayName: "Sara",
            voterKey: "user:owner-1",
          },
          {
            choice: "meh",
            displayName: "Maya",
            voterKey: "guest:x",
          },
        ],
      },
      viewerUserId: null,
      viewerVoterKey: "guest:x",
    });
    assert.equal(friend.shoopRevealed, true);
    assert.equal(friend.ownerVote, "love");
    assert.ok(friend.votes.some((v) => v.isOwner && v.choice === "love"));
  });

  it("replaces placeholder owner displayName with askerName", () => {
    const payload = buildLookAskPublic({
      share: {
        ...baseShare,
        votes: [
          {
            choice: "love",
            displayName: "You",
            voterKey: "user:owner-1",
          },
          {
            choice: "meh",
            displayName: "Maya",
            voterKey: "guest:x",
          },
        ],
      },
      viewerUserId: null,
      viewerVoterKey: "guest:x",
    });
    const ownerVote = payload.votes.find((v) => v.isOwner);
    assert.equal(ownerVote?.displayName, "Sara");
  });

  it("tallies only known choices", () => {
    assert.deepEqual(
      tallyVotes([
        { choice: "love" },
        { choice: "love" },
        { choice: "nope" },
      ]),
      { no: 0, meh: 0, almost: 0, love: 2, a: 0, b: 0, c: 0, d: 0, e: 0 },
    );
  });

  it("lays out extra looks with garment titles", () => {
    const sealed = buildLookAskPublic({
      share: {
        ...baseShare,
        pollMode: "compare",
        lookTitle: "Navy blazer",
        altImageUrl: "path:alt.jpg",
        extraLooks: [
          { generationId: "g2", imageUrl: "path:alt.jpg", title: "Silk slip" },
          { generationId: "g3", imageUrl: "path:third.jpg", title: "fitting-room:x" },
        ],
        shoopVote: "a",
      },
      viewerUserId: null,
      viewerVoterKey: "guest:x",
    });
    assert.equal(sealed.pollMode, "compare");
    assert.equal(sealed.looks.length, 3);
    assert.equal(sealed.looks[0]?.title, "Navy blazer");
    assert.equal(sealed.looks[1]?.title, "Silk slip");
    assert.equal(sealed.looks[2]?.title, "Look 3");
    assert.equal(sealed.looks[2]?.imageUrl, "/api/ask/abc/image?side=2");
  });
});

describe("askLookLabel", () => {
  it("uses garment titles and falls back to Look N", () => {
    assert.equal(askLookLabel(0, "Navy blazer"), "Navy blazer");
    assert.equal(askLookLabel(0, "fitting-room:dress"), "Look 1");
    assert.equal(askLookLabel(1, "Saved look"), "Look 2");
    assert.equal(askLookLabel(2, ""), "Look 3");
  });
});
