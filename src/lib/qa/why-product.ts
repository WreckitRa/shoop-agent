import { prisma } from "@/lib/ai-chat/db";
import type { MessageMetadata } from "@/lib/ai-chat/types";
import { resolveProductRef } from "@/lib/qa/resolve-product-ref";

export type WhyProductInsight = {
  productId: string;
  resolvedFrom: string;
  traceId?: string;
  messageId?: string;
  garment?: string;
  status: "survivor" | "dropped" | "curator_excluded" | "unknown";
  score?: {
    final: number;
    components: Record<string, number>;
  };
  drop?: { rule: string; evidence: string };
  slot_id?: string;
};

export async function lookupWhyProduct(params: {
  productRef: string;
  traceId?: string | null;
}): Promise<{ productId: string | null; insights: WhyProductInsight[] }> {
  const productId = resolveProductRef(params.productRef);
  if (!productId) return { productId: null, insights: [] };

  const messages = await prisma.message.findMany({
    where: {
      role: "assistant",
    },
    orderBy: { createdAt: "desc" },
    take: params.traceId ? 32 : 60,
    select: { id: true, metadata: true, conversationId: true },
  });

  const filtered = params.traceId
    ? messages.filter((row) => {
        const meta = row.metadata as MessageMetadata | null;
        return meta?.fashionCatalogSearch?.trace_id === params.traceId;
      })
    : messages;

  const insights: WhyProductInsight[] = [];

  for (const row of filtered) {
    const meta = row.metadata as MessageMetadata | null;
    const cs = meta?.fashionCatalogSearch;
    if (!cs?.slots?.length) continue;
    const traceId = cs.trace_id;

    for (const slot of cs.slots) {
      const survivor = (slot.verified_pool ?? slot.products ?? []).find(
        (p) => p.id === productId,
      );
      if (survivor) {
        insights.push({
          productId,
          resolvedFrom: params.productRef,
          traceId,
          messageId: row.id,
          garment: slot.garment,
          status: "survivor",
          score: survivor.score
            ? {
                final: survivor.score.final,
                components: survivor.score.components as Record<string, number>,
              }
            : undefined,
          slot_id: slot.slot_id,
        });
        continue;
      }

      const dropped = slot.dropped?.find((d) => d.product_id === productId);
      if (dropped) {
        insights.push({
          productId,
          resolvedFrom: params.productRef,
          traceId,
          messageId: row.id,
          garment: slot.garment,
          status: "dropped",
          drop: { rule: dropped.rule, evidence: dropped.evidence },
          slot_id: slot.slot_id,
        });
        continue;
      }

      if (slot.curator_exclusions?.includes(productId)) {
        insights.push({
          productId,
          resolvedFrom: params.productRef,
          traceId,
          messageId: row.id,
          garment: slot.garment,
          status: "curator_excluded",
          slot_id: slot.slot_id,
        });
      }
    }
  }

  return { productId, insights };
}
