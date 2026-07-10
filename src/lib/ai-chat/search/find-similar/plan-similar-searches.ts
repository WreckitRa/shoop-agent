import { createLightweightMessage } from "../../anthropic";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "../../constants";
import { logAiChat } from "../../observability";
import type {
  CatalogProductDetail,
  CatalogProductSummary,
} from "@/lib/shopify/catalog";
import type { CuratedPick } from "../../types";
import type { SearchBrief } from "../types";
import { sanitizeQueryText } from "../query-hygiene";
import { formatSeedForPlanner } from "./format-seed-for-planner";

export type PlannedSimilarSearch = {
  id: string;
  text: string;
  rationale?: string;
};

export type SimilarSearchPlan = {
  productType?: string;
  priceTier?: string;
  searches: PlannedSimilarSearch[];
};

const PLANNER_SYSTEM = `You plan Shopify catalog searches for a "find something similar" flow.

The user tapped a specific product. You receive full catalog data for that product.

Your job: propose exactly 4 DISTINCT catalog search queries that would surface good alternatives with the same product type/class, similar attributes, quality level, and price tier.

Output ONLY valid JSON (no markdown):
{
  "product_type": "crossbody bag",
  "price_tier": "mid-premium",
  "searches": [
    {"id":"closest","text":"minimal leather crossbody bag","rationale":"same type and material tier"},
    {"id":"material","text":"pebbled leather shoulder bag","rationale":"material-forward lane"},
    {"id":"style","text":"structured everyday crossbody","rationale":"silhouette and use case"},
    {"id":"price_adj","text":"designer leather crossbody under $200","rationale":"adjacent price band"}
  ]
}

Rules:
- Exactly 4 searches — each id is snake_case, text is 3-8 words.
- Query text = product type + concrete attributes (material, silhouette, color family, function). NO gift/occasion/recipient words.
- Infer type/class/level/price from the product data — do NOT paste the full merchant SKU title.
- Strip brand names from query text.
- Vary the 4 angles: closest overall match, material/texture, style/silhouette, price-adjacent tier.
- If user_confirmed_attribute is set, make at least 2 queries emphasize it.
- Keep all 4 in the same broad product category as the seed.`;

function parsePlanJson(text: string): SimilarSearchPlan | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const searchesRaw = raw.searches;
    if (!Array.isArray(searchesRaw)) return null;

    const searches: PlannedSimilarSearch[] = [];
    for (const item of searchesRaw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id =
        typeof o.id === "string" && o.id.trim()
          ? o.id.trim().slice(0, 40)
          : `q${searches.length + 1}`;
      const textVal =
        typeof o.text === "string" ? sanitizeQueryText(o.text.trim()) : "";
      if (!textVal || textVal.length < 3) continue;
      searches.push({
        id,
        text: textVal.slice(0, 120),
        rationale:
          typeof o.rationale === "string" ? o.rationale.trim().slice(0, 200) : undefined,
      });
    }

    if (searches.length < 4) return null;

    return {
      productType:
        typeof raw.product_type === "string"
          ? raw.product_type.trim().slice(0, 80)
          : undefined,
      priceTier:
        typeof raw.price_tier === "string"
          ? raw.price_tier.trim().slice(0, 40)
          : undefined,
      searches: searches.slice(0, 4),
    };
  } catch {
    return null;
  }
}

function fallbackPlan(seedTitle: string, brief: SearchBrief): SimilarSearchPlan {
  const tokens = seedTitle
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(-5);
  const core = tokens.join(" ") || seedTitle.slice(0, 40);
  const base = sanitizeQueryText(core, brief) || sanitizeQueryText("similar product", brief);

  const variants = [
    base,
    sanitizeQueryText(`${core} alternative`, brief),
    sanitizeQueryText(`${core} similar style`, brief),
    sanitizeQueryText(`${core} comparable`, brief),
  ].filter((q) => q.length >= 3);

  while (variants.length < 4) {
    variants.push(base);
  }

  return {
    searches: variants.slice(0, 4).map((text, i) => ({
      id: `fallback_${i + 1}`,
      text,
      rationale: "Heuristic fallback",
    })),
  };
}

export async function planSimilarSearches(params: {
  pick: CuratedPick;
  brief: SearchBrief;
  detail?: CatalogProductDetail;
  summary?: CatalogProductSummary;
  confirmedAttribute?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SimilarSearchPlan> {
  const userPayload = formatSeedForPlanner(params);

  try {
    const call = createLightweightMessage(
      {
        model: AI_CHAT_LIGHTWEIGHT_MODEL,
        max_tokens: 900,
        system: PLANNER_SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(userPayload) }],
      },
      { signal: params.signal },
    );
    const timeout = params.timeoutMs ?? 3500;
    const msg = await Promise.race([
      call,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
    ]);
    if (!msg) {
      logAiChat("warn", "similar_search_plan_timeout", {
        productId: params.pick.id,
      });
      return fallbackPlan(params.pick.title, params.brief);
    }
    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const parsed = parsePlanJson(text);
    if (!parsed) {
      logAiChat("warn", "similar_search_plan_parse_failed", {
        productId: params.pick.id,
      });
      return fallbackPlan(params.pick.title, params.brief);
    }
    logAiChat("info", "similar_search_plan_ok", {
      productId: params.pick.id,
      productType: parsed.productType,
      queries: parsed.searches.map((s) => s.text),
    });
    return parsed;
  } catch (error) {
    logAiChat("warn", "similar_search_plan_failed", {
      productId: params.pick.id,
      error: String(error).slice(0, 160),
    });
    return fallbackPlan(params.pick.title, params.brief);
  }
}
