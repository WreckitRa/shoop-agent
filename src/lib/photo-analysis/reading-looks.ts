/**
 * Turns a stylist verdict into catalog search queries for the reading card.
 * Pure / client-safe — search I/O lives in run-reading-looks.ts.
 */

import type { StylistVerdict } from "./verdict";
import { readingPalette } from "./verdict-reading";

export type ReadingLookKind = "buy" | "look" | "swatch" | "avoid";

export type ReadingLookQuery = {
  key: string;
  kind: ReadingLookKind;
  query: string;
  lookId?: string;
  lookLabel?: string;
  /** Formula piece without the colour prefix — used for a colourless retry. */
  piece?: string;
  /** Never strip colour from the query on miss. */
  keepColor?: boolean;
};

export type ReadingLookProduct = {
  id: string;
  title: string;
  imageUrl: string;
  price: { amount: number; currency: string } | null;
  /** Formula piece used to search — FASHN garment type, not the catalog title. */
  garment?: string;
};

export type ReadingLookItem = ReadingLookQuery & {
  product: ReadingLookProduct | null;
};

const LOOK_COUNT = 5;
const PIECES_PER_LOOK = 4;
const MAX_QUERIES = LOOK_COUNT * PIECES_PER_LOOK;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(asStr).filter(Boolean);
}

