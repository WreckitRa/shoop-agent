import { prisma } from "@/lib/ai-chat/db";
import type { FashionSearchBrief } from "../router/types";
import type { FashionPendingBriefMetaV1 } from "../router/types";

export async function loadPendingBrief(
  conversationId: string,
): Promise<FashionPendingBriefMetaV1 | null> {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: "assistant" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 24,
    select: { metadata: true },
  });

  for (const row of rows) {
    const meta = row.metadata as {
      fashionPendingBrief?: FashionPendingBriefMetaV1;
      fashionSearchPlan?: unknown;
      fashionCatalogSearch?: unknown;
      fashionRouter?: { move?: string };
    } | null;
    if (meta?.fashionSearchPlan || meta?.fashionCatalogSearch) break;
    if (meta?.fashionRouter?.move === "ready_to_search") break;
    if (meta?.fashionPendingBrief?.version === 1) {
      return meta.fashionPendingBrief;
    }
  }
  return null;
}

export function pendingBriefMeta(
  brief: FashionSearchBrief,
  recipientPersonId: string,
): FashionPendingBriefMetaV1 {
  return {
    version: 1,
    brief,
    recipientPersonId,
    savedAt: new Date().toISOString(),
  };
}

/**
 * After a size/dept clarification the LLM often re-briefs from the chip
 * reply ("M") and drops shopping intent. Keep the parked brief's shape;
 * overlay only fields the new brief is allowed to refresh.
 */
export function resumePendingShoppingBrief(
  pending: FashionSearchBrief,
  next: FashionSearchBrief,
): FashionSearchBrief {
  const occasionFromPending =
    pending.occasion_context?.trim() &&
    !/^(general|casual|everyday|n\/?a|none|\.+)$/i.test(
      pending.occasion_context.trim(),
    );

  return {
    ...next,
    request_type: pending.request_type,
    garments: pending.garments.length ? pending.garments : next.garments,
    occasion_context: occasionFromPending
      ? pending.occasion_context
      : next.occasion_context,
    quantity_hint: pending.quantity_hint || next.quantity_hint,
    must_haves: pending.must_haves.length ? pending.must_haves : next.must_haves,
    nice_to_haves: pending.nice_to_haves.length
      ? pending.nice_to_haves
      : next.nice_to_haves,
    style_direction: preferPendingStyleDirection(
      pending.style_direction,
      next.style_direction,
    ),
    budget_context: next.budget_context.stated
      ? next.budget_context
      : pending.budget_context.stated
        ? pending.budget_context
        : next.budget_context,
    color_direction: next.color_direction ?? pending.color_direction,
    brand_direction: next.brand_direction ?? pending.brand_direction,
    department_scope: next.department_scope ?? pending.department_scope,
  };
}

function preferPendingStyleDirection(pending: string, next: string): string {
  const p = pending.trim();
  const n = next.trim();
  if (!p) return n || "general";
  if (!n || n === "general") return p;
  // Chip / Q&A echo — not a shopping ask.
  if (
    /\bwhat size\b/i.test(n) ||
    /\busually wear\b/i.test(n) ||
    /^(xs|s|m|l|xl|xxl|men'?s|women'?s)\b/i.test(n)
  ) {
    return p;
  }
  return n;
}
