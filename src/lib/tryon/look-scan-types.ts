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
