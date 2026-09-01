/**
 * Normalize clarification answers for gap:"garment" so subtype chips
 * stick into brief.garments and suppress re-asks.
 *
 * Free-text families come from the taxonomy table (provenance), not a
 * garment-noun regex.
 */

import {
  garmentTokensMentionedInText,
  hasGarmentTaxonomyMapping,
  lookupTaxonomyEntryStrict,
} from "../catalog-search/garment-taxonomy";

const SCOPE_CHIP_RE =
  /^(one piece|a single piece|single piece|full outfit|full look|a few options(?: to rotate)?)$/i;

const NO_SHOES_CHIP_RE = /\bno\s+shoes\b/i;
const MIX_CHIP_RE = /\bmix of both\b/i;
const SHOES_CHIP_RE = /^shoes\b/i;

export function isVagueGarmentLabel(garment: string): boolean {
  const t = garment.trim();
  if (!t) return true;
  if (/^accessories?$/i.test(t)) return false;
  return !lookupTaxonomyEntryStrict(t) && !hasGarmentTaxonomyMapping(t);
}

export function hasConcreteGarmentDirection(garments: string[]): boolean {
  return garments.some((g) => {
    const t = g.trim();
    if (!t) return false;
    if (/^accessories?$/i.test(t)) return true;
    return !isVagueGarmentLabel(t);
  });
}

function uniqLower(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const g = raw.trim().toLowerCase();
    if (!g || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

/**
 * Parse a garment-gap clarification answer into concrete garment labels.
 * Known chip phrases stay exact; free text is taxonomy mention scan.
 */
export function normalizeGarmentClarificationAnswer(
  raw: string,
  quickOptions?: string[],
): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const quick = quickOptions?.find(
    (o) => o.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const text = quick ?? trimmed;
  const slashParts = trimmed
    .split(/[/|]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (slashParts.length > 1) {
    const fromSlash = uniqLower(
      slashParts.flatMap((p) =>
        normalizeGarmentClarificationAnswer(p, quickOptions),
      ),
    );
    if (fromSlash.length) return fromSlash;
  }

  const lower = text.toLowerCase();

  if (SCOPE_CHIP_RE.test(lower.trim())) return [];

  if (NO_SHOES_CHIP_RE.test(lower)) {
    const accessories = uniqLower(garmentTokensMentionedInText(text)).filter(
      (t) => !/^shoes?$/.test(t) && !/^sneaker/.test(t),
    );
    if (accessories.length) return accessories;
  }

  if (SHOES_CHIP_RE.test(lower) || MIX_CHIP_RE.test(lower)) {
    const mixed = uniqLower(garmentTokensMentionedInText(text));
    if (mixed.length) return mixed;
    if (SHOES_CHIP_RE.test(lower)) return ["shoes"];
    if (MIX_CHIP_RE.test(lower)) return ["shoes", "accessories"];
  }

  const lead = trimmed.split(/[.!?]/)[0]?.trim() || trimmed;
  const fromLead = uniqLower(garmentTokensMentionedInText(lead));
  if (fromLead.length) return fromLead;
  const fromFull = uniqLower(garmentTokensMentionedInText(trimmed));
  if (fromFull.length) return fromFull;

  const bare = lead.toLowerCase().replace(/^(a|an|the)\s+/, "");
  if (bare && lookupTaxonomyEntryStrict(bare)) return [bare];

  return [];
}

/** Prefer concrete resolved garments over vague brief placeholders. */
export function mergeResolvedGarmentsIntoBriefGarments(
  existing: string[],
  resolved: string[],
): string[] {
  if (!resolved.length) return existing;
  const placeholder = (g: string) =>
    isVagueGarmentLabel(g) || /^accessories?$/i.test(g.trim());
  if (!existing.length || existing.every(placeholder)) {
    return uniqLower(resolved);
  }
  return uniqLower([
    ...resolved,
    ...existing.filter((g) => !placeholder(g)),
  ]);
}
