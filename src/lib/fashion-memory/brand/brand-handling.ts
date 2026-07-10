/**
 * Brand request handling ("Aldo problem").
 *
 * UCP catalog filters have NO brand/vendor filter (supported attribute filters:
 * Color, Size, Target gender only). Brand matching therefore =
 *   1) brand token in the QUERY TEXT (matches titles/vendor via relevance), plus
 *   2) CLIENT-SIDE verification on results (title / vendor / shop / Brand attr).
 *
 * shop_ids whitelist is NEVER touched — we probe inside the existing catalog,
 * then translate brand DNA when the probe pool is thin.
 *
 * Optional later: catalog.like with a known brand product as similarity seed.
 */

import { z } from "zod";
import { logAiChat } from "@/lib/ai-chat/observability";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import { fashionMemoryDb } from "../db";
import { FASHION_BRAND_TRANSLATE_MODEL } from "../models";
import { tracedLLMCall } from "../observability/traced-llm-call";
import { normalizeBrandToken } from "../router/brief-fields";
import type { FashionSearchBrief, FashionSlotBrandStatus } from "../router/types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import {
  DEPARTMENT_QUERY_WORDS,
  isGenderedDepartment,
  resolveSearchDepartment,
} from "../department";
import { validateSlotQueryVariants } from "../search-planner/validator";
import { allowedColorWordsForSlot } from "../search-planner/palette-ladder";
import type { FashionSearchPlanSlot } from "../search-planner/types";

/** Minimum brand_confirmed hits to stay in brand-first mode. */
export const BRAND_MIN_POOL = Number(process.env.FASHION_BRAND_MIN_POOL ?? "8");

export type BrandTranslation = {
  style_descriptors: string[];
  price_tier: "budget" | "mid" | "premium" | "luxury" | "unknown";
  sanity_note?: string;
};

const brandTranslateSchema = z.object({
  style_descriptors: z.array(z.string().min(1).max(80)).min(2).max(8),
  price_tier: z.enum(["budget", "mid", "premium", "luxury", "unknown"]),
  sanity_note: z.string().max(400).optional(),
});

const BRAND_TRANSLATE_TOOL = {
  name: "brand_translate",
  description:
    "Articulate a brand's style DNA when the brand is unavailable in catalog.",
  input_schema: {
    type: "object" as const,
    properties: {
      style_descriptors: {
        type: "array",
        items: { type: "string" },
        description:
          "Concrete product attributes a shopper for this brand would accept — aesthetic, materials, silhouettes. NOT competitor brand names.",
      },
      price_tier: {
        type: "string",
        enum: ["budget", "mid", "premium", "luxury", "unknown"],
      },
      sanity_note: {
        type: "string",
        description:
          "Optional gentle flag when the brand rarely makes this garment (e.g. Aldo is mostly shoes/bags).",
      },
    },
    required: ["style_descriptors", "price_tier"],
  },
};

