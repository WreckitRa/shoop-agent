import { prisma } from "@/lib/ai-chat/db";
import type { ShoppingMemoryScope, ShoppingMemoryType } from "@prisma/client";

function slugKey(value: string, max = 48): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, max);
  return slug || "item";
}

/** Project typed onboarding tables into summary + canonical rows for the brain panel. */
export async function refreshTypedProfileIntoShoppingView(
  userId: string,
): Promise<void> {
  const [profile, sizing, tasteTags, brandPreferences, hardNegatives] =
    await Promise.all([
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.sizingProfile.findUnique({ where: { userId } }),
      prisma.tasteTag.findMany({
        where: { userId },
        orderBy: [{ polarity: "asc" }, { score: "desc" }],
        take: 48,
      }),
      prisma.brandPreference.findMany({
        where: { userId },
        orderBy: [{ sentiment: "asc" }, { strength: "desc" }],
        take: 32,
      }),
      prisma.hardNegative.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }],
        take: 32,
      }),
    ]);

  const identityLines: string[] = [];
  if (profile?.preferredName) identityLines.push(`Name: ${profile.preferredName}`);
  if (profile?.genderPresentation) {
    identityLines.push(`Presents as: ${profile.genderPresentation}`);
  }
  if (profile?.ageRange) identityLines.push(`Age range: ${profile.ageRange}`);
  if (profile?.shippingCountry || profile?.country) {
    identityLines.push(
      `Location/shipping: ${profile.shippingCountry ?? profile.country}`,
    );
  }
  if (profile?.currency) identityLines.push(`Currency: ${profile.currency}`);
  if (profile?.valuePhilosophy) {
    identityLines.push(`Value style: ${profile.valuePhilosophy}`);
  }

  const sizingLines: string[] = [];
  if (sizing?.topUsualSize) sizingLines.push(`Tops: ${sizing.topUsualSize}`);
  if (sizing?.bottomUsualSize) sizingLines.push(`Bottoms: ${sizing.bottomUsualSize}`);
  if (sizing?.shoeEU != null) sizingLines.push(`Shoes: EU ${sizing.shoeEU}`);
  else if (sizing?.shoeUS != null) sizingLines.push(`Shoes: US ${sizing.shoeUS}`);

  const posTaste = tasteTags.filter((t) => t.polarity === "positive");
  const negTaste = tasteTags.filter((t) => t.polarity === "negative");
  const styleSummary = [
    posTaste.length
      ? `Likes: ${posTaste.map((t) => t.tag).slice(0, 20).join(", ")}`
      : "",
    negTaste.length
      ? `Avoids: ${negTaste.map((t) => t.tag).slice(0, 20).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const loves = brandPreferences.filter(
    (b) => b.sentiment === "love" || b.sentiment === "like",
  );
  const avoids = brandPreferences.filter(
    (b) => b.sentiment === "avoid" || b.sentiment === "hate",
  );
  const brandSummary = [
    loves.length ? `Loves: ${loves.map((b) => b.brand).join(", ")}` : "",
    avoids.length ? `Avoids: ${avoids.map((b) => b.brand).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const dislikesSummary = [
    ...negTaste.map((t) => t.tag),
    ...hardNegatives.map((h) => h.value),
  ]
    .slice(0, 24)
    .join(", ");

  const summaryBullets = [
    ...identityLines.map((l) => `• ${l}`),
    ...sizingLines.map((l) => `• ${l}`),
    ...posTaste.slice(0, 8).map((t) => `• Likes ${t.tag}`),
    ...loves.slice(0, 6).map((b) => `• Brand: ${b.brand}`),
  ];
  const summary = summaryBullets.join("\n");

  await prisma.shoppingProfileSummary.upsert({
    where: { userId },
    create: {
      userId,
      summary,
      styleSummary: styleSummary || null,
      sizingSummary: sizingLines.join("\n") || null,
      budgetSummary: profile?.valuePhilosophy
        ? `Value philosophy: ${profile.valuePhilosophy}`
        : null,
      brandSummary: brandSummary || null,
      dislikesSummary: dislikesSummary || null,
      logisticsSummary: profile?.shippingCountry
        ? `Ships to: ${profile.shippingCountry}`
        : null,
      version: 1,
    },
    update: {
      summary,
      styleSummary: styleSummary || null,
      sizingSummary: sizingLines.join("\n") || null,
      budgetSummary: profile?.valuePhilosophy
        ? `Value philosophy: ${profile.valuePhilosophy}`
        : null,
      brandSummary: brandSummary || null,
      dislikesSummary: dislikesSummary || null,
      logisticsSummary: profile?.shippingCountry
        ? `Ships to: ${profile.shippingCountry}`
        : null,
      version: { increment: 1 },
    },
  });

  async function upsertMemory(params: {
    memoryKey: string;
    value: string;
    type: ShoppingMemoryType;
    scope: ShoppingMemoryScope;
    category?: string;
    brand?: string;
    isHardRule?: boolean;
  }) {
    const value = params.value.trim().slice(0, 2000);
    if (!value) return;
    await prisma.shoppingMemory.upsert({
      where: { userId_memoryKey: { userId, memoryKey: params.memoryKey } },
      create: {
        userId,
        memoryKey: params.memoryKey,
        value,
        type: params.type,
        scope: params.scope,
        category: params.category ?? null,
        brand: params.brand ?? null,
        confidence: 0.95,
        importance: 0.85,
        isHardRule: params.isHardRule ?? false,
        isActive: true,
        evidenceCount: 1,
      },
      update: {
        value,
        isActive: true,
        confidence: 0.95,
        evidenceCount: { increment: 1 },
      },
    });
  }

  if (profile?.preferredName) {
    await upsertMemory({
      memoryKey: "onboarding.profile.name",
      value: `Preferred name: ${profile.preferredName}`,
      type: "profile",
      scope: "global",
    });
  }
  if (profile?.genderPresentation) {
    await upsertMemory({
      memoryKey: "onboarding.profile.gender",
      value: `Gender presentation: ${profile.genderPresentation}`,
      type: "profile",
      scope: "global",
    });
  }
  if (profile?.ageRange) {
    await upsertMemory({
      memoryKey: "onboarding.profile.age_range",
      value: `Age range: ${profile.ageRange}`,
      type: "profile",
      scope: "global",
    });
  }
  if (profile?.valuePhilosophy) {
    await upsertMemory({
      memoryKey: "onboarding.profile.value",
      value: `Budget/value: ${profile.valuePhilosophy}`,
      type: "budget",
      scope: "global",
    });
  }

  if (sizing?.topUsualSize) {
    await upsertMemory({
      memoryKey: "onboarding.sizing.top",
      value: `Top size: ${sizing.topUsualSize}`,
      type: "size",
      scope: "category",
      category: "fashion",
    });
  }
  if (sizing?.bottomUsualSize) {
    await upsertMemory({
      memoryKey: "onboarding.sizing.bottom",
      value: `Bottom size: ${sizing.bottomUsualSize}`,
      type: "size",
      scope: "category",
      category: "fashion",
    });
  }
  if (sizing?.shoeEU != null) {
    await upsertMemory({
      memoryKey: "onboarding.sizing.shoe_eu",
      value: `Shoe size EU ${sizing.shoeEU}`,
      type: "size",
      scope: "category",
      category: "shoes",
    });
  }

  for (const t of posTaste.slice(0, 24)) {
    const cat = t.category || "global";
    await upsertMemory({
      memoryKey: `onboarding.taste.positive.${cat}.${slugKey(t.tag)}`,
      value: `Likes ${t.tag}`,
      type: "taste_tag",
      scope: t.scope === "category" ? "category" : "global",
      category: t.category || undefined,
    });
  }
  for (const t of negTaste.slice(0, 24)) {
    const cat = t.category || "global";
    await upsertMemory({
      memoryKey: `onboarding.taste.negative.${cat}.${slugKey(t.tag)}`,
      value: `Avoids ${t.tag}`,
      type: "dislike",
      scope: t.scope === "category" ? "category" : "global",
      category: t.category || undefined,
    });
  }

  for (const b of loves.slice(0, 16)) {
    await upsertMemory({
      memoryKey: `onboarding.brand.love.${slugKey(b.brand)}`,
      value: `Loves brand ${b.brand}`,
      type: "brand",
      scope: "brand",
      brand: b.brand,
    });
  }
  for (const b of avoids.slice(0, 16)) {
    await upsertMemory({
      memoryKey: `onboarding.brand.avoid.${slugKey(b.brand)}`,
      value: `Avoids brand ${b.brand}`,
      type: "dislike",
      scope: "brand",
      brand: b.brand,
    });
  }

  for (const h of hardNegatives.slice(0, 16)) {
    await upsertMemory({
      memoryKey: `onboarding.hard.${h.scope}.${slugKey(h.value)}`,
      value: `Never: ${h.value}`,
      type: "constraint",
      scope: "global",
      isHardRule: true,
    });
  }
}
