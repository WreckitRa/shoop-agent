/**
 * Normalize clarification answers for gap:"garment" so subtype chips
 * (bracelets, watches/belts/bags, shoes, …) stick into brief.garments
 * and suppress re-asks.
 */

const VAGUE_GARMENT_RE =
  /^(accessories?|something|clothes?|clothing|outfit|pieces?|items?|stuff)$/i;

/** Accessory / jewelry tokens that never need a clothing size bucket. */
const ACCESSORY_TOKEN_RE =
  /\b(bracelet|bracelets|watch|watches|belt|belts|bag|bags|handbag|handbags|tote|totes|wallet|wallets|tie|ties|scarf|scarves|hat|hats|cap|caps|jewelry|jewellery|necklace|necklaces|ring|rings|earring|earrings|cufflink|cufflinks|sunglasses|specs|glasses)\b/gi;

const SHOE_TOKEN_RE =
  /\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|sandal|sandals|trainer|trainers|heel|heels)\b/gi;

/** Common free-text singles worth keeping even when not in the accessory list. */
const SIMPLE_GARMENT_RE =
  /\b(bracelet|bracelets|watch|watches|belt|belts|bag|bags|shoes?|sneakers?|boots?|shirt|blazer|dress|trousers|pants|jeans|jacket|coat|hoodie|sweater|hat|tie|scarf)\b/i;

export function isVagueGarmentLabel(garment: string): boolean {
  return VAGUE_GARMENT_RE.test(garment.trim());
}

export function hasConcreteGarmentDirection(garments: string[]): boolean {
  return garments.some((g) => {
    const t = g.trim();
    if (!t) return false;
    // Generic accessories is a valid brief token — planner decomposes the tray.
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

function collectMatches(text: string, re: RegExp): string[] {
  const out: string[] = [];
  const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(copy)) {
    if (m[1]) out.push(m[1]);
    else if (m[0]) out.push(m[0]);
  }
  return out;
}

/**
 * Parse a garment-gap clarification answer into concrete garment labels.
 * Handles chip labels and free-text like "bracelets. … shoe size … 11–12".
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
  const lower = text.toLowerCase();

  // Chip: "Watches, belts, bags, bracelets — no shoes"
  if (/\bno\s+shoes\b/.test(lower)) {
    const accessories = uniqLower(collectMatches(text, ACCESSORY_TOKEN_RE));
    if (accessories.length) return accessories;
  }

  // Chip: "Shoes (and other accessories)" / "Mix of both"
  if (/^shoes\b/.test(lower) || /\bmix of both\b/.test(lower)) {
    const shoes = uniqLower(collectMatches(text, SHOE_TOKEN_RE));
    const accessories = uniqLower(collectMatches(text, ACCESSORY_TOKEN_RE));
    const mixed = uniqLower([...shoes, ...accessories]);
    if (mixed.length) return mixed;
    if (/^shoes\b/.test(lower)) return ["shoes"];
    if (/\bmix of both\b/.test(lower)) {
      return ["shoes", "watch", "belt", "bag", "bracelet"];
    }
  }

  // Free text / partial chip: take the leading clause before size digressions.
  const lead = trimmed.split(/[.!?]/)[0]?.trim() || trimmed;
  const fromLead = uniqLower([
    ...collectMatches(lead, ACCESSORY_TOKEN_RE),
    ...collectMatches(lead, SHOE_TOKEN_RE),
  ]);
  if (fromLead.length) return fromLead;

  const simple = lead.match(SIMPLE_GARMENT_RE)?.[0];
  if (simple) return [simple.toLowerCase()];

  // Short bare answers ("bracelets", "a watch") — keep as the garment.
  if (lead.length > 0 && lead.length <= 40 && !/\d/.test(lead)) {
    return [lead.toLowerCase().replace(/^(a|an|the)\s+/, "")];
  }

  return [];
}

/** Prefer concrete resolved garments over vague brief placeholders. */
export function mergeResolvedGarmentsIntoBriefGarments(
  existing: string[],
  resolved: string[],
): string[] {
  if (!resolved.length) return existing;
  if (!existing.length || existing.every(isVagueGarmentLabel)) {
    return uniqLower(resolved);
  }
  return uniqLower([...resolved, ...existing.filter((g) => !isVagueGarmentLabel(g))]);
}
