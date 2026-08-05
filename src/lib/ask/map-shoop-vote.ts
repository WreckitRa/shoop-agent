import type { LookScanVerdict } from "@/lib/tryon/look-scan-types";
import type { AskVoteChoice } from "./types";

/**
 * Map Studying Scan verdict → sealed poll choice.
 * Prefer hard no-list fails, then fit/palette caution → almost (WAIT),
 * then title/body love/meh cues; default almost.
 */
export function mapVerdictToShoopVote(verdict: LookScanVerdict): AskVoteChoice {
  const { checks } = verdict;
  if (checks.nolist === "fail") return "no";

  const title = verdict.verdict_title.toLowerCase();
  const body = verdict.verdict_body.toLowerCase();
  const blob = `${title} ${body}`;

  if (
    /\b(no|pass|skip|don'?t|veto|hard no)\b/.test(blob) &&
    !/\blove\b/.test(blob)
  ) {
    if (checks.nolist === "caution" || checks.fit === "fail") return "no";
  }

  const heavyCaution =
    checks.fit === "fail" ||
    checks.palette === "fail" ||
    (checks.fit === "caution" && checks.palette === "caution");

  if (heavyCaution) return "almost";

  if (
    /\b(love|yes|get it|buy|keeper|made for)\b/.test(blob) &&
    checks.fit !== "fail" &&
    checks.nolist !== "caution"
  ) {
    return "love";
  }

  if (/\b(meh|mid|fine|ok(ay)?)\b/.test(blob)) return "meh";

  if (
    /\b(almost|wait|close|fix|size|price)\b/.test(blob) ||
    checks.fit === "caution" ||
    checks.palette === "caution" ||
    checks.nolist === "caution"
  ) {
    return "almost";
  }

  if (checks.fit === "pass" && checks.palette === "pass" && checks.nolist === "pass") {
    return "love";
  }

  return "almost";
}

export function askVoteLabel(choice: AskVoteChoice): string {
  switch (choice) {
    case "no":
      return "No";
    case "meh":
      return "Meh";
    case "almost":
      return "Almost";
    case "love":
      return "♥ Love";
  }
}
