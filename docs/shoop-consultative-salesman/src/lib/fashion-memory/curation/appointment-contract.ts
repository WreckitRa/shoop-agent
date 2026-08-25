/**
 * Appointment fields added to the curation deliverable (Stage A) and the
 * voice deliverable (Stage B), plus the code that binds ${DEPTH}/${LOOKS}
 * in the mode sections and validates that assumptions were voiced.
 *
 * Replaces the fixed CURATION_HERO_PICKS / CURATION_LOOKS_TARGET constants
 * as *targets*. They remain as ceilings only.
 */

import type { FashionSearchBrief } from "../router/brief-types";

export const DEPTH_CEILING = 8;

/** The number Stage A owes the client, derived only from the brief. */
export function agreedDepth(brief: FashionSearchBrief): { picks: number; looks: number } {
  const d = brief.depth ?? { source: "assumed" as const };
  const clamp = (n: number | undefined, fallback: number) =>
    Math.max(1, Math.min(DEPTH_CEILING, n ?? fallback));
  switch (brief.request_type) {
    case "outfit":
    case "capsule":
      return { looks: clamp(d.looks_wanted, 3), picks: clamp(d.options_per_item, 3) };
    default:
      return { picks: clamp(d.options_per_item, 3), looks: 1 };
  }
}

/** Bind mode-section placeholders. Call where CURATION_HERO_PICKS was interpolated. */
export function bindModeSection(section: string, brief: FashionSearchBrief): string {
  const { picks, looks } = agreedDepth(brief);
  return section.replaceAll("${DEPTH}", String(picks)).replaceAll("${LOOKS}", String(looks));
}

// ---------- Stage A deliverable additions (deliver_curation tool schema) ----------

export const narrationAppointmentSchema = {
  assumption_lines: {
    type: "array",
    items: { type: "string", maxLength: 160 },
    description:
      "One clause per BRIEF.assumptions entry, in the client's language, correctable in one tap. Same length as BRIEF.assumptions.",
  },
  anchor_line: {
    type: "string",
    maxLength: 160,
    description: 'One clause naming how preference_anchor was honored. Omit when "unspecified".',
  },
  depth_line: {
    type: "string",
    maxLength: 120,
    description: "Say the delivered count back once ('here are your three').",
  },
  next_steps: {
    type: "object",
    properties: {
      text: { type: "string", maxLength: 160 },
      chips: { type: "array", items: { type: "string", maxLength: 32 }, minItems: 2, maxItems: 4 },
    },
    required: ["text", "chips"],
    additionalProperties: false,
  },
} as const;

// ---------- Stage B voice (deliver_curation_voice) additions ----------
// Stage B rewrites assumption_lines / anchor_line / next_steps.text in the
// final voice but may NOT drop any assumption line or change chip count.

export interface VoiceDeliverable {
  opening: string;
  stylist_lines: Record<string, string>;
  assumption_lines: string[];
  anchor_line?: string;
  depth_line?: string;
  next_steps: { text: string; chips: string[] };
}

/**
 * Invariant (composition-invariants.ts): every brief assumption must be
 * voiced. Returns the missing indices; caller repairs by inserting the raw
 * assumption text (it was written to be heard, so verbatim is acceptable).
 */
export function missingAssumptionLines(
  brief: FashionSearchBrief,
  voice: Pick<VoiceDeliverable, "assumption_lines">,
): number[] {
  const want = brief.assumptions ?? [];
  const have = voice.assumption_lines ?? [];
  const missing: number[] = [];
  for (let i = 0; i < want.length; i++) {
    if (!have[i] || have[i].trim().length === 0) missing.push(i);
  }
  return missing;
}

export function repairAssumptionLines(brief: FashionSearchBrief, voice: VoiceDeliverable): VoiceDeliverable {
  const want = brief.assumptions ?? [];
  const lines = [...(voice.assumption_lines ?? [])];
  for (const i of missingAssumptionLines(brief, voice)) lines[i] = want[i];
  return { ...voice, assumption_lines: lines.slice(0, want.length) };
}

/** Deterministic next_steps fallback so the close is never empty. */
export function fallbackNextSteps(brief: FashionSearchBrief, lang = "en"): VoiceDeliverable["next_steps"] {
  const en = {
    text: "Want me to adjust anything?",
    chips: [
      brief.request_type === "single_item" ? "Show me more" : "Two more looks",
      brief.preference_anchor === "explore" ? "Back to my usual" : "Something bolder",
      brief.budget_context?.stated ? "Loosen the budget" : "Tighter budget",
    ],
  };
  return lang === "en" ? en : en; // Stage B normally localizes; fallback stays English-safe.
}
