import type { PhotoAnalysisPublic } from "./types";

export type PhotoScanPhase =
  | "reading"
  | "review"
  | "writing"
  | "done"
  | "error";

export type VerdictUiFinale = "scan" | "card";

/** Client resume: review waits on the user; writing continues in the background. */
export function photoScanPhase(
  row: PhotoAnalysisPublic | null | undefined,
): PhotoScanPhase {
  if (!row) return "reading";
  if (row.error) return "error";
  if (row.status === "running") return "reading";
  if (row.verdictStatus === "done" && row.verdict) return "done";
  if (row.verdictStatus === "done" && row.verdictError) return "error";
  if (row.verdictStatus === "running" || row.userReview) return "writing";
  if (!row.result?.analysis_status.usable) return "error";
  return "review";
}

/**
 * Scan check stays up until she confirms (or the photo was never taken).
 * A missing analysis row is "still on scan", not a skip.
 */
export function verdictUiFinale(
  row: PhotoAnalysisPublic | null | undefined,
  hasPhoto: boolean,
): VerdictUiFinale {
  if (!hasPhoto) return "card";
  if (!row) return "scan";
  return photoScanPhase(row) === "done" ? "card" : "scan";
}

/** After she has the card, analysis must not yank her back to scan. */
export function pinVerdictFinale(
  current: VerdictUiFinale,
  computed: VerdictUiFinale,
): VerdictUiFinale {
  if (current === "card") return "card";
  return computed;
}
