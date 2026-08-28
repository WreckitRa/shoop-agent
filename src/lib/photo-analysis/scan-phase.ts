import type { PhotoAnalysisPublic } from "./types";

export type PhotoScanPhase =
  | "reading"
  | "review"
  | "writing"
  | "done"
  | "error";

/** Client resume: review waits on the user; writing continues in the background. */
export function photoScanPhase(
  row: PhotoAnalysisPublic | null | undefined,
): PhotoScanPhase {
  if (!row || row.status === "running") return "reading";
  if (row.error) return "error";
  if (row.verdictStatus === "done" && row.verdict) return "done";
  if (row.verdictStatus === "done" && row.verdictError) return "error";
  if (row.verdictStatus === "running" || row.userReview) return "writing";
  if (!row.result?.analysis_status.usable) return "error";
  return "review";
}
