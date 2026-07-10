import { createLightweightMessage } from "../../anthropic";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "../../constants";
import { logAiChat } from "../../observability";
import type { CuratedPick } from "../../types";
import type { SearchBrief } from "../types";
import type { SimilarSearchContext, TasteDifferentiator, TasteHypothesis } from "./types";

const SYSTEM = `You infer what attracted a shopper to ONE product they tapped "Find similar" on, contrastively against sibling picks shown alongside it.

Output ONLY valid JSON (no markdown):
{
  "differentiators": [{"attribute":"suede upper","weight":0.9,"confidence":0.85}],
  "shared_context": ["casual sneakers","under $120"],
  "uncertain": [{"attribute":"minimal branding","weight":0.4,"confidence":0.35}],
  "non_signals": ["brand loyalty — siblings had mixed brands too"]
}

Rules:
- Reason contrastively: what distinguishes the CHOSEN item from the ALTERNATIVES, not a generic product description.
- differentiators: 1-5 attributes the seed has that most siblings lack (material, color family, silhouette, price position within the set, functional traits). weight and confidence are 0-1.
- shared_context: category/occasion/budget traits common to ALL picks — NOT personal taste.
- uncertain: plausible but weakly supported.
- non_signals: explicit statements of what this tap does NOT evidence (prevents overfitting).
- Strip brand names from differentiator phrases when possible.
- If siblings are missing, extract seed attributes only with confidence <= 0.35 each.`;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeDifferentiators(raw: unknown): TasteDifferentiator[] {
  if (!Array.isArray(raw)) return [];
  const out: TasteDifferentiator[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const attribute =
      typeof o.attribute === "string" ? o.attribute.trim() : "";
    if (!attribute || attribute.length < 2) continue;
    out.push({
      attribute: attribute.slice(0, 120),
      weight: clamp01(Number(o.weight)),
      confidence: clamp01(Number(o.confidence)),
    });
  }
  return out.slice(0, 6);
}

function summarizePick(p: CuratedPick): Record<string, unknown> {
  return {
    id: p.id,
    title: p.title,
    price: p.displayPrice ?? p.priceRange?.min,
    options: p.options?.map((o) => ({
      name: o.name,
      values: o.values.map((v) => v.label),
    })),
    attributes: p.catalogAttributes?.map((a) => `${a.name}: ${a.value}`),
  };
}

function parseHypothesisJson(text: string): Omit<
  TasteHypothesis,
  "version" | "updatedAt" | "evidence"
> | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const sharedContext = Array.isArray(raw.shared_context)
      ? raw.shared_context
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim().slice(0, 80))
          .slice(0, 8)
      : [];
    const nonSignals = Array.isArray(raw.non_signals)
      ? raw.non_signals
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim().slice(0, 120))
          .slice(0, 6)
      : [];
    return {
      differentiators: normalizeDifferentiators(raw.differentiators),
      sharedContext,
      uncertain: normalizeDifferentiators(raw.uncertain),
      nonSignals,
    };
  } catch {
    return null;
  }
}

export async function inferTasteHypothesis(params: {
  similar: SimilarSearchContext;
  brief: SearchBrief;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TasteHypothesis | null> {
  const { similar, brief } = params;
  const userPayload = {
    seed: {
      id: similar.seedProductId,
      title: similar.seedTitle,
      price_cents: similar.seedPriceCents,
      description: similar.seedDescription?.slice(0, 400),
      options: similar.seedOptions,
      vendor: similar.seedVendor,
    },
    siblings: similar.siblingPicks.map(summarizePick),
    brief: {
      query: brief.query,
      category: brief.category,
      budget: brief.budget,
      recipient: brief.recipient,
      must_haves: brief.mustHaves,
      direction: brief.directionLabel,
    },
    note:
      similar.siblingPicks.length === 0
        ? "No sibling picks available — use low confidence."
        : undefined,
  };

  try {
    const call = createLightweightMessage(
      {
        model: AI_CHAT_LIGHTWEIGHT_MODEL,
        max_tokens: 700,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: JSON.stringify(userPayload),
          },
        ],
      },
      { signal: params.signal },
    );
    const timeout = params.timeoutMs ?? 2200;
    const msg = await Promise.race([
      call,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
    ]);
    if (!msg) return null;
    const text =
      msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const parsed = parseHypothesisJson(text);
    if (!parsed) return null;
    return {
      version: 1,
      ...parsed,
      updatedAt: new Date().toISOString(),
      evidence: [
        {
          at: new Date().toISOString(),
          kind: "similar_tap",
          seedProductId: similar.seedProductId,
          sourceMessageId: similar.sourceMessageId,
        },
      ],
    };
  } catch (error) {
    logAiChat("warn", "taste_hypothesis_infer_failed", {
      seedProductId: similar.seedProductId,
      error: String(error).slice(0, 160),
    });
    return null;
  }
}

export function applyConfirmedAttributeChip(
  hypothesis: TasteHypothesis,
  chipLabel: string,
): TasteHypothesis {
  const attribute = chipLabel.trim();
  if (!attribute) return hypothesis;
  const boosted: TasteDifferentiator = {
    attribute,
    weight: 1,
    confidence: 1,
  };
  const rest = hypothesis.differentiators.filter(
    (d) => d.attribute.toLowerCase() !== attribute.toLowerCase(),
  );
  return {
    ...hypothesis,
    differentiators: [boosted, ...rest].slice(0, 6),
    updatedAt: new Date().toISOString(),
    evidence: [
      ...hypothesis.evidence,
      {
        at: new Date().toISOString(),
        kind: "chip_confirm",
        seedProductId: hypothesis.evidence[0]?.seedProductId ?? "",
        detail: attribute,
      },
    ],
  };
}

export function hypothesisNeedsElicitation(h: TasteHypothesis | null): boolean {
  if (!h) return true;
  const top = h.differentiators[0];
  if (!top) return true;
  return top.confidence < 0.42;
}

export function topHypothesisPhrase(h: TasteHypothesis | null): string | null {
  if (!h?.differentiators.length) return null;
  const top = [...h.differentiators].sort(
    (a, b) => b.confidence * b.weight - a.confidence * a.weight,
  )[0];
  return top?.attribute ?? null;
}
