import { prisma } from "../db";
import { ownedProduct, type OwnedProductRow } from "../owned-product-db";
import type {
  ShoppingMemoryRow,
} from "../prisma-types";
import { SHOPPING_MEMORY_PROMPT_MAX_CHARS } from "../constants";
import { detectShoppingCategoryFromQuery } from "./category-detector";
import { detectShoppingGaps, formatGapProbesXml } from "./gap-detector";
import {
  filterNonemptyRecipients,
  filterStaleIntents,
  hygieneCanonicalMemories,
} from "./memory-hygiene";

const RULES = `<rules>
- Use the structured user profile, sizing, category preferences, brand graph, hard rules, active intents and owned products as ground truth for shopping advice.
- HARD_RULES are absolute — never recommend things on that list. Mention them as "Skipping X because you said you avoid it" if relevant.
- OWNED PRODUCTS (current): don't recommend a duplicate of something the user already owns unless they explicitly want to replace/upgrade. If they ask about an accessory or a complement, factor in their current item (e.g. "case for your iPhone X" → search iPhone X cases specifically).
- OWNED PRODUCTS (former): only mention these when relevant ("you used to have a Sony WH-1000XM4 — interested in the XM5?"). Don't recommend the exact former item back.
- The current user message overrides conflicting stored memory for THIS turn only (e.g. "actually I want chunky sneakers this time" beats the stored dislike).
- Treat uncertain memories (low confidence) as weak signals.
- Do not read aloud the profile blocks unless the user asks what you remember.
- If a question (size, country, budget) is missing for a great recommendation, ASK ONCE inline, naturally, in the same reply.
</rules>`;

function block(label: string, body: string): string {
  const head = body.trim();
  if (!head) return "";
  const max = Math.min(SHOPPING_MEMORY_PROMPT_MAX_CHARS, 9000);
  const slice = head.length > max ? `${head.slice(0, max)}…` : head;
  return `<${label}>\n${slice}\n</${label}>`;
}

function joinIfAny(parts: Array<string | null | undefined>, sep: string): string {
  return parts.filter((p): p is string => Boolean(p?.toString().trim())).join(sep);
}

function formatIdentity(p: {
  preferredName: string | null;
  pronouns: string | null;
  ageRange: string | null;
  genderPresentation: string | null;
  country: string | null;
  city: string | null;
  currency: string | null;
  language: string | null;
  climate: string | null;
  occupation: string | null;
  workEnvironment: string | null;
  lifestyleTags: string[];
  valuePhilosophy: string | null;
  decisionStyle: string | null;
  riskTolerance: string | null;
  shippingCountry: string | null;
  preferredDeliverySpeed: string | null;
} | null): string {
  if (!p) return "";
  const lines: string[] = [];
  const top = joinIfAny([
    p.preferredName ? `Name: ${p.preferredName}` : null,
    p.pronouns ? `Pronouns: ${p.pronouns}` : null,
    p.ageRange ? `Age range: ${p.ageRange}` : null,
    p.genderPresentation ? `Presents as: ${p.genderPresentation}` : null,
  ], " · ");
  if (top) lines.push(top);

  const loc = joinIfAny([
    p.city && p.country ? `Based in ${p.city}, ${p.country}` : p.country ? `Country: ${p.country}` : null,
    p.climate ? `Climate: ${p.climate}` : null,
    p.currency ? `Currency: ${p.currency}` : null,
    p.language ? `Language: ${p.language}` : null,
  ], " · ");
  if (loc) lines.push(loc);

  const lifestyle = joinIfAny([
    p.occupation ? `Occupation: ${p.occupation}` : null,
    p.workEnvironment ? `Work env: ${p.workEnvironment}` : null,
    p.lifestyleTags.length ? `Lifestyle: ${p.lifestyleTags.slice(0, 8).join(", ")}` : null,
  ], " · ");
  if (lifestyle) lines.push(lifestyle);

  const philosophy = joinIfAny([
    p.valuePhilosophy ? `Value: ${p.valuePhilosophy}` : null,
    p.decisionStyle ? `Decision: ${p.decisionStyle}` : null,
    p.riskTolerance ? `Risk: ${p.riskTolerance}` : null,
  ], " · ");
  if (philosophy) lines.push(philosophy);

  const ship = joinIfAny([
    p.shippingCountry ? `Ships to: ${p.shippingCountry}` : null,
    p.preferredDeliverySpeed ? `Delivery pref: ${p.preferredDeliverySpeed}` : null,
  ], " · ");
  if (ship) lines.push(ship);

  return lines.join("\n");
}

