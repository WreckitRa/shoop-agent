/**
 * Batched Haiku pass for listing-trust cases the deterministic gate marks
 * suspect — one call per search wave, not per product.
 */
import { createLightweightMessage } from "../anthropic";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "../constants";
import { parseLlmJsonObject } from "../shopping-memory/llm-json";
import { logAiChat } from "../observability";
import type { SearchBrief } from "./types";
import type { ListingHygiene, ListingQuality } from "./listing-hygiene";
import type { VerifiedCandidate } from "./verify";

export const LISTING_HYGIENE_LLM_TIMEOUT_MS = parseIntEnv(
  process.env.LISTING_HYGIENE_LLM_TIMEOUT_MS,
  3500,
);

export const LISTING_HYGIENE_LLM_MIN_CONFIDENCE = 0.85;

function parseIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 500) return fallback;
  return Math.min(Math.round(n), 10_000);
}

export function listingHygieneLlmEnabled(): boolean {
  const raw = process.env.LISTING_HYGIENE_LLM?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

type LlmTrustRow = {
  id: string;
  verdict: "legit" | "suspect" | "junk";
  confidence?: number;
  reason?: string;
};

const LISTING_TRUST_TOOL = {
  name: "listing_trust_results",
  description: "Per-product listing trust verdicts for catalog hygiene.",
  input_schema: {
    type: "object" as const,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            verdict: {
              type: "string",
              enum: ["legit", "suspect", "junk"],
            },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["id", "verdict", "confidence"],
        },
      },
    },
    required: ["results"],
  },
};

function listingTrustPayload(
  vc: VerifiedCandidate,
  hygiene: ListingHygiene,
): Record<string, unknown> {
  const d = vc.detail;
  const seller = d.seller ?? d.variants?.find((v) => v.seller)?.seller;
  return {
    id: d.id,
    title: d.title,
    seller_name: seller?.name ?? null,
    seller_domain: seller?.domain ?? null,
    price_cents: vc.resolvedPriceCents,
    review_count: d.rating?.count ?? null,
    rating: d.rating?.value ?? null,
    size_options: d.options?.find((o) => /size/i.test(o.name))?.values?.length ?? 0,
    deterministic_quality: hygiene.quality,
    flags: hygiene.flags,
    brand_tier: hygiene.brandTier,
    merchant_established: hygiene.merchantEstablished ?? false,
    notes: hygiene.notes,
  };
}

async function batchLlmListingTrust(params: {
  brief: SearchBrief;
  escalations: VerifiedCandidate[];
  hygieneById: Map<string, ListingHygiene>;
  signal?: AbortSignal;
}): Promise<Map<string, { quality: ListingQuality; reason?: string }>> {
  const out = new Map<string, { quality: ListingQuality; reason?: string }>();
  if (!params.escalations.length || !listingHygieneLlmEnabled()) return out;

  const products = params.escalations.map((vc) =>
    listingTrustPayload(vc, params.hygieneById.get(vc.detail.id)!),
  );

  const prompt = JSON.stringify({
    task: "For each product, decide whether this is a legitimate merchant listing or clearance/dropship junk.",
    query: params.brief.query,
    category: params.brief.category ?? null,
    products,
    rules: [
      "legit: real brand or established merchant (named seller, domain, multi-size catalog) — product-line names like FlexPro are NOT SKUs",
      "junk: numeric SKU titles (70290625M), single-size clearance, generic dropship phrases, or price impossibly low for category with no merchant trust",
      "suspect: unclear — prefer suspect over junk when seller looks real",
      "confidence 0-1; use >=0.85 only when certain",
    ],
  });

  const call = createLightweightMessage(
    {
      model: AI_CHAT_LIGHTWEIGHT_MODEL,
      max_tokens: 1200,
      tools: [LISTING_TRUST_TOOL],
      tool_choice: { type: "tool", name: LISTING_TRUST_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    },
    { signal: params.signal },
  );

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), LISTING_HYGIENE_LLM_TIMEOUT_MS),
  );

  try {
    const msg = await Promise.race([call, timeout]);
    if (!msg) {
      logAiChat("warn", "listing_hygiene_llm_timeout", {
        count: params.escalations.length,
      });
      return out;
    }

    const block = msg.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> =>
        b.type === "tool_use" && b.name === LISTING_TRUST_TOOL.name,
    );
    const parsedMsg = block
      ? parseLlmJsonObject(JSON.stringify(block.input))
      : parseLlmJsonObject(
          msg.content
            .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
            .map((b) => b.text)
            .join("\n"),
        );
    const results = (parsedMsg as { results?: LlmTrustRow[] } | null)?.results;
    if (!Array.isArray(results)) return out;

    for (const row of results) {
      if (!row?.id) continue;
      const conf = row.confidence ?? 0;
      if (conf < LISTING_HYGIENE_LLM_MIN_CONFIDENCE) continue;
      out.set(row.id, {
        quality: row.verdict === "legit" ? "clean" : row.verdict,
        reason: row.reason,
      });
    }
  } catch (err) {
    logAiChat("warn", "listing_hygiene_llm_failed", {
      error: String(err).slice(0, 160),
    });
  }

  return out;
}

/** Re-run trust on suspect listings; may upgrade to clean or downgrade to junk. */
export async function resolveListingTrustForSuspects(params: {
  verified: VerifiedCandidate[];
  brief: SearchBrief;
  hygieneById: Map<string, ListingHygiene>;
  signal?: AbortSignal;
}): Promise<Map<string, ListingHygiene>> {
  const updated = new Map(params.hygieneById);
  const suspects = params.verified.filter((vc) => {
    const h = params.hygieneById.get(vc.detail.id);
    return h?.quality === "suspect";
  });
  if (!suspects.length) return updated;

  const llmMap = await batchLlmListingTrust({
    brief: params.brief,
    escalations: suspects,
    hygieneById: params.hygieneById,
    signal: params.signal,
  });

  for (const [id, verdict] of llmMap) {
    const prior = updated.get(id);
    if (!prior) continue;
    updated.set(id, {
      ...prior,
      quality: verdict.quality,
      notes: verdict.reason
        ? [...prior.notes, `LLM trust: ${verdict.reason}`]
        : [...prior.notes, `LLM trust: ${verdict.quality}`],
    });
  }

  return updated;
}
