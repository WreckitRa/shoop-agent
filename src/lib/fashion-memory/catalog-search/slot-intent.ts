import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import { safeTrim } from "../safe-trim";
import { COLOR_WORDS } from "../search-planner/query-rules";
import type { FashionSearchProfile } from "./types";

function relevantNiceToHaves(
  niceToHaves: string[],
  garment: string,
): string[] {
  const garmentTokens = new Set(
    garment.toLowerCase().split(/\s+/).filter(Boolean),
  );
  return niceToHaves.filter((item) => {
    const t = item.toLowerCase();
    if (garmentTokens.size === 0) return true;
    for (const g of garmentTokens) {
      if (t.includes(g)) return true;
    }
    return !/\b(shirt|pant|trouser|jean|shoe|dress|skirt|jacket|blazer|coat|top|sweater)\b/i.test(
      t,
    );
  });
}

function relevantPositiveSignals(
  signals: string[],
  garment: string,
): string[] {
  const garmentLower = garment.toLowerCase();
  return signals.filter((s) => {
    const t = s.toLowerCase();
    if (t.includes(garmentLower)) return true;
    return !/\b(shirt|pant|trouser|jean|shoe|dress|skirt|jacket|blazer|coat|top|sweater|boot|sneaker)\b/i.test(
      t,
    );
  });
}

function stripColorNudge(text: string): string {
  const tokens = text.split(/\s+/).filter((t) => !COLOR_WORDS.has(t.toLowerCase()));
  return tokens.join(" ").replace(/\s+/g, " ").trim();
}

/** Split intent parts into phrase tokens and dedupe case-insensitively. */
export function dedupeIntentParts(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    // Split on commas so overlapping phrases from style + nice_to_haves collapse.
    for (const phrase of trimmed.split(/,\s*/)) {
      const p = phrase.trim().replace(/\s+/g, " ");
      if (!p) continue;
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out.join(", ");
}

/**
 * Soft relevance nudge via catalog.context.intent — never excludes inventory.
 * Parts are deduped case-insensitively to avoid "elegant, elegant" noise.
 */
export function composeSlotIntentString(params: {
  slot: FashionSearchPlanSlot;
  brief: FashionSearchBrief;
  profile: FashionSearchProfile;
  /** Thin-slot reformulation: drop color words from intent. */
  dropColorNudge?: boolean;
}): string {
  const parts: string[] = [];

  if (safeTrim(params.brief.occasion_context)) {
    parts.push(safeTrim(params.brief.occasion_context));
  }

  const style =
    safeTrim(params.slot.style_direction) ||
    safeTrim(params.brief.style_direction);
  if (style) parts.push(style);

  if (safeTrim(params.slot.palette_constraint)) {
    parts.push(safeTrim(params.slot.palette_constraint));
  }

  const nice = relevantNiceToHaves(params.brief.nice_to_haves, params.slot.garment);
  if (nice.length) parts.push(nice.join(", "));

  const signals = relevantPositiveSignals(
    params.profile.positiveSignals,
    params.slot.garment,
  );
  if (signals.length) parts.push(signals.join(", "));

  let intent = dedupeIntentParts(parts);
  if (params.dropColorNudge) {
    intent = stripColorNudge(intent);
  }
  return intent.slice(0, 480);
}