function formatSizing(s: {
  topUsualSize: string | null;
  topPreferredFit: string | null;
  bottomWaist: string | null;
  bottomInseam: string | null;
  bottomPreferredFit: string | null;
  bottomUsualSize: string | null;
  shoeEU: number | null;
  shoeUS: number | null;
  shoeWidth: string | null;
  ringSize: string | null;
  sensitivities: string[];
  topNotes: string[];
  bottomNotes: string[];
  shoeNotes: string[];
} | null): string {
  if (!s) return "";
  const lines: string[] = [];
  const top = joinIfAny([
    s.topUsualSize ? `Tops: ${s.topUsualSize}` : null,
    s.topPreferredFit ? `(fit: ${s.topPreferredFit})` : null,
    s.topNotes.length ? `notes: ${s.topNotes.slice(0, 3).join("; ")}` : null,
  ], " ");
  if (top) lines.push(top);

  const bottom = joinIfAny([
    s.bottomUsualSize ? `Bottoms: ${s.bottomUsualSize}` :
      (s.bottomWaist || s.bottomInseam ? `Bottoms: ${s.bottomWaist ?? "?"}W${s.bottomInseam ? ` ${s.bottomInseam}L` : ""}` : null),
    s.bottomPreferredFit ? `(fit: ${s.bottomPreferredFit})` : null,
    s.bottomNotes.length ? `notes: ${s.bottomNotes.slice(0, 3).join("; ")}` : null,
  ], " ");
  if (bottom) lines.push(bottom);

  const shoes = joinIfAny([
    s.shoeEU != null ? `Shoes: EU ${s.shoeEU}` : (s.shoeUS != null ? `Shoes: US ${s.shoeUS}` : null),
    s.shoeWidth ? `width ${s.shoeWidth}` : null,
    s.shoeNotes.length ? `notes: ${s.shoeNotes.slice(0, 3).join("; ")}` : null,
  ], " · ");
  if (shoes) lines.push(shoes);

  if (s.ringSize) lines.push(`Ring size: ${s.ringSize}`);
  if (s.sensitivities.length) {
    lines.push(`Body notes: ${s.sensitivities.slice(0, 4).join("; ")}`);
  }

  return lines.join("\n");
}

function formatCategoryPreference(rows: Array<{
  category: string;
  subcategory: string;
  preferredStyles: string[];
  dislikedStyles: string[];
  preferredColors: string[];
  dislikedColors: string[];
  preferredMaterials: string[];
  dislikedMaterials: string[];
  preferredFits: string[];
  dislikedFits: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  budgetTypical: number | null;
  currency: string | null;
}>): string {
  if (rows.length === 0) return "";
  const out: string[] = [];
  for (const r of rows) {
    const heading = `${r.category}${r.subcategory ? ` › ${r.subcategory}` : ""}`;
    const parts: string[] = [];
    if (r.preferredStyles.length) parts.push(`prefers: ${r.preferredStyles.slice(0, 6).join(", ")}`);
    if (r.dislikedStyles.length) parts.push(`avoids: ${r.dislikedStyles.slice(0, 6).join(", ")}`);
    if (r.preferredColors.length) parts.push(`colors+: ${r.preferredColors.slice(0, 5).join(", ")}`);
    if (r.dislikedColors.length) parts.push(`colors-: ${r.dislikedColors.slice(0, 5).join(", ")}`);
    if (r.preferredMaterials.length) parts.push(`materials+: ${r.preferredMaterials.slice(0, 4).join(", ")}`);
    if (r.dislikedMaterials.length) parts.push(`materials-: ${r.dislikedMaterials.slice(0, 4).join(", ")}`);
    if (r.preferredFits.length) parts.push(`fits+: ${r.preferredFits.slice(0, 3).join(", ")}`);
    if (r.dislikedFits.length) parts.push(`fits-: ${r.dislikedFits.slice(0, 3).join(", ")}`);

    const budget: string[] = [];
    if (r.budgetMin != null) budget.push(`min ${r.budgetMin}`);
    if (r.budgetMax != null) budget.push(`max ${r.budgetMax}`);
    if (r.budgetTypical != null) budget.push(`typical ${r.budgetTypical}`);
    if (budget.length) parts.push(`budget: ${budget.join(", ")}${r.currency ? ` ${r.currency}` : ""}`);

    out.push(`[${heading}] ${parts.join(" · ")}`);
  }
  return out.join("\n");
}

