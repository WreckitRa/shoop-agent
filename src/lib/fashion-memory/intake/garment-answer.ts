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
  /\b(bracelet|bracelets|watch|watches|belt|belts|bag|bags|shoes?|sneakers?|boots?|shirts?|blazer|dress(?:es)?|trousers|pants|jeans|jackets?|coats?|hoodie|sweater|hat|tie|scarf|swimsuit|swimsuits|swimwear|bikini|bikinis|t-?shirts?|tee|blouse|overshirt|sandals?|skirt|skirts|polo|chinos?|loafers?)\b/i;

const AR_GARMENT_RE =
  /(جينز|تي\s*شيرت|تيشيرت|فستان|بلوزة|جاكيت|حذاء|صندل|معطف|قميص|بنطلون|بناطيل|حذاء رياضي|شوز|جزمة)/g;

const AR_GARMENT_EN: Record<string, string> = {
  جينز: "jeans",
  تيشيرت: "t-shirt",
  "تي شيرت": "t-shirt",
  فستان: "dress",
  بلوزة: "blouse",
  جاكيت: "jacket",
  حذاء: "shoes",
  صندل: "sandals",
  معطف: "coat",
  قميص: "shirt",
  بنطلون: "trousers",
  بناطيل: "trousers",
  "حذاء رياضي": "sneakers",
  شوز: "shoes",
  جزمة: "boots",
};

const FR_GARMENT_RE =
  /\b(jupe|jupes|blouse|blouses|robe|robes|jean|jeans|baskets?|manteau|manteaux|chaussures?|sandales?|veste|blazer|pantalon|chemisier|chemise|baskets)\b/gi;

const FR_GARMENT_EN: Record<string, string> = {
  jupe: "skirt",
  jupes: "skirt",
  blouse: "blouse",
  blouses: "blouse",
  robe: "dress",
  robes: "dress",
  jean: "jeans",
  jeans: "jeans",
  basket: "sneakers",
  baskets: "sneakers",
  manteau: "coat",
  manteaux: "coat",
  chaussure: "shoes",
  chaussures: "shoes",
  sandale: "sandals",
  sandales: "sandals",
  veste: "jacket",
  blazer: "blazer",
  pantalon: "trousers",
  chemisier: "blouse",
  chemise: "shirt",
};

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
  // Split slash-compound chips ("تيشيرت/قمصان") before token scan
  const slashParts = trimmed
    .split(/[/|]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (slashParts.length > 1) {
    const fromSlash = uniqLower(
      slashParts.flatMap((p) => normalizeGarmentClarificationAnswer(p, quickOptions)),
    );
    if (fromSlash.length) return fromSlash;
  }

  const lower = text.toLowerCase();

  // Scope chips are not garment SKUs — leave garments empty; router owns mode.
  if (
    /^(one piece|a single piece|single piece|full outfit|full look|a few options(?: to rotate)?)$/i.test(
      lower.trim(),
    )
  ) {
    return [];
  }

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
    // Mix without named tokens → generic tray, not invented SKUs.
    if (/\bmix of both\b/.test(lower)) return ["shoes", "accessories"];
  }

  // Free text: leading clause before size digressions, then full message.
  // Always scan apparel + shoes + accessories together — never early-return
  // on shoes alone (that dropped "shirts, trousers, sneakers, overshirt").
  const lead = trimmed.split(/[.!?]/)[0]?.trim() || trimmed;
  const scanGarments = (text: string): string[] =>
    uniqLower([
      ...collectMatches(text, ACCESSORY_TOKEN_RE),
      ...collectMatches(text, SHOE_TOKEN_RE),
      ...(text.match(new RegExp(SIMPLE_GARMENT_RE.source, "gi")) ?? []).map(
        (s) => s.toLowerCase(),
      ),
      ...[...text.matchAll(AR_GARMENT_RE)].map((m) => {
        const rawTok = m[0]!.replace(/\s+/g, " ").trim();
        return (
          AR_GARMENT_EN[rawTok] ??
          AR_GARMENT_EN[rawTok.replace(/\s/g, "")] ??
          rawTok
        );
      }),
      ...[...text.matchAll(FR_GARMENT_RE)].map((m) => {
        const rawTok = m[0]!.toLowerCase();
        return FR_GARMENT_EN[rawTok] ?? rawTok;
      }),
    ]);
  const fromLead = scanGarments(lead);
  if (fromLead.length) return fromLead;
  const fromFull = scanGarments(trimmed);
  if (fromFull.length) return fromFull;

  // "dressy" / baptism dress-code → dress when no other token found
  if (/\bdressy\b/i.test(trimmed) || /\btenue de (soirée|cérémonie)\b/i.test(trimmed)) {
    return ["dress"];
  }

  // Short bare answers ("bracelets", "a watch") — keep as the garment.
  // Reject escape / chat fillers that are not garment labels.
  if (
    lead.length > 0 &&
    lead.length <= 40 &&
    !/\d/.test(lead) &&
    !/\s/.test(lead.trim()) && // single token only
    !/^(just show me|you decide|surprise me|thanks?|ok|okay|sure|yes|no)\b/i.test(
      lead,
    ) &&
    !/\b(show me what you'?ve got|montre[- ]moi)\b/i.test(lead)
  ) {
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
