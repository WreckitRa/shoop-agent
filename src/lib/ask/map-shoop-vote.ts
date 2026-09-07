import type { LookScanVerdict } from "@/lib/tryon/look-scan-types";
import type { AskCompareChoice, AskRateChoice, AskVoteChoice } from "./types";
import { isAskRateChoice } from "./types";

const LOVE_RE =
  /\b(love|yes|get it|buy(?:\s+it)?|keeper|made for|worth it|take (?:it|this) home|pull the trigger|lock it in|keep it|do it|grab (?:it|this)|yes please)\b/;
const MEH_RE =
  /\b(meh|mid|shrug|forgettable|nothing special|not special|underwhelming|whatever)\b/;
const NO_RE =
  /\b(hard (?:no|pass)|veto|skip (?:it|this)|don'?t buy|do not buy|walk away|not for you)\b/;
const ALMOST_RE =
  /\b(almost|wait|close|fix|size|hem|alter|swap|tweak)\b/;

/**
 * Map Studying Scan verdict → sealed rate-poll choice.
 * Prefer an explicit LLM `vote` when present; otherwise infer from title/body
 * with buy/love language winning over soft words like "fine"/"ok".
 */
export function mapVerdictToShoopVote(verdict: LookScanVerdict): AskRateChoice {
  if (verdict.vote && isAskRateChoice(verdict.vote)) {
    return verdict.vote;
  }

  const { checks } = verdict;
  if (checks.nolist === "fail") return "no";

  const title = verdict.verdict_title.toLowerCase();
  const body = verdict.verdict_body.toLowerCase();
  const blob = `${title} ${body}`;

  const titleLove = LOVE_RE.test(title);
  const blobLove = LOVE_RE.test(blob);
  const blobNo = NO_RE.test(blob);
  const blobMeh = MEH_RE.test(blob);
  const blobAlmost = ALMOST_RE.test(blob);

  if (blobNo && !titleLove) {
    if (checks.nolist === "caution" || checks.fit === "fail") {
      return "no";
    }
  }

  if ((titleLove || blobLove) && checks.fit !== "fail") {
    if (
      checks.fit === "caution" ||
      checks.palette === "caution" ||
      checks.nolist === "caution"
    ) {
      return titleLove ? "love" : "almost";
    }
    return "love";
  }

  const heavyCaution =
    checks.fit === "fail" ||
    checks.palette === "fail" ||
    (checks.fit === "caution" && checks.palette === "caution");

  if (heavyCaution) return "almost";

  if (blobMeh && !blobLove) return "meh";

  if (
    blobAlmost ||
    checks.fit === "caution" ||
    checks.palette === "caution" ||
    checks.nolist === "caution"
  ) {
    return "almost";
  }

  if (
    checks.fit === "pass" &&
    checks.palette === "pass" &&
    checks.nolist === "pass"
  ) {
    return "love";
  }

  return "almost";
}

/** Comparative: Shoop picks this look (a) when the verdict leans buy; else b. */
export function mapVerdictToCompareVote(
  verdict: LookScanVerdict,
): AskCompareChoice {
  const rate = mapVerdictToShoopVote(verdict);
  return rate === "love" || rate === "almost" ? "a" : "b";
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
    case "a":
      return "Look 1";
    case "b":
      return "Look 2";
    case "c":
      return "Look 3";
    case "d":
      return "Look 4";
    case "e":
      return "Look 5";
  }
}
