/** Ask the Girls — shared types (client + server safe). */

import type { LookScanPiece, LookScanVerdict } from "@/lib/tryon/look-scan-types";

export const ASK_VOTE_CHOICES = ["no", "meh", "almost", "love"] as const;
export type AskVoteChoice = (typeof ASK_VOTE_CHOICES)[number];

export const ASK_VOTE_LABELS: Record<AskVoteChoice, string> = {
  no: "No",
  meh: "Meh",
  almost: "Almost",
  love: "♥ Love",
};

export type LookAskPiece = LookScanPiece;

export type LookAskSharePublic = {
  token: string;
  askerName: string;
  serial: number;
  imageUrl: string;
  pieces: LookAskPiece[];
  killCount: number | null;
  /** Always present for owners / voters who already voted. */
  shoopRevealed: boolean;
  shoopVote: AskVoteChoice | null;
  shoopVerdict: LookScanVerdict | null;
  myVote: AskVoteChoice | null;
  isOwner: boolean;
  votes: Array<{
    choice: AskVoteChoice;
    displayName: string;
    voterKey: string;
    isShoop?: boolean;
  }>;
  tallies: Record<AskVoteChoice, number>;
  notes: Array<{
    id: string;
    displayName: string;
    body: string;
    createdAt: string;
  }>;
  createdAt: string;
};

export function isAskVoteChoice(v: unknown): v is AskVoteChoice {
  return (
    typeof v === "string" &&
    (ASK_VOTE_CHOICES as readonly string[]).includes(v)
  );
}
