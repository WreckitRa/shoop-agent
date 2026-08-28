import { randomBytes } from "node:crypto";
import type {
  AskPollMode,
  AskVoteChoice,
  LookAskSharePublic,
} from "./types";
import {
  ASK_VOTE_CHOICES,
  choicesForPollMode,
  emptyTallies,
  isAskVoteChoice,
} from "./types";
import type { LookScanVerdict } from "@/lib/tryon/look-scan-types";
import { ownerVoterKey } from "./owner-vote";
import { publicAskImagePath } from "./ask-image";

export function generateAskToken(): string {
  return randomBytes(18).toString("base64url");
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
  altImageUrl?: string | null;
  altGenerationId?: string | null;
  pollMode?: string | null;
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

function resolvePollMode(share: ShareRow): AskPollMode {
  if (share.pollMode === "compare" && share.altImageUrl?.trim()) {
    return "compare";
  }
  if (share.altImageUrl?.trim() && share.pollMode !== "rate") {
    return "compare";
  }
  return "rate";
}

export function buildLookAskPublic(params: {
  share: ShareRow;
  viewerUserId: string | null;
  viewerVoterKey: string | null;
}): LookAskSharePublic {
  const { share, viewerUserId, viewerVoterKey } = params;
  const isOwner =
    Boolean(viewerUserId) && viewerUserId === share.ownerUserId;
  const pollMode = resolvePollMode(share);
  const allowed = new Set(choicesForPollMode(pollMode));

  const ownerKey = ownerVoterKey(share.ownerUserId);
  const myVoteRow =
    viewerVoterKey ?
      share.votes.find((v) => v.voterKey === viewerVoterKey)
    : undefined;
  const myVote =
    myVoteRow && isAskVoteChoice(myVoteRow.choice) && allowed.has(myVoteRow.choice)
      ? myVoteRow.choice
      : null;

  const shoopRevealed = isOwner || Boolean(myVote);

  // Sealed: no tallies, no vote rows, no notes — friends must not peek.
  if (!shoopRevealed) {
    return {
      token: share.token,
      askerName: share.askerName,
      serial: share.serial,
      pollMode,
      imageUrl: publicAskImagePath(share.token),
      altImageUrl:
        pollMode === "compare" ?
          `${publicAskImagePath(share.token)}?side=alt`
        : null,
      pieces: (Array.isArray(share.pieces) ? share.pieces : []) as LookAskSharePublic["pieces"],
      killCount: share.killCount,
      shoopRevealed: false,
      shoopVote: null,
      shoopVerdict: null,
      myVote: null,
      ownerVote: null,
      isOwner,
      votes: [],
      tallies: emptyTallies(),
      notes: [],
      createdAt: share.createdAt.toISOString(),
      expiresAt: (share.expiresAt ?? null)
        ? share.expiresAt!.toISOString()
        : null,
      revoked: Boolean(share.revokedAt),
    };
  }

  const ownerVoteRow = share.votes.find((v) => v.voterKey === ownerKey);
  const ownerVote =
    ownerVoteRow &&
    isAskVoteChoice(ownerVoteRow.choice) &&
    allowed.has(ownerVoteRow.choice)
      ? ownerVoteRow.choice
      : null;

  const modeVotes = share.votes.filter(
    (v) => isAskVoteChoice(v.choice) && allowed.has(v.choice),
  );
  const tallies = tallyVotes(modeVotes);

  if (isAskVoteChoice(share.shoopVote) && allowed.has(share.shoopVote)) {
    tallies[share.shoopVote] += 1;
  }

  const pieces = Array.isArray(share.pieces) ? share.pieces : [];
  const verdict =
    share.shoopVerdict && typeof share.shoopVerdict === "object" ?
      (share.shoopVerdict as LookScanVerdict)
    : null;

  const votes: LookAskSharePublic["votes"] = modeVotes.map((v) => {
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

  if (isAskVoteChoice(share.shoopVote) && allowed.has(share.shoopVote)) {
    votes.push({
      choice: share.shoopVote,
      displayName: "Shoop",
      voterKey: "shoop",
      isShoop: true,
    });
  }

  return {
    token: share.token,
    askerName: share.askerName,
    serial: share.serial,
    pollMode,
    imageUrl: publicAskImagePath(share.token),
    altImageUrl:
      pollMode === "compare" ?
        `${publicAskImagePath(share.token)}?side=alt`
      : null,
    pieces: pieces as LookAskSharePublic["pieces"],
    killCount: share.killCount,
    shoopRevealed: true,
    shoopVote: isAskVoteChoice(share.shoopVote) ? share.shoopVote : null,
    shoopVerdict: verdict,
    myVote,
    ownerVote,
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
