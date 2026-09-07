/** Ask your friends — shared types (client + server safe). */

import type { LookScanPiece, LookScanVerdict } from "@/lib/tryon/look-scan-types";

/** Isolation rating (legacy / single-look fallback). */
export const ASK_RATE_CHOICES = ["no", "meh", "almost", "love"] as const;
export type AskRateChoice = (typeof ASK_RATE_CHOICES)[number];

/** Comparative: pick among shared looks (Look 1…Look 5). */
export const ASK_COMPARE_CHOICES = ["a", "b", "c", "d", "e"] as const;
export type AskCompareChoice = (typeof ASK_COMPARE_CHOICES)[number];
export const MAX_ASK_LOOKS = ASK_COMPARE_CHOICES.length;

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
  a: "Look 1",
  b: "Look 2",
  c: "Look 3",
  d: "Look 4",
  e: "Look 5",
};

const GENERIC_LOOK_TITLE = new Set([
  "saved look",
  "saved try-on",
  "look",
  "try-on",
]);

export type AskLookTilePublic = {
  imageUrl: string;
  title: string;
  choice: AskCompareChoice;
};

export type AskExtraLookStored = {
  generationId: string | null;
  imageUrl: string;
  title: string;
};

/** Human label for a shared look — garment title when we have one, else Look 1… */
export function askLookLabel(index: number, title?: string | null): string {
  const t = title?.trim();
  if (
    t &&
    !GENERIC_LOOK_TITLE.has(t.toLowerCase()) &&
    !t.includes(":") &&
    !t.includes("|")
  ) {
    return t;
  }
  return `Look ${index + 1}`;
}

export function askCompareChoiceAt(index: number): AskCompareChoice | null {
  return ASK_COMPARE_CHOICES[index] ?? null;
}

export function parseExtraLooks(raw: unknown): AskExtraLookStored[] {
  if (!Array.isArray(raw)) return [];
  const out: AskExtraLookStored[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const imageUrl = typeof rec.imageUrl === "string" ? rec.imageUrl.trim() : "";
    if (!imageUrl) continue;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const generationId =
      typeof rec.generationId === "string" && rec.generationId.trim()
        ? rec.generationId.trim()
        : null;
    out.push({ generationId, imageUrl, title });
    if (out.length >= MAX_ASK_LOOKS - 1) break;
  }
  return out;
}

export type LookAskPiece = LookScanPiece;

export type LookAskSharePublic = {
  token: string;
  askerName: string;
  serial: number;
  pollMode: AskPollMode;
  imageUrl: string;
  /** Present when pollMode is compare (look 2). */
  altImageUrl: string | null;
  /** Shared looks in order (this look first). Length 1 = rate poll. */
  looks: AskLookTilePublic[];
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

export function choicesForPollMode(
  mode: AskPollMode,
  lookCount = 2,
): readonly AskVoteChoice[] {
  if (mode !== "compare") return ASK_RATE_CHOICES;
  const n = Math.min(Math.max(lookCount, 2), ASK_COMPARE_CHOICES.length);
  return ASK_COMPARE_CHOICES.slice(0, n);
}

export function emptyTallies(): Record<AskVoteChoice, number> {
  return {
    no: 0,
    meh: 0,
    almost: 0,
    love: 0,
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
  };
}