/** Whole-token brand match against title / vendor / shop / Brand attribute. */
export function brandMatch(
  product: Pick<
    FashionSlotCatalogProduct,
    "title" | "merchant_id" | "shop_domain" | "raw"
  >,
  brand: string,
): boolean {
  const needle = normalizeBrandToken(brand);
  if (!needle) return false;

  const haystacks: string[] = [];
  if (product.title) haystacks.push(product.title);
  if (product.merchant_id) haystacks.push(product.merchant_id);
  if (product.shop_domain) haystacks.push(product.shop_domain.replace(/\./g, " "));

  const attrs = extractCatalogAttributes(product.raw);
  for (const [k, v] of Object.entries(attrs)) {
    if (/brand|vendor|designer/i.test(k) && v) haystacks.push(String(v));
  }
  const raw = product.raw as Record<string, unknown>;
  for (const key of ["brand", "vendor", "seller_name"] as const) {
    const v = raw[key];
    if (typeof v === "string") haystacks.push(v);
  }
  const seller = raw.seller as { name?: string; brand?: string } | undefined;
  if (seller?.name) haystacks.push(seller.name);
  if (seller?.brand) haystacks.push(seller.brand);

  const tokenRe = new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:[^a-z0-9]|$)`,
    "i",
  );
  return haystacks.some((h) => tokenRe.test(normalizeBrandToken(h)));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function statedBrands(brief: FashionSearchBrief): string[] {
  if (brief.brand_direction?.source !== "stated") return [];
  return (brief.brand_direction.brands ?? [])
    .map(normalizeBrandToken)
    .filter(Boolean);
}

export function buildBrandProbeQuery(params: {
  brand: string;
  garment: string;
  brief: FashionSearchBrief;
}): string {
  const department = resolveSearchDepartment({
    knowledgeDepartment: params.brief.knowledge_state?.department,
    departmentScope: params.brief.department_scope,
  });
  const deptWord = isGenderedDepartment(department)
    ? DEPARTMENT_QUERY_WORDS[department]
    : "";
  const brand = normalizeBrandToken(params.brand);
  const garment = params.garment.trim().toLowerCase() || "item";
  if (deptWord) return `${brand} ${deptWord} ${garment}`.trim();
  return `${brand} ${garment}`.trim();
}

/** Ensure variant[0] is the brand probe when stated; keep remaining as fallback. */
export function ensureBrandProbeVariant(
  slot: FashionSearchPlanSlot,
  brief: FashionSearchBrief,
): FashionSearchPlanSlot {
  const brands = statedBrands(brief);
  if (!brands.length) return slot;
  const probe = buildBrandProbeQuery({
    brand: brands[0]!,
    garment: slot.garment,
    brief,
  });
  const rest = slot.query_variants.filter(
    (v) => !v.toLowerCase().includes(brands[0]!),
  );
  return {
    ...slot,
    query_variants: [probe, ...rest].slice(0, 3),
  };
}

export function markBrandConfirmedOnProducts(
  products: FashionSlotCatalogProduct[],
  brands: string[],
): { products: FashionSlotCatalogProduct[]; confirmedCount: number } {
  if (!brands.length) {
    return { products, confirmedCount: 0 };
  }
  let confirmedCount = 0;
  const next = products.map((p) => {
    const confirmed = brands.some((b) => brandMatch(p, b));
    if (confirmed) confirmedCount += 1;
    return { ...p, brand_confirmed: confirmed };
  });
  return { products: next, confirmedCount };
}

export function decideBrandStatus(
  confirmedCount: number,
  minPool: number = BRAND_MIN_POOL,
): FashionSlotBrandStatus {
  if (confirmedCount >= minPool) return "confirmed";
  if (confirmedCount > 0) return "partial";
  return "translated";
}

export function garmentFamilyKey(garment: string): string {
  const g = garment.trim().toLowerCase();
  if (/\b(shoe|sneaker|boot|heel|loafer|sandal)\b/.test(g)) return "shoes";
  if (/\b(dress|gown|skirt)\b/.test(g)) return "dresses";
  if (/\b(pant|trouser|jean|short|chino)\b/.test(g)) return "bottoms";
  if (/\b(bag|handbag|tote|purse|wallet)\b/.test(g)) return "bags";
  if (/\b(shirt|blouse|top|tee|sweater|hoodie|blazer|jacket|coat)\b/.test(g)) {
    return "tops";
  }
  return g.split(/\s+/)[0] || "general";
}

export async function loadBrandTranslation(params: {
  brand: string;
  garmentFamily: string;
}): Promise<BrandTranslation | null> {
  try {
    const db = fashionMemoryDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (db.from("brand_translations") as any)
      .select("style_descriptors, price_tier, sanity_note")
      .eq("brand", normalizeBrandToken(params.brand))
      .eq("garment_family", params.garmentFamily)
      .maybeSingle();
    if (!row.data) return null;
    const data = row.data as {
      style_descriptors: string[];
      price_tier: BrandTranslation["price_tier"];
      sanity_note: string | null;
    };
    return {
      style_descriptors: data.style_descriptors ?? [],
      price_tier: data.price_tier ?? "unknown",
      sanity_note: data.sanity_note ?? undefined,
    };
  } catch (error) {
    logAiChat("warn", "brand_translation_cache_read_failed", {
      error: String(error),
    });
    return null;
  }
}

export async function writeBrandTranslation(params: {
  brand: string;
  garmentFamily: string;
  translation: BrandTranslation;
}): Promise<void> {
  try {
    const db = fashionMemoryDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from("brand_translations") as any).upsert({
      brand: normalizeBrandToken(params.brand),
      garment_family: params.garmentFamily,
      style_descriptors: params.translation.style_descriptors,
      price_tier: params.translation.price_tier,
      sanity_note: params.translation.sanity_note ?? null,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    logAiChat("warn", "brand_translation_cache_write_failed", {
      error: String(error),
    });
  }
}

export async function translateBrandStyle(params: {
  brand: string;
  garment: string;
  brief: FashionSearchBrief;
  signal?: AbortSignal;
  traceId?: string | null;
  /** Injected for tests. */
  createMessage?: typeof tracedLLMCall;
}): Promise<BrandTranslation> {
  const family = garmentFamilyKey(params.garment);
  const cached = await loadBrandTranslation({
    brand: params.brand,
    garmentFamily: family,
  });
  if (cached?.style_descriptors.length) return cached;

  const createMessage = params.createMessage ?? tracedLLMCall;
  const system = `You help a fashion catalog that cannot stock every brand. The user asked for ${params.brand} for a ${params.garment}, which is unavailable or scarce in our catalog. Articulate the brand's style DNA in concrete product attributes — aesthetic, materials, price tier, silhouettes. Say what a ${params.brand} customer would find acceptable instead using style descriptors, NOT competitor brand names. If this brand rarely makes this garment, set sanity_note (gentle, one sentence). Call brand_translate once.`;

  const response = await createMessage({
    traceId: params.traceId,
    stage: "brand_translate",
    model: FASHION_BRAND_TRANSLATE_MODEL,
    maxTokens: 1024,
    temperature: 0.2,
    systemPrompt: system,
    inputMessages: [
      {
        role: "user",
        content: JSON.stringify({
          brand: params.brand,
          garment: params.garment,
          occasion: params.brief.occasion_context,
          style_direction: params.brief.style_direction,
        }),
      },
    ],
    tools: [BRAND_TRANSLATE_TOOL],
    toolChoice: { type: "tool", name: "brand_translate" },
    signal: params.signal,
  });

  const toolBlock = response.content.find(
    (b) => b.type === "tool_use" && b.name === "brand_translate",
  );
  const parsed =
    toolBlock && toolBlock.type === "tool_use"
      ? brandTranslateSchema.safeParse(toolBlock.input)
      : null;

  const translation: BrandTranslation = parsed?.success
    ? {
        style_descriptors: parsed.data.style_descriptors,
        price_tier: parsed.data.price_tier,
        sanity_note: parsed.data.sanity_note,
      }
    : {
        style_descriptors: ["contemporary", "polished", "everyday"],
        price_tier: "mid",
        sanity_note: undefined,
      };

  await writeBrandTranslation({
    brand: params.brand,
    garmentFamily: family,
    translation,
  });
  return translation;
}

