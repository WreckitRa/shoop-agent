/**
 * Server gate: gift searches require a chosen direction before catalog fan-out.
 */
import {
  isValidCatalogQuery,
  sanitizeQueryText,
} from "./query-hygiene";
import type { SearchBrief } from "./types";
import { isGiftArchetype } from "./portfolio";

/** True when this gift brief must show direction chips before searching. */
export function giftSearchNeedsDirectionPicker(brief: SearchBrief): boolean {
  if (!isGiftArchetype(brief)) return false;
  return !brief.directionLabel?.trim();
}

/**
 * Whether a directed-gift tool query is sanitized enough for catalog retrieval.
 * Used by tests and query hygiene checks — all searches go through the engine.
 */
export function giftDirectedAllowsLegacyCatalogSearch(
  brief: SearchBrief,
  rawQuery: string,
): boolean {
  if (brief.archetype !== "gift_directed") return false;
  if (!brief.directionLabel?.trim()) return false;
  const sanitized = sanitizeQueryText(rawQuery, brief);
  return sanitized.length >= 3 && isValidCatalogQuery(sanitized);
}

/** Minimal anchor so direction chips are meaningful (not totally blind). */
export function giftHasRecipientAnchor(brief: SearchBrief): boolean {
  if (brief.recipient.knownInterests?.length) return true;
  if (brief.useCase?.trim()) return true;
  if (brief.mustHaves.length) return true;
  if (brief.category?.trim()) return true;
  if (brief.recipient.label?.trim()) return true;
  return false;
}

/**
 * After the buyer picks direction chips, the model often puts the label in
 * `query` instead of `direction_label`. Treat non-catalog phrases as the lane.
 */
export function inferGiftDirectionLabelFromQuery(
  brief: SearchBrief,
  rawQuery: string,
): SearchBrief {
  if (brief.directionLabel?.trim()) return brief;
  if (!isGiftArchetype(brief)) return brief;
  const label = rawQuery.trim();
  if (label.length < 3 || label.length > 80) return brief;
  const cleaned = sanitizeQueryText(label, brief);
  if (isValidCatalogQuery(cleaned) && !label.includes("&")) return brief;
  return {
    ...brief,
    directionLabel: label,
    archetype: "gift_directed",
  };
}