function formatBrandGraph(rows: Array<{
  brand: string;
  category: string;
  sentiment: "love" | "like" | "neutral" | "avoid" | "hate";
  reasons: string[];
}>): string {
  if (rows.length === 0) return "";
  const grouped: Record<string, string[]> = {};
  for (const r of rows) {
    const tag = `${r.brand}${r.category ? ` (${r.category})` : ""}${r.reasons.length ? ` — ${r.reasons.slice(0, 2).join("; ")}` : ""}`;
    grouped[r.sentiment] ??= [];
    grouped[r.sentiment].push(tag);
  }
  const lines: string[] = [];
  for (const s of ["love", "like", "neutral", "avoid", "hate"] as const) {
    const list = grouped[s];
    if (!list?.length) continue;
    lines.push(`${s.toUpperCase()}: ${list.slice(0, 10).join("; ")}`);
  }
  return lines.join("\n");
}

function formatIntents(rows: Array<{
  intentName: string;
  category: string | null;
  constraints: unknown;
  priority: "low" | "medium" | "high";
  neededBy: Date | null;
}>): string {
  if (rows.length === 0) return "";
  return rows
    .slice(0, 6)
    .map((r) => {
      const cs = (r.constraints ?? {}) as Record<string, unknown>;
      const constraintBits: string[] = [];
      for (const [k, v] of Object.entries(cs)) {
        if (v == null || (typeof v === "object" && Object.keys(v as object).length === 0)) continue;
        constraintBits.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
      }
      const need = r.neededBy ? ` (by ${r.neededBy.toISOString().slice(0, 10)})` : "";
      return `- [${r.priority}] ${r.intentName}${r.category ? ` · ${r.category}` : ""}${need}${constraintBits.length ? ` :: ${constraintBits.slice(0, 8).join(", ")}` : ""}`;
    })
    .join("\n");
}

function formatHardRules(rows: Array<{
  scope: string;
  value: string;
  category: string;
  reason: string | null;
}>): string {
  if (rows.length === 0) return "";
  return rows
    .slice(0, 24)
    .map((r) => {
      const cat = r.category ? ` in ${r.category}` : "";
      const reason = r.reason ? ` (${r.reason})` : "";
      return `- NEVER recommend ${r.scope}="${r.value}"${cat}${reason}`;
    })
    .join("\n");
}

function formatTasteTags(rows: Array<{
  tag: string;
  polarity: "positive" | "negative";
  score: number;
  evidenceCount: number;
  category: string;
}>): string {
  if (rows.length === 0) return "";
  const pos = rows.filter((r) => r.polarity === "positive").slice(0, 14);
  const neg = rows.filter((r) => r.polarity === "negative").slice(0, 14);
  const fmt = (r: { tag: string; evidenceCount: number; category: string }) =>
    `${r.tag}${r.category ? `[${r.category}]` : ""}×${r.evidenceCount}`;
  const lines: string[] = [];
  if (pos.length) lines.push(`Loves: ${pos.map(fmt).join(", ")}`);
  if (neg.length) lines.push(`Avoids: ${neg.map(fmt).join(", ")}`);
  return lines.join("\n");
}

