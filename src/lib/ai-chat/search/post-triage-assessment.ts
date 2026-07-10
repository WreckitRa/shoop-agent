/**
 * Post–wide-triage pool assessment — decides whether one agentic refill wave is worth it.
 */
import type { TriageVerdict } from "../judgment/tier-judge";
import { anchorBrandsForQuery, isAnchorBrandProduct } from "./brand-anchors";
import type { ConstraintGateDrop } from "./constraint-gate";
import type { SearchBrief } from "./types";
import type { VerifiedCandidate } from "./verify";

export type PostTriageAssessment = {
  /** Human-readable one-liner for narration SSE. */
  summary: string;
  advanceCount: number;
  verifiedCount: number;
  anchorCount: number;
  constraintDropCount: number;
  needsRetry: boolean;
  reasons: string[];
  /** Drop notes from triage — fed to the retry query planner. */
  triageDropNotes: string[];
};

const MIN_ADVANCES = 5;
const MIN_VERIFIED = 6;

export function assessPostTriagePool(params: {
  verified: VerifiedCandidate[];
  triage: TriageVerdict[];
  preJudgeDrops: ConstraintGateDrop[];
  brief: SearchBrief;
}): PostTriageAssessment {
  const { verified, triage, preJudgeDrops, brief } = params;
  const advances = triage.filter((t) => t.verdict === "advance");
  const advanceIds = new Set(advances.map((a) => a.productId));
  const expectedAnchors = anchorBrandsForQuery(brief.query, brief.category);

  const anchorCount = verified.filter(
    (v) =>
      advanceIds.has(v.detail.id) &&
      isAnchorBrandProduct(v.product, brief.query, brief.category),
  ).length;

  const constraintDropCount = preJudgeDrops.length;
  const triageDropNotes = triage
    .filter((t) => t.verdict === "drop")
    .map((t) => t.note.trim())
    .filter(Boolean)
    .slice(0, 8);

  const reasons: string[] = [];
  if (advances.length < MIN_ADVANCES) reasons.push("thin_advances");
  if (verified.length < MIN_VERIFIED) reasons.push("thin_verified");
  if (expectedAnchors.length > 0 && anchorCount === 0) reasons.push("no_anchors");
  if (constraintDropCount >= 2) reasons.push("constraint_violations");

  const needsRetry =
    reasons.includes("thin_advances") ||
    reasons.includes("thin_verified") ||
    (reasons.includes("no_anchors") && advances.length < MIN_ADVANCES + 2) ||
    (reasons.includes("constraint_violations") && verified.length < MIN_VERIFIED + 2);

  const anchorPhrase =
    expectedAnchors.length > 0
      ? anchorCount === 0
        ? "no anchors"
        : `${anchorCount} anchor${anchorCount === 1 ? "" : "s"}`
      : "anchors n/a";

  const violationPhrase =
    constraintDropCount === 0
      ? "no constraint violations"
      : `${constraintDropCount} constraint violation${constraintDropCount === 1 ? "" : "s"}`;

  const summary = `${verified.length} valid candidate${verified.length === 1 ? "" : "s"}, ${anchorPhrase}, ${violationPhrase}`;

  return {
    summary,
    advanceCount: advances.length,
    verifiedCount: verified.length,
    anchorCount,
    constraintDropCount,
    needsRetry,
    reasons,
    triageDropNotes,
  };
}
