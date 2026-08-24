import { randomBytes } from "node:crypto";
import type { AskVoteChoice, LookAskSharePublic } from "./types";
import { ASK_VOTE_CHOICES } from "./types";
import type { LookScanVerdict } from "@/lib/tryon/look-scan-types";
import { ownerVoterKey } from "./owner-vote";
import { publicAskImagePath } from "./ask-image";

export function generateAskToken(): string {
  return randomBytes(18).toString("base64url");
}

export function emptyTallies(): Record<AskVoteChoice, number> {
  return { no: 0, meh: 0, almost: 0, love: 0 };
}

export function tallyVotes(
  votes: Array<{ choice: string }>,
): Record<AskVoteChoice, number> {
  const tallies = emptyTallies();
  for (const v of votes) {
    if ((ASK_VOTE_CHOICES as readonly string[]).includes(v.choice)) {
      tallies[v.choice as AskVoteChoice] += 1;
    }
  }
  return tallies;
}

type ShareRow = {
  token: string;
  ownerUserId: string;
  askerName: string;
  serial: number;
  imageUrl: string;
  pieces: unknown;
  killCount: number | null;
  shoopVote: string;
  shoopVerdict: unknown;
  createdAt: Date;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
  votes: Array<{
    choice: string;
    displayName: string;
    voterKey: string;
  }>;
  notes: Array<{
    id: string;
    displayName: string;
    body: string;
    createdAt: Date;
  }>;
};

export function buildLookAskPublic(params: {
  share: ShareRow;
  viewerUserId: string | null;
  viewerVoterKey: string | null;
}): LookAskSharePublic {
  const { share, viewerUserId, viewerVoterKey } = params;
  const isOwner =
    Boolean(viewerUserId) && viewerUserId === share.ownerUserId;

  const ownerKey = ownerVoterKey(share.ownerUserId);
  const myVoteRow =
    viewerVoterKey ?
      share.votes.find((v) => v.voterKey === viewerVoterKey)
    : undefined;
  const myVote =
    myVoteRow &&
    (ASK_VOTE_CHOICES as readonly string[]).includes(myVoteRow.choice) ?
      (myVoteRow.choice as AskVoteChoice)
    : null;

  const ownerVoteRow = share.votes.find((v) => v.voterKey === ownerKey);
  const ownerVote =
    ownerVoteRow &&
    (ASK_VOTE_CHOICES as readonly string[]).includes(ownerVoteRow.choice) ?
      (ownerVoteRow.choice as AskVoteChoice)
    : null;

  const shoopRevealed = isOwner || Boolean(myVote);
  const tallies = tallyVotes(share.votes);

  // Include Shoop in revealed tallies for the poll bars.
  if (
    shoopRevealed &&
    (ASK_VOTE_CHOICES as readonly string[]).includes(share.shoopVote)
  ) {
    tallies[share.shoopVote as AskVoteChoice] += 1;
  }

  const pieces = Array.isArray(share.pieces) ? share.pieces : [];
  const verdict =
    share.shoopVerdict && typeof share.shoopVerdict === "object" ?
      (share.shoopVerdict as LookScanVerdict)
    : null;

  const votes: LookAskSharePublic["votes"] = share.votes
    .filter((v) =>
      (ASK_VOTE_CHOICES as readonly string[]).includes(v.choice),
    )
    .map((v) => {
      const isOwnerVote = v.voterKey === ownerKey;
      const rawName = v.displayName.trim();
      const displayName =
        isOwnerVote ?
          share.askerName.trim() ||
          (rawName && rawName.toLowerCase() !== "you" ? rawName : "Friend")
        : rawName || "Friend";
      return {
        choice: v.choice as AskVoteChoice,
        displayName,
        voterKey: v.voterKey,
        isOwner: isOwnerVote,
      };
    });

  if (shoopRevealed) {
    votes.push({
      choice: share.shoopVote as AskVoteChoice,
      displayName: "Shoop",
      voterKey: "shoop",
      isShoop: true,
    });
  }

  return {
    token: share.token,
    askerName: share.askerName,
    serial: share.serial,
    // Always same-origin durable route — DB may hold expired signed URLs.
    imageUrl: publicAskImagePath(share.token),
    pieces: pieces as LookAskSharePublic["pieces"],
    killCount: share.killCount,
    shoopRevealed,
    shoopVote:
      shoopRevealed ? (share.shoopVote as AskVoteChoice) : null,
    shoopVerdict: shoopRevealed ? verdict : null,
    myVote,
    ownerVote: shoopRevealed ? ownerVote : null,
    isOwner,
    votes,
    tallies,
    notes: share.notes.map((n) => ({
      id: n.id,
      displayName: n.displayName,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
    createdAt: share.createdAt.toISOString(),
    expiresAt: (share.expiresAt ?? null)
      ? share.expiresAt!.toISOString()
      : null,
    revoked: Boolean(share.revokedAt),
  };
}