function formatOwnedProducts(rows: OwnedProductRow[]): string {
  if (rows.length === 0) return "";
  const current = rows.filter((r) => r.isCurrent);
  const former = rows.filter((r) => !r.isCurrent);
  const out: string[] = [];

  const fmt = (r: (typeof rows)[number]) => {
    const headBits: string[] = [];
    if (r.brand) headBits.push(r.brand);
    headBits.push(r.productName);
    const head = headBits.join(" ");
    const slot = `[${r.category}${r.subcategory ? ` › ${r.subcategory}` : ""}]`;
    const attrBits: string[] = [];
    const a = (r.attributes ?? {}) as Record<string, unknown>;
    for (const k of ["color", "storage", "generation", "condition"]) {
      const v = a[k];
      if (typeof v === "string" && v.trim()) attrBits.push(`${k}=${v.trim()}`);
    }
    const when = r.acquiredNote
      ? ` (got it ${r.acquiredNote})`
      : r.acquiredAt
      ? ` (acquired ${r.acquiredAt.toISOString().slice(0, 10)})`
      : "";
    const attrs = attrBits.length ? ` · ${attrBits.join(", ")}` : "";
    const notes = r.notes ? ` — ${r.notes.slice(0, 120)}` : "";
    return `${slot} ${head}${attrs}${when}${notes}`;
  };

  if (current.length) {
    out.push("CURRENT:");
    for (const r of current.slice(0, 16)) out.push(`- ${fmt(r)}`);
  }
  if (former.length) {
    out.push("FORMERLY (no longer owned):");
    for (const r of former.slice(0, 8)) out.push(`- ${fmt(r)}`);
  }
  return out.join("\n");
}

function formatRecipients(rows: Array<{
  label: string;
  name: string | null;
  relationship: string | null;
  ageRange: string | null;
  knownPreferences: string[];
  dislikes: string[];
  favoriteBrands: string[];
  sizes: unknown;
}>): string {
  if (rows.length === 0) return "";
  return rows
    .slice(0, 6)
    .map((r) => {
      const heading = r.name ? `${r.label} (${r.name})` : r.label;
      const sizes = r.sizes as Record<string, unknown> | null;
      const sizeBits = sizes
        ? Object.entries(sizes)
            .filter(([, v]) => v != null && String(v).trim() !== "")
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(", ")
        : "";
      const parts: string[] = [];
      if (r.ageRange) parts.push(`age ${r.ageRange}`);
      if (r.knownPreferences.length)
        parts.push(`likes: ${r.knownPreferences.slice(0, 4).join(", ")}`);
      if (r.dislikes.length) parts.push(`avoids: ${r.dislikes.slice(0, 3).join(", ")}`);
      if (r.favoriteBrands.length) parts.push(`brands: ${r.favoriteBrands.slice(0, 4).join(", ")}`);
      if (sizeBits) parts.push(`sizes: ${sizeBits}`);
      return `- ${heading}: ${parts.join(" · ")}`;
    })
    .join("\n");
}

function formatCanonicalFallback(
  memories: ShoppingMemoryRow[],
  queryHint: string,
): string {
  if (memories.length === 0) return "";
  const tokens = queryHint
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);

  const scored = memories.map((m, i) => {
    let bonus = 0;
    if (m.isHardRule) bonus += 0.35;
    if (m.scope === "global") bonus += 0.08;
    if (m.scope === "session") bonus += 0.12;
    const hay = `${m.category ?? ""} ${m.subcategory ?? ""} ${m.brand ?? ""} ${m.value}`.toLowerCase();
    for (const t of tokens) {
      if (hay.includes(t)) bonus += 0.06;
    }
    return { m, score: m.importance * m.confidence + bonus - i * 0.001 };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, 14)
    .map((s) => {
      const r = s.m;
      const scope = `[${r.scope}${r.category ? ` • ${r.category}` : ""}${r.isHardRule ? " • HARD" : ""}]`;
      return `${scope} ${r.value}`;
    })
    .join("\n");
}

/**
 * Build the structured shopping context block injected at the top of Claude's
 * system prompt. Reads from typed projections (UserProfile, SizingProfile,
 * CategoryPreference, BrandPreference, ShoppingIntent, TasteTag, HardNegative,
 * Recipient) and falls back to canonical ShoppingMemory rows for anything not
 * yet projected.
 *
 * Category-aware: only the categories detected in `queryHint` are surfaced for
 * category-scoped data (saves tokens; keeps the prompt focused).
 */
