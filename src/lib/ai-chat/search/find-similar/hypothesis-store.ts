import { kvGet, kvSetex } from "@/lib/cache/kv-store";
import { logAiChat } from "../../observability";
import type { TasteDifferentiator, TasteHypothesis } from "./types";
import {
  SIMILAR_VALIDATION_CONFIDENCE_MIN,
  SIMILAR_VALIDATION_EVIDENCE_MIN,
} from "./types";

const KV_PREFIX = "taste-hypothesis:";
const TTL_SECONDS = 60 * 60 * 24 * 14;

function kvKey(conversationId: string): string {
  return `${KV_PREFIX}${conversationId}`;
}

export async function loadTasteHypothesis(
  conversationId: string,
): Promise<TasteHypothesis | null> {
  const raw = await kvGet(kvKey(conversationId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TasteHypothesis;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveTasteHypothesis(
  conversationId: string,
  hypothesis: TasteHypothesis,
): Promise<void> {
  try {
    await kvSetex(kvKey(conversationId), TTL_SECONDS, JSON.stringify(hypothesis));
  } catch (error) {
    logAiChat("warn", "taste_hypothesis_save_failed", {
      conversationId,
      error: String(error).slice(0, 160),
    });
  }
}

function intersectDifferentiators(
  a: TasteDifferentiator[],
  b: TasteDifferentiator[],
): TasteDifferentiator[] {
  const out: TasteDifferentiator[] = [];
  for (const da of a) {
    const match = b.find(
      (db) =>
        db.attribute.toLowerCase().includes(da.attribute.toLowerCase()) ||
        da.attribute.toLowerCase().includes(db.attribute.toLowerCase()),
    );
    if (match) {
      out.push({
        attribute: da.attribute,
        weight: Math.max(da.weight, match.weight),
        confidence: Math.min(1, (da.confidence + match.confidence) / 2 + 0.15),
      });
    }
  }
  return out.sort((x, y) => y.confidence * y.weight - x.confidence * x.weight);
}

function decayMissing(
  prior: TasteDifferentiator[],
  fresh: TasteDifferentiator[],
): TasteDifferentiator[] {
  return prior
    .filter(
      (p) =>
        !fresh.some(
          (f) =>
            f.attribute.toLowerCase().includes(p.attribute.toLowerCase()) ||
            p.attribute.toLowerCase().includes(f.attribute.toLowerCase()),
        ),
    )
    .map((p) => ({
      ...p,
      confidence: Math.max(0, p.confidence - 0.2),
    }))
    .filter((p) => p.confidence >= 0.15);
}

/** Merge a fresh inference with the stored session hypothesis. */
export function mergeTasteHypotheses(
  prior: TasteHypothesis | null,
  fresh: TasteHypothesis,
): TasteHypothesis {
  if (!prior) return fresh;
  const intersected = intersectDifferentiators(
    prior.differentiators,
    fresh.differentiators,
  );
  const decayed = decayMissing(prior.differentiators, fresh.differentiators);
  const novel = fresh.differentiators.filter(
    (f) =>
      !prior.differentiators.some(
        (p) =>
          p.attribute.toLowerCase().includes(f.attribute.toLowerCase()) ||
          f.attribute.toLowerCase().includes(p.attribute.toLowerCase()),
      ),
  );
  const differentiators = [...intersected, ...novel, ...decayed]
    .sort((a, b) => b.confidence * b.weight - a.confidence * a.weight)
    .slice(0, 6);

  return {
    version: 1,
    differentiators,
    sharedContext: fresh.sharedContext.length
      ? fresh.sharedContext
      : prior.sharedContext,
    uncertain: fresh.uncertain,
    nonSignals: [...new Set([...prior.nonSignals, ...fresh.nonSignals])].slice(
      0,
      8,
    ),
    updatedAt: new Date().toISOString(),
    evidence: [
      ...prior.evidence,
      ...fresh.evidence,
      {
        at: new Date().toISOString(),
        kind: "intersection" as const,
        seedProductId: fresh.evidence[0]?.seedProductId ?? "",
      },
    ].slice(-24),
  };
}

export function decayAttributeOnRejection(
  hypothesis: TasteHypothesis,
  attributes: string[],
): TasteHypothesis {
  const needles = attributes.map((a) => a.toLowerCase()).filter(Boolean);
  if (!needles.length) return hypothesis;
  return {
    ...hypothesis,
    differentiators: hypothesis.differentiators
      .map((d) => {
        const hit = needles.some(
          (n) =>
            d.attribute.toLowerCase().includes(n) ||
            n.includes(d.attribute.toLowerCase()),
        );
        return hit
          ? { ...d, confidence: Math.max(0, d.confidence - 0.35) }
          : d;
      })
      .filter((d) => d.confidence >= 0.12),
    updatedAt: new Date().toISOString(),
    evidence: [
      ...hypothesis.evidence,
      {
        at: new Date().toISOString(),
        kind: "rejection" as const,
        seedProductId: hypothesis.evidence[0]?.seedProductId ?? "",
        detail: attributes.join(", "),
      },
    ].slice(-24),
  };
}

export type ValidatedTasteAttribute = {
  attribute: string;
  confidence: number;
  evidenceCount: number;
};

/** Attributes ready for long-term preference memory (never single-tap). */
export function validatedTasteAttributes(
  hypothesis: TasteHypothesis | null,
): ValidatedTasteAttribute[] {
  if (!hypothesis) return [];
  const tapSeeds = new Set(
    hypothesis.evidence
      .filter((e) => e.kind === "similar_tap" || e.kind === "chip_confirm")
      .map((e) => e.seedProductId),
  );
  const evidenceCount = tapSeeds.size;
  if (evidenceCount < SIMILAR_VALIDATION_EVIDENCE_MIN) return [];

  return hypothesis.differentiators
    .filter((d) => d.confidence >= SIMILAR_VALIDATION_CONFIDENCE_MIN)
    .map((d) => ({
      attribute: d.attribute,
      confidence: d.confidence,
      evidenceCount,
    }));
}