export function buildTranslatedQueryVariants(params: {
  slot: FashionSearchPlanSlot;
  brief: FashionSearchBrief;
  translation: BrandTranslation;
  brands: string[];
}): string[] {
  const department = resolveSearchDepartment({
    knowledgeDepartment: params.brief.knowledge_state?.department,
    departmentScope: params.brief.department_scope,
  });
  const deptWord = isGenderedDepartment(department)
    ? DEPARTMENT_QUERY_WORDS[department]
    : "";
  const garment = params.slot.garment;
  const descriptors = params.translation.style_descriptors.slice(0, 4);
  const raw = [
    [deptWord, descriptors[0], descriptors[1], garment].filter(Boolean).join(" "),
    [deptWord, descriptors[2] ?? descriptors[0], garment, "everyday"]
      .filter(Boolean)
      .join(" "),
    [deptWord, descriptors[1] ?? "polished", garment].filter(Boolean).join(" "),
  ];

  // Strip any accidental brand tokens from translated variants.
  const brandSet = new Set(params.brands.map(normalizeBrandToken));
  const withoutBrand = raw.map((q) =>
    q
      .split(/\s+/)
      .filter((t) => !brandSet.has(normalizeBrandToken(t)))
      .join(" "),
  );

  const validated = validateSlotQueryVariants({
    variants: withoutBrand,
    paletteSource: params.slot.palette_source,
    allowedColorWords: allowedColorWordsForSlot(params.slot, params.brief),
    department,
  });
  return validated.variants.slice(0, 3);
}

/**
 * HARD RULE: when brand_direction.source is stated, the user-facing reply
 * MUST mention the brand outcome. Silent substitution is a contract violation.
 */
export function buildBrandNarration(params: {
  brands: string[];
  status: FashionSlotBrandStatus;
  translation?: BrandTranslation | null;
  confirmedCount?: number;
}): string {
  const brandLabel = params.brands
    .map((b) => b.charAt(0).toUpperCase() + b.slice(1))
    .join(" / ");
  if (params.status === "confirmed") {
    return `Pulled ${brandLabel} options that match what you asked for.`;
  }
  if (params.status === "partial") {
    const n = params.confirmedCount ?? 0;
    return `Only a few ${brandLabel} options here (${n}) — I've added close matches in the same style.`;
  }
  const descriptors = (params.translation?.style_descriptors ?? [])
    .slice(0, 2)
    .join(", ");
  const base = descriptors
    ? `I couldn't find ${brandLabel} pieces in my catalog for this — so I pulled pieces with the same spirit: ${descriptors}.`
    : `I couldn't find ${brandLabel} pieces in my catalog for this — so I pulled close matches in the same style.`;
  const note = params.translation?.sanity_note?.trim();
  return note ? `${base} ${note}` : base;
}

export function assertBrandMentionedInReply(params: {
  reply: string;
  brands: string[];
}): boolean {
  const lower = params.reply.toLowerCase();
  return params.brands.some((b) => lower.includes(normalizeBrandToken(b)));
}
