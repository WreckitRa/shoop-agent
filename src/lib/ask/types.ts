/** Ask your friends — shared types (client + server safe). */

import type { LookScanPiece, LookScanVerdict } from "@/lib/tryon/look-scan-types";

/** Isolation rating (legacy / single-look fallback). */
export const ASK_RATE_CHOICES = ["no", "meh", "almost", "love"] as const;
export type AskRateChoice = (typeof ASK_RATE_CHOICES)[number];

/** Comparative: pick look A (this) or look B (challenger). */
export const ASK_COMPARE_CHOICES = ["a", "b"] as const;
export type AskCompareChoice = (typeof ASK_COMPARE_CHOICES)[number];

export const ASK_VOTE_CHOICES = [
  ...ASK_RATE_CHOICES,
  ...ASK_COMPARE_CHOICES,
] as const;
export type AskVoteChoice = (typeof ASK_VOTE_CHOICES)[number];

export type AskPollMode = "compare" | "rate";

export const ASK_VOTE_LABELS: Record<AskVoteChoice, string> = {
  no: "No",
  meh: "Meh",
  almost: "Almost",
  love: "♥ Love",
  a: "This look",
  b: "The other",
};

export type LookAskPiece = LookScanPiece;

export type LookAskSharePublic = {
  token: string;
  askerName: string;
  serial: number;
  pollMode: AskPollMode;
  imageUrl: string;
  /** Present when pollMode is compare. */
  altImageUrl: string | null;
  pieces: LookAskPiece[];
  killCount: number | null;
  /** Always present for owners / voters who already voted. */
  shoopRevealed: boolean;
  shoopVote: AskVoteChoice | null;
  shoopVerdict: LookScanVerdict | null;
  myVote: AskVoteChoice | null;
  /** Asker's own strip vote, if cast. */
  ownerVote: AskVoteChoice | null;
  isOwner: boolean;
  votes: Array<{
    choice: AskVoteChoice;
    displayName: string;
    voterKey: string;
    isShoop?: boolean;
    /** True when this row is the look owner (not a friend / Shoop). */
    isOwner?: boolean;
  }>;
  tallies: Record<AskVoteChoice, number>;
  notes: Array<{
    id: string;
    displayName: string;
    body: string;
    createdAt: string;
  }>;
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
};

export function isAskVoteChoice(v: unknown): v is AskVoteChoice {
  return (
    typeof v === "string" &&
    (ASK_VOTE_CHOICES as readonly string[]).includes(v)
  );
}

export function isAskRateChoice(v: unknown): v is AskRateChoice {
  return (
    typeof v === "string" &&
    (ASK_RATE_CHOICES as readonly string[]).includes(v)
  );
}

export function isAskCompareChoice(v: unknown): v is AskCompareChoice {
  return (
    typeof v === "string" &&
    (ASK_COMPARE_CHOICES as readonly string[]).includes(v)
  );
}

export function choicesForPollMode(mode: AskPollMode): readonly AskVoteChoice[] {
  return mode === "compare" ? ASK_COMPARE_CHOICES : ASK_RATE_CHOICES;
}

export function emptyTallies(): Record<AskVoteChoice, number> {
  return { no: 0, meh: 0, almost: 0, love: 0, a: 0, b: 0 };
}