export async function buildShoppingMemoryPromptXml(
  userId: string,
  queryHint: string,
): Promise<string> {
  const hint = queryHint.trim();
  const detectedCategories = detectShoppingCategoryFromQuery(hint);

  const categoryFilter = detectedCategories.length
    ? { category: { in: detectedCategories } }
    : {};

  const now = new Date();

  const [
    profile,
    sizing,
    categoryPrefs,
    brandPrefs,
    intents,
    hardNegatives,
    tasteTags,
    recipients,
    ownedProducts,
    canonicalProfile,
    canonicalMemories,
    gaps,
  ] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.sizingProfile.findUnique({ where: { userId } }),
    prisma.categoryPreference.findMany({
      where: { userId, ...categoryFilter },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: 4,
    }),
    prisma.brandPreference.findMany({
      where: detectedCategories.length
        ? { userId, OR: [{ category: { in: detectedCategories } }, { category: "" }] }
        : { userId },
      orderBy: [{ sentiment: "asc" }, { strength: "desc" }],
      take: 24,
    }),
    prisma.shoppingIntent.findMany({
      where: { userId, status: "active" },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: 6,
    }),
    prisma.hardNegative.findMany({
      where: detectedCategories.length
        ? { userId, OR: [{ category: { in: detectedCategories } }, { category: "" }] }
        : { userId },
      orderBy: [{ createdAt: "desc" }],
      take: 32,
    }),
    prisma.tasteTag.findMany({
      where: detectedCategories.length
        ? {
            userId,
            OR: [
              { category: { in: detectedCategories } },
              { scope: "global" },
            ],
          }
        : { userId },
      orderBy: [{ score: "desc" }, { evidenceCount: "desc" }],
      take: 28,
    }),
    prisma.recipient.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }],
      take: 6,
    }),
    // Current devices/items the user owns: filter by detected categories when
    // we have them (saves tokens) and always include CURRENT rows. A handful
    // of FORMER items help for "you used to have an X, want to compare?" but
    // we cap them tight.
    ownedProduct.findMany({
      where: detectedCategories.length
        ? { userId, category: { in: detectedCategories } }
        : { userId },
      orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
      take: 24,
    }) as Promise<OwnedProductRow[]>,
    prisma.shoppingProfileSummary.findUnique({ where: { userId } }),
    prisma.shoppingMemory.findMany({
      where: {
        userId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [
        { isHardRule: "desc" },
        { importance: "desc" },
        { confidence: "desc" },
      ],
      take: 28,
    }),
    detectShoppingGaps({ userId, query: hint }).catch(() => []),
  ]);

  const activeIntents = filterStaleIntents(intents, now);
  const cleanRecipients = filterNonemptyRecipients(recipients);
  const canonicalClean = hygieneCanonicalMemories(canonicalMemories);

  const identityXml = block("identity", formatIdentity(profile));
  const sizingXml = block("sizing", formatSizing(sizing));
  const categoryXml = block("category_preferences", formatCategoryPreference(categoryPrefs));
  const brandXml = block("brand_graph", formatBrandGraph(brandPrefs));
  const intentsXml = block("active_intents", formatIntents(activeIntents));
  const hardXml = block("hard_rules", formatHardRules(hardNegatives));
  const tasteXml = block("taste_graph", formatTasteTags(tasteTags));
  const recipientsXml = block("recipients", formatRecipients(cleanRecipients));
  const ownedXml = block("owned_products", formatOwnedProducts(ownedProducts));
  const gapsXml = formatGapProbesXml(gaps);

  const profileLine = canonicalProfile?.summary?.trim();
  const fallbackLine = formatCanonicalFallback(canonicalClean, hint);
  const fallbackBody = [profileLine, fallbackLine].filter(Boolean).join("\n");
  const fallbackXml = block("other_memories", fallbackBody);

  const anyContent = [
    identityXml,
    sizingXml,
    categoryXml,
    brandXml,
    intentsXml,
    hardXml,
    tasteXml,
    recipientsXml,
    ownedXml,
    fallbackXml,
    gapsXml,
  ].some(Boolean);
  if (!anyContent) return "";

  const detectedNote = detectedCategories.length
    ? `<detected_query_categories>${detectedCategories.join(", ")}</detected_query_categories>`
    : "";

  const pack = [
    `<user_shopping_context>`,
    RULES,
    detectedNote,
    identityXml,
    sizingXml,
    categoryXml,
    brandXml,
    intentsXml,
    hardXml,
    tasteXml,
    recipientsXml,
    ownedXml,
    fallbackXml,
    gapsXml,
    `</user_shopping_context>`,
  ]
    .filter(Boolean)
    .join("\n");

  if (pack.length > SHOPPING_MEMORY_PROMPT_MAX_CHARS) {
    return (
      pack.slice(0, SHOPPING_MEMORY_PROMPT_MAX_CHARS) +
      "…</user_shopping_context>"
    );
  }
  return pack;
}