function clipQuery(parts: Array<string | null | undefined>, max = 72): string {
  return parts
    .map((p) => (p ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, max);
}

function pieceKey(piece: string): string {
  return piece.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Strip colourway suffixes so two washes of the same shirt count as one. */
export function productTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*[-–|/].*$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

function pushQuery(
  out: ReadingLookQuery[],
  keys: Set<string>,
  q: ReadingLookQuery,
) {
  const query = q.query.trim();
  if (!query || keys.has(q.key)) return;
  keys.add(q.key);
  out.push({ ...q, query });
}

export function wardrobePlanHasBuys(
  verdict: StylistVerdict | null | undefined,
): boolean {
  if (!verdict) return false;
  const plan = asRecord(verdict.wardrobe_plan);
  if (!plan) return false;
  const prios = Array.isArray(plan.shopping_priorities)
    ? plan.shopping_priorities
    : [];
  if (prios.some((raw) => asStr(asRecord(raw)?.item))) return true;
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  return actions.some((raw) => {
    const o = asRecord(raw);
    return asStr(o?.action) === "add" && Boolean(asStr(o?.item_or_category));
  });
}

function buyQueries(verdict: StylistVerdict): ReadingLookQuery[] {
  if (!wardrobePlanHasBuys(verdict)) return [];
  const out: ReadingLookQuery[] = [];
  const keys = new Set<string>();
  const plan = asRecord(verdict.wardrobe_plan);
  const prios = Array.isArray(plan?.shopping_priorities)
    ? plan.shopping_priorities
    : [];
  for (const raw of prios) {
    const o = asRecord(raw);
    if (!o) continue;
    const item = asStr(o.item);
    if (!item) continue;
    pushQuery(out, keys, {
      key: `buy:${item.toLowerCase()}`,
      kind: "buy",
      query: clipQuery([
        asStrArr(o.preferred_colors)[0],
        item,
        asStr(o.specification),
      ]),
    });
  }
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  for (const raw of actions) {
    const o = asRecord(raw);
    if (asStr(o?.action) !== "add") continue;
    const item = asStr(o?.item_or_category);
    if (!item) continue;
    pushQuery(out, keys, {
      key: `buy:${item.toLowerCase()}`,
      kind: "buy",
      query: clipQuery([item]),
    });
  }
  const playbook = Array.isArray(verdict.garment_playbook)
    ? verdict.garment_playbook
    : [];
  for (const raw of playbook) {
    const o = asRecord(raw);
    if (!o || asStr(o.importance) !== "core") continue;
    const category = asStr(o.category);
    const kw = asStrArr(o.shopping_keywords)[0];
    if (!category && !kw) continue;
    pushQuery(out, keys, {
      key: `buy:${(kw || category).toLowerCase()}`,
      kind: "buy",
      query: clipQuery([asStrArr(o.colors)[0], kw || category]),
    });
  }
  return out;
}

function lookQueries(verdict: StylistVerdict): ReadingLookQuery[] {
  const contractLooks = verdict.contract?.looks;
  if (contractLooks?.length) {
    const out: ReadingLookQuery[] = [];
    const keys = new Set<string>();
    contractLooks.slice(0, LOOK_COUNT).forEach((look, i) => {
      let slot = 0;
      for (const piece of look.pieces) {
        if (slot >= PIECES_PER_LOOK) break;
        const pieceText = [piece.shade, piece.garment_type, ...piece.must_have]
          .filter(Boolean)
          .join(" ");
        pushQuery(out, keys, {
          key: `look:${i}:${slot}`,
          kind: "look",
          lookId: `look-${i}`,
          lookLabel: look.name,
          query: clipQuery([pieceText]),
          piece: pieceText,
          keepColor: true,
        });
        slot += 1;
      }
    });
    return out;
  }
  const out: ReadingLookQuery[] = [];
  const keys = new Set<string>();
  const formulas = Array.isArray(verdict.outfit_formulas)
    ? verdict.outfit_formulas
    : [];
  formulas.slice(0, LOOK_COUNT).forEach((raw, i) => {
    const o = asRecord(raw);
    if (!o) return;
    const occasion =
      asStr(o.occasion) || asStr(o.name) || `Look ${i + 1}`;
    const color = asStrArr(o.color_options)[0];
    const pieces = [
      ...asStrArr(o.formula).slice(0, 3),
      ...asStrArr(o.footwear).slice(0, 1),
    ];
    const usedPiece = new Set<string>();
    let slot = 0;
    for (const piece of pieces) {
      if (slot >= PIECES_PER_LOOK) break;
      const pk = pieceKey(piece);
      if (!pk || usedPiece.has(pk)) continue;
      usedPiece.add(pk);
      pushQuery(out, keys, {
        key: `look:${i}:${slot}`,
        kind: "look",
        lookId: `look-${i}`,
        lookLabel: occasion,
        query: clipQuery([color, piece]),
        piece,
      });
      slot += 1;
    }
  });
  return out;
}

function catalogColorQuery(name: string): string {
  const n = name.replace(/[_-]+/g, " ").trim();
  if (/neon/i.test(n)) return "neon";
  if (/pastel|icy/i.test(n)) return "light pastel";
  if (/bright\s*white|optic/i.test(n)) return "white";
  if (/chartreuse|yellow[\s-]*green/i.test(n)) return "olive";
  if (/\b(fuchsia|magenta|hot pink)\b/i.test(n)) return "bright pink";
  const stripped = n
    .replace(/\b(colors?|tones?|undertones?|family)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || n;
}

const COLOR_STOP = /^(deep|dark|light|soft|pale|muted|ink|near|the|and)$/;
const PATTERN_NOISE =
  /\b(floral|stripe|striped|plaid|check|checked|print|printed|graphic|camp|paisley|hawaiian|camo|leopard)\b/i;

/** Colour words we can match in a catalog title — drop shade poetry. */
export function colorTokensFromLabel(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !COLOR_STOP.test(w));
}

export function titleMatchesFaceColor(title: string, label: string): boolean {
  const t = title.toLowerCase();
  return colorTokensFromLabel(label).some((tok) => t.includes(tok));
}

const FACE_COLOR_FAMILIES = new Set([
  "black",
  "white",
  "grey",
  "gray",
  "beige",
  "brown",
  "navy",
  "blue",
  "green",
  "olive",
  "red",
  "burgundy",
  "pink",
  "purple",
  "orange",
  "yellow",
  "gold",
  "silver",
  "denim",
  "charcoal",
  "cream",
  "ivory",
]);

function swatchColorTerm(name: string, use: string): string {
  const family = use.replace(/\s+/g, " ").trim().toLowerCase();
  if (FACE_COLOR_FAMILIES.has(family)) return family;
  return catalogColorQuery(name);
}

function faceGarment(use: string): string {
  const u = use.replace(/\s+/g, " ").trim();
  if (!u || u.length > 22 || /\b(the|this|your|keep|off|avoid|never)\b/i.test(u)) {
    return "crew neck";
  }
  if (/\b(neck|tee|polo|crew|knit|collar|shirt|turtleneck)\b/i.test(u)) return u;
  return "crew neck";
}

function faceGarmentQuery(name: string, use: string): string {
  return clipQuery([swatchColorTerm(name, use), faceGarment(use)]);
}

function swatchQueries(verdict: StylistVerdict): ReadingLookQuery[] {
  const { palette, avoid } = readingPalette(verdict);
  const keepColor = Boolean(verdict.contract);
  const out: ReadingLookQuery[] = [];
  const keys = new Set<string>();
  palette.forEach((s, i) => {
    const garment = faceGarment(s.use);
    pushQuery(out, keys, {
      key: `swatch:${i}`,
      kind: "swatch",
      lookId: `swatch-${i}`,
      lookLabel: s.name,
      query: faceGarmentQuery(s.name, s.use),
      piece: garment,
      keepColor,
    });
  });
  avoid.forEach((s, i) => {
    pushQuery(out, keys, {
      key: `avoid:${i}`,
      kind: "avoid",
      lookId: `avoid-${i}`,
      lookLabel: s.name,
      query: clipQuery([catalogColorQuery(s.name), "crew neck"]),
      piece: "crew neck",
      keepColor,
    });
  });
  return out;
}

/** Looks first (full outfits), then leftover buy slots, then face-colour pieces. */
export function readingLookQueries(
  verdict: StylistVerdict | null | undefined,
): ReadingLookQuery[] {
  if (!verdict) return [];
  const looks = lookQueries(verdict);
  const room = Math.max(0, MAX_QUERIES - looks.length);
  const buys = room ? buyQueries(verdict).slice(0, room) : [];
  return [...looks, ...buys, ...swatchQueries(verdict)];
}

export function pickLookProduct(
  candidates: ReadingLookProduct[],
  usedIds: Set<string>,
  usedTitlesInLook: Set<string>,
): ReadingLookProduct | null {
  for (const product of candidates) {
    const titleKey = productTitleKey(product.title);
    if (usedIds.has(product.id)) continue;
    if (titleKey && usedTitlesInLook.has(titleKey)) continue;
    return product;
  }
  return null;
}

/** Face-colour chips: title must say the colour, and not a print. */
export function pickFaceColorProduct(
  candidates: ReadingLookProduct[],
  usedIds: Set<string>,
  colorLabel: string,
): ReadingLookProduct | null {
  let best: { product: ReadingLookProduct; score: number } | null = null;
  for (const product of candidates) {
    if (usedIds.has(product.id)) continue;
    const t = product.title.toLowerCase();
    if (PATTERN_NOISE.test(t)) continue;
    if (!titleMatchesFaceColor(product.title, colorLabel)) continue;
    let score = 0;
    if (/\b(crew|crewneck|tee|t-shirt|tshirt|polo|knit)\b/.test(t)) score += 3;
    if (/\b(sweatshirt|hoodie)\b/.test(t)) score += 1;
    if (/\bshirt\b/.test(t)) score -= 1;
    if (score < 0) continue;
    if (!best || score > best.score) best = { product, score };
  }
  return best?.product ?? null;
}

export function uniqueLookProducts(
  products: ReadingLookProduct[],
): ReadingLookProduct[] {
  const usedIds = new Set<string>();
  const usedTitles = new Set<string>();
  const out: ReadingLookProduct[] = [];
  for (const product of products) {
    const picked = pickLookProduct([product], usedIds, usedTitles);
    if (!picked) continue;
    usedIds.add(picked.id);
    const titleKey = productTitleKey(picked.title);
    if (titleKey) usedTitles.add(titleKey);
    out.push(picked);
  }
  return out;
}

export function productForStep(
  why: string,
  items: ReadingLookItem[],
): ReadingLookProduct | null {
  const hay = why.toLowerCase();
  if (!hay) return null;
  for (const item of items) {
    if (item.kind !== "buy" || !item.product) continue;
    const tokens = item.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 3);
    if (tokens.some((t) => hay.includes(t))) return item.product;
  }
  return null;
}

export function fallbackLookQuery(query: string, piece?: string): string | null {
  const p = (piece ?? "").trim();
  if (!p) return null;
  const q = query.trim();
  if (!q || q.toLowerCase() === p.toLowerCase()) return null;
  return p;
}

/** Face-colour miss: drop the garment and search the colour alone. */
export function fallbackFaceQuery(query: string, piece?: string): string | null {
  const p = (piece ?? "").trim();
  if (!p) return null;
  const q = query.trim();
  if (!q) return null;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const without = q.replace(new RegExp(`\\s*${escaped}\\s*$`, "i"), "").trim();
  if (!without || without.toLowerCase() === q.toLowerCase()) return null;
  return without;
}

export type ReadingLookGroup = {
  id: string;
  label: string;
  formula: string;
  products: ReadingLookProduct[];
};

const MIN_LOOK_PRODUCTS = 1;

export function groupReadingLooks(items: ReadingLookItem[]): {
  looks: ReadingLookGroup[];
  buys: ReadingLookProduct[];
  droppedLookCount: number;
} {
  const groups: ReadingLookGroup[] = [];
  const byId = new Map<string, ReadingLookGroup>();
  const piecesByLook = new Map<string, string[]>();
  for (const item of items) {
    if (item.kind !== "look" || !item.lookId) continue;
    let group = byId.get(item.lookId);
    if (!group) {
      group = {
        id: item.lookId,
        label: item.lookLabel || "A look",
        formula: "",
        products: [],
      };
      byId.set(item.lookId, group);
      groups.push(group);
    }
    if (item.product) group.products.push(item.product);
    const piece = item.piece?.trim() || item.product?.garment?.trim();
    if (piece) {
      const list = piecesByLook.get(item.lookId) ?? [];
      list.push(piece);
      piecesByLook.set(item.lookId, list);
    }
  }
  for (const group of groups) {
    group.products = uniqueLookProducts(group.products);
    const pieces = [...new Set(piecesByLook.get(group.id) ?? [])];
    group.formula = pieces.join(" · ");
  }
  const kept = groups;
  const buys = uniqueLookProducts(
    items
      .filter((item) => item.kind === "buy" && item.product)
      .map((item) => item.product!),
  );
  return {
    looks: kept,
    buys,
    droppedLookCount: groups.filter((g) => g.products.length < MIN_LOOK_PRODUCTS)
      .length,
  };
}
