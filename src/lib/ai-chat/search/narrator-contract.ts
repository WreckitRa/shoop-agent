/**
 * Verdict-first narration contract — the chat model's job after search completes.
 * Shoop takes positions; it does not present options and ask the user to narrow.
 */
import type { ConstraintGateDrop } from "./constraint-gate";
import type { SearchBrief } from "./types";
import type { CuratedPick } from "../types";

export type CurationKillStats = {
  pooled: number;
  rejected: number;
  survived: number;
  rejection_by_gate: Record<string, number>;
};

export function summarizeRejectionsByGate(
  ruledOut: ConstraintGateDrop[] | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of ruledOut ?? []) {
    out[d.gate] = (out[d.gate] ?? 0) + 1;
  }
  return out;
}

export function buildKillStats(params: {
  pooled: number;
  ruledOut?: ConstraintGateDrop[];
  survived: number;
}): CurationKillStats {
  const rejected = params.ruledOut?.length ?? Math.max(0, params.pooled - params.survived);
  return {
    pooled: params.pooled,
    rejected,
    survived: params.survived,
    rejection_by_gate: summarizeRejectionsByGate(params.ruledOut),
  };
}

export function gateReasonsForNarration(
  ruledOut: ConstraintGateDrop[] | undefined,
  limit = 4,
): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const listingDrops = (ruledOut ?? []).filter((d) => d.gate === "listing_hygiene");
  if (listingDrops.length) {
    lines.push(
      `listing_hygiene: skipped ${listingDrops.length} clearance/junk listing${listingDrops.length === 1 ? "" : "s"} (SKU titles, single-size clearance, price anomalies)`,
    );
    seen.add(lines[0]!);
  }
  for (const d of ruledOut ?? []) {
    if (d.gate === "listing_hygiene") continue;
    const line = `${d.gate}: ${d.reason}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= limit) break;
  }
  return lines;
}

export function heroPlacement(picks: CuratedPick[]): CuratedPick | undefined {
  return (
    picks.find((p) => p.slot === "shoop_pick" && p.verdict === "buy") ??
    picks.find((p) => p.slot === "shoop_pick") ??
    picks.find((p) => p.verdict === "buy") ??
    picks[0]
  );
}

/** Best alternate for runner-up paragraph — not the hero. */
export function runnerUpPlacement(
  picks: CuratedPick[],
  hero?: CuratedPick,
): CuratedPick | undefined {
  const rest = picks.filter((p) => p.id !== hero?.id);
  return (
    rest.find((p) => p.verdict === "buy" || p.verdict === "wait") ??
    rest.find((p) => p.slot === "best_value") ??
    rest.find((p) => p.slot === "most_popular") ??
    rest[1]
  );
}

export const NARRATOR_VERDICT_FIRST_CONTRACT = `SHOOP NARRATION CONTRACT (mandatory after search — hard format, in order):

1. CLIENT READ (one short paragraph)
   Resolve the request against THIS buyer's profile — not generic "work" or "professional."
   Example: "work" for a club DJ = booth and stage hours, not a boardroom; "work" for finance = client meetings, not nightlife.
   State who you're shopping for and what lane the rack serves. No product names yet.

2. THE CALL (exactly ONE primary pick)
   Lead with **Buy**, **Wait**, or **Don't** on ONE product from placements / hero_product_id.
   The why must reference the buyer's life (job, fit, profile, occasion resolution) — features support the call; they are not the call.
   Courage required: pick one; do not hedge with "either could work."

3. RUNNER-UP (one alternate + tradeoff)
   Name ONE runner-up from placements with its verdict and the explicit tradeoff vs your primary
   ("Wait on X unless… — I picked Y because [user-referenced reason]").

4. KILL COUNT + RULED-OUTS
   State curation_stats exactly: "I looked at {pooled} and rejected {rejected}…"
   Then 2–4 grouped reasons pulled ONLY from rejection_summary and ruled_out — real judge/gate drops
   (wrong color, women's cuts, self-check failures, judge omissions, clearance/junk listings). Never invent kill reasons.

5. ESCAPE HATCH (one sentence, AFTER the verdict — not a question)
   Decide from the profile by default, then offer one out: "Went slim because that's your fit — say the word if you want relaxed this time."
   NO closing preference questions ("want A or B?", "prefer slim or structured?") — those abdicate the opinion.

6. AUTHORITATIVE RACK
   Speak ONLY from placements / allowed_product_ids. Never resurrect ruled_out products as recommendations.
   UI renders cards — do not name slot labels (Best Value, Shoop's Pick). Verdict + title is enough.`;

export const NARRATOR_GOLD_EXEMPLARS = `GOLD EXEMPLARS — match this voice, structure, and courage (do not copy product names verbatim):

--- EXEMPLAR A: Resolve "work" against profile (DJ, not boardroom) ---
You asked for a black blazer for work — but your profile says you're a club DJ four nights a week, not in a boardroom. That changes the rack: structured wool that reads corporate is the wrong lane; you need black that moves, survives four hours on your feet, and still reads sharp under stage lights.

**Buy** the Black Stretch Performance Blazer — it's the call because it clears your size and won the head-to-head against the wool-blend on recovery after long sets. The wool looks cleaner on paper but you'll fight the shoulders by hour three.

**Wait** on the slim wool-blend unless you're also shopping interview season — same color, sharper drape, built for standing meetings not booth work.

I looked at 131 options and rejected 126 — women's cuts like VERITY, beige when you need black, and pieces that flattered the catalog but not your lane.

Went performance over dress-wool because your work is the booth — say the word if you're actually shopping boardroom instead.

--- EXEMPLAR B: Black men's work blazer (profile-led, real kill count) ---
You want black for work, and your profile is tailored-but-not-stuffy — slim through the shoulder, not club slim. "Work" here means client meetings and events, not courtroom formal.

**Buy** the Men's Black Wool Blend Tailored Blazer — it's the call because it clears black, men's cut, and your M with structure that reads office without costume. It beat the navy stripe in head-to-head because you said black and mean it.

**Wait** on the structured navy stripe unless you're loosening to navy — sharper pattern, same silhouette, but it breaks your black-only brief.

I looked at 131 and rejected 126: women's VERITY blazers, beige Bar III, navy stripes masquerading as black, and judge drops that violated your stated color and gender scope.

Went structured wool over knits because that's your work lane — tell me if you're actually shopping nightlife and I'll widen the rack.`;

export function buildNarratorInstructions(params: {
  brief: SearchBrief;
  killStats: CurationKillStats;
  hero?: CuratedPick;
  runnerUp?: CuratedPick;
  rejectionLines: string[];
  expertisePrinciples: string[];
}): string {
  const parts = [
    NARRATOR_VERDICT_FIRST_CONTRACT,
    "",
    NARRATOR_GOLD_EXEMPLARS,
  ];

  if (params.brief.provenance?.occasionResolution) {
    parts.push(
      "",
      `Occasion resolution (use in CLIENT READ): ${params.brief.provenance.occasionResolution}`,
    );
  }
  if (params.expertisePrinciples.length) {
    parts.push(
      "",
      "Expertise principles (use in CLIENT READ — not as filler):",
      ...params.expertisePrinciples.map((p) => `- ${p}`),
    );
  }

  parts.push(
    "",
    `Kill stats (use verbatim in paragraph 4): looked at ${params.killStats.pooled}, rejected ${params.killStats.rejected}, ${params.killStats.survived} on the rack.`,
  );

  if (params.hero) {
    parts.push(
      "",
      `Primary call (paragraph 2): "${params.hero.title}" — verdict: ${params.hero.verdict.toUpperCase()}. Engine reason: ${params.hero.reason}`,
    );
  }
  if (params.runnerUp) {
    parts.push(
      `Runner-up (paragraph 3): "${params.runnerUp.title}" — verdict: ${params.runnerUp.verdict.toUpperCase()}. Engine reason: ${params.runnerUp.reason}`,
    );
  }
  if (params.rejectionLines.length) {
    parts.push(
      "",
      "Rejection summary (paragraph 4 — cite these, do not invent):",
      ...params.rejectionLines.map((l) => `- ${l}`),
    );
  }

  return parts.join("\n");
}
