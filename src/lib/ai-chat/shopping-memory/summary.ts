import { prisma } from "../db";
import type { ShoppingMemoryRow } from "../prisma-types";

/** Deterministic summary refresh from canonical memories (guide §17 shopping_profile_summary). */
export async function refreshShoppingProfileSummary(
  userId: string,
): Promise<void> {
  const rows: ShoppingMemoryRow[] = await prisma.shoppingMemory.findMany({
    where: {
      userId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ isHardRule: "desc" }, { importance: "desc" }, { confidence: "desc" }],
    take: 56,
  });

  const pick = (pred: (t: string) => boolean) =>
    rows
      .filter((r) => pred(r.type))
      .slice(0, 14)
      .map((r) => r.value.replace(/\s+/g, " ").trim());

  const styleSummary = pick((t) =>
    ["preference", "dislike", "taste_tag", "brand"].includes(t),
  ).join("\n");
  const sizingSummary = pick((t) => ["size", "fit"].includes(t)).join("\n");
  const budgetSummary = pick((t) => t === "budget").join("\n");
  const brandSummary = pick((t) => t === "brand").join("\n");
  const dislikesSummary = pick((t) => t === "dislike").join("\n");
  const logisticsSummary = pick((t) =>
    ["constraint", "profile", "recipient"].includes(t),
  ).join("\n");

  const summaryLines = rows.slice(0, 18).map((r) => `• ${r.value}`);
  const summary = summaryLines.join("\n");

  await prisma.shoppingProfileSummary.upsert({
    where: { userId },
    create: {
      userId,
      summary,
      styleSummary: styleSummary || null,
      sizingSummary: sizingSummary || null,
      budgetSummary: budgetSummary || null,
      brandSummary: brandSummary || null,
      dislikesSummary: dislikesSummary || null,
      logisticsSummary: logisticsSummary || null,
      version: 1,
    },
    update: {
      summary,
      styleSummary: styleSummary || null,
      sizingSummary: sizingSummary || null,
      budgetSummary: budgetSummary || null,
      brandSummary: brandSummary || null,
      dislikesSummary: dislikesSummary || null,
      logisticsSummary: logisticsSummary || null,
      version: { increment: 1 },
    },
  });
}
