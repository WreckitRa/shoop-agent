/** Client-safe types + helpers for the Studying Scan UI. */

export type LookScanPiece = {
  title: string;
  priceLabel?: string;
  garment?: string;
};

/** What Shoop is judging in this scan. */
export type LookScanMode = "single_item" | "outfit";

export type LookScanVerdict = {
  verdict_title: string;
  verdict_body: string;
  annotations: [string, string, string, string];
  whispers: [string, string, string, string];
  checks: {
    fit: "pass" | "caution" | "fail";
    palette: "pass" | "caution" | "fail";
    nolist: "pass" | "caution" | "fail";
  };
  /**
   * Shoop's sealed poll choice for Ask-your-friends.
   * Optional for older payloads; mapper infers when missing.
   */
  vote?: "no" | "meh" | "almost" | "love";
};

/** Derive scan mode from pieces on the twin (client or server). */
export function resolveLookScanMode(
  pieces: LookScanPiece[],
  explicit?: LookScanMode | null,
): LookScanMode {
  if (explicit === "single_item" || explicit === "outfit") return explicit;
  return pieces.length <= 1 ? "single_item" : "outfit";
}

/** Convert **bold** markers to safe HTML <b> for the whisper/verdict UI. */
export function formatScanEmphasis(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

export type PreviewScanNote = {
  dim: "fit" | "color" | "set" | "price";
  name: string;
  text: string;
};

export const PREVIEW_SCAN_DIM_LABEL: Record<PreviewScanNote["dim"], string> = {
  fit: "Fit",
  color: "Color",
  set: "Set",
  price: "Price",
};

export function shortPieceName(title: string): string {
  const cut = title.replace(/\s*[|·].*$/, "").trim();
  return cut || title;
}

/** Honest bake-time copy from what's on the twin — process, not a fake verdict. */
export function previewScanWhispers(
  pieces: LookScanPiece[],
): [string, string, string, string] {
  const first = pieces[0] ? shortPieceName(pieces[0].title) : null;
  return [
    "checking the inseam against your height...",
    first
      ? `holding ${first.toLowerCase()} against your palette...`
      : "holding the cloth against your palette...",
    "reading the drape on your shoulders...",
    "almost... steaming the mirror",
  ];
}

export function previewScanNotes(pieces: LookScanPiece[]): {
  likes: PreviewScanNote[];
  gripes: PreviewScanNote[];
} {
  const likes: PreviewScanNote[] = [];
  const gripes: PreviewScanNote[] = [];

  for (const [i, piece] of pieces.entries()) {
    const name = shortPieceName(piece.title);
    if (i % 2 === 0) {
      likes.push({
        dim: "fit",
        name,
        text: "checking the drape on you...",
      });
    } else {
      gripes.push({
        dim: "color",
        name,
        text: "holding it against your palette...",
      });
    }
  }

  if (pieces.length >= 2) {
    likes.push({
      dim: "set",
      name: "Together",
      text: "reading how the pieces sit as a set...",
    });
  }

  const priced = pieces.find((p) => p.priceLabel);
  if (priced && gripes.length < 2) {
    gripes.push({
      dim: "price",
      name: shortPieceName(priced.title),
      text: `checking ${priced.priceLabel} against your budget...`,
    });
  }

  return { likes: likes.slice(0, 3), gripes: gripes.slice(0, 2) };
}

export type LookScanCheckKey = keyof LookScanVerdict["checks"];
export type LookScanCheckTone = LookScanVerdict["checks"][LookScanCheckKey];

const CHECK_SCORE: Record<LookScanCheckTone, number> = {
  pass: 9.2,
  caution: 6.4,
  fail: 3.8,
};

const CHECK_WEIGHT: Record<LookScanCheckKey, number> = {
  fit: 0.4,
  palette: 0.35,
  nolist: 0.25,
};

const CHECK_LABEL: Record<LookScanCheckKey, string> = {
  fit: "FIT",
  palette: "COLOUR",
  nolist: "NO-LIST",
};

const CHECK_RANK: Record<LookScanCheckTone, number> = {
  fail: 0,
  caution: 1,
  pass: 2,
};

/** Weighted /10 from the three existing look-scan checks. */
export function scoreFromLookScanChecks(
  checks: LookScanVerdict["checks"],
): number {
  const raw =
    CHECK_SCORE[checks.fit] * CHECK_WEIGHT.fit +
    CHECK_SCORE[checks.palette] * CHECK_WEIGHT.palette +
    CHECK_SCORE[checks.nolist] * CHECK_WEIGHT.nolist;
  return Math.round(raw * 10) / 10;
}

export function weakestLookScanCheck(
  checks: LookScanVerdict["checks"],
): LookScanCheckKey {
  const keys: LookScanCheckKey[] = ["palette", "fit", "nolist"];
  return keys.reduce((worst, key) =>
    CHECK_RANK[checks[key]] < CHECK_RANK[checks[worst]] ? key : worst,
  );
}

/** Chip copy when one check is clearly the problem. */
export function lookScanWeaknessChip(
  checks: LookScanVerdict["checks"],
): string | null {
  const weak = weakestLookScanCheck(checks);
  if (checks[weak] === "pass") return null;
  const others: LookScanCheckKey[] = (["fit", "palette", "nolist"] as const).filter(
    (k) => k !== weak,
  );
  const only = others.every((k) => checks[k] === "pass");
  if (only) {
    if (weak === "palette") return "COLOUR IS THE ONLY THING WRONG";
    if (weak === "fit") return "FIT IS THE ONLY THING WRONG";
    return "NO-LIST IS THE ONLY FLAG";
  }
  if (checks[weak] === "fail") return `${CHECK_LABEL[weak]} NEEDS A FIX`;
  return `${CHECK_LABEL[weak]} IS THE WEAK SPOT`;
}

export type LookScanDimRow = {
  key: LookScanCheckKey;
  label: string;
  score: number;
  tone: LookScanCheckTone;
  why: string;
};

/** Three dim rows for the readout — score from check tone, why from body sentences. */
export function lookScanDimRows(verdict: LookScanVerdict): LookScanDimRow[] {
  const sentences = verdict.verdict_body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const order: LookScanCheckKey[] = ["fit", "palette", "nolist"];
  return order.map((key, i) => ({
    key,
    label: CHECK_LABEL[key],
    score: CHECK_SCORE[verdict.checks[key]],
    tone: verdict.checks[key],
    why:
      sentences[i] ||
      sentences[0] ||
      verdict.verdict_title,
  }));
}
