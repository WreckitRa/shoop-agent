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
