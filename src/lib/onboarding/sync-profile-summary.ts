import { prisma } from "@/lib/ai-chat/db";
import type { ShoppingMemoryScope, ShoppingMemoryType } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  loadOnboardingProjectionSnapshot,
  type OnboardingProjectionSnapshot,
} from "@/lib/onboarding/projection-snapshot";

function slugKey(value: string, max = 48): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, Math.max(8, max - 9));
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `${slug || "item"}_${hash}`;
}

/** Project typed onboarding tables into summary + canonical rows for the brain panel. */
export async function refreshTypedProfileIntoShoppingView(
  userId: string,
  suppliedSnapshot?: OnboardingProjectionSnapshot,
): Promise<void> {
  const [snapshot, currentSummary] = await Promise.all([
    suppliedSnapshot
      ? Promise.resolve(suppliedSnapshot)
      : loadOnboardingProjectionSnapshot(userId),
    prisma.shoppingProfileSummary.findUnique({ where: { userId } }),
  ]);
  const { profile, sizing, tasteTags, brandPreferences, hardNegatives } =
    snapshot;

  const identityLines: string[] = [];
  if (profile?.preferredName) identityLines.push(`Name: ${profile.preferredName}`);
  if (profile?.genderPresentation) {
    identityLines.push(`Presents as: ${profile.genderPresentation}`);
  }
  if (profile?.ageRange) identityLines.push(`Age range: ${profile.ageRange}`);
  if (profile?.styleEra) identityLines.push(`Style era: ${profile.styleEra}`);
  if (profile?.lifestyleTags?.length) {
    identityLines.push(`World: ${profile.lifestyleTags.join(", ")}`);
  }
  if (profile?.shippingCountry || profile?.country) {
    identityLines.push(
      `Location/shipping: ${[profile.city, profile.shippingCountry ?? profile.country].filter(Boolean).join(", ")}`,
    );
  }
  if (profile?.currency) identityLines.push(`Currency: ${profile.currency}`);
  if (profile?.valuePhilosophy) {
    identityLines.push(`Value style: ${profile.valuePhilosophy}`);
  }
  if (profile?.honestyPreference) {
    identityLines.push(`Honesty: ${profile.honestyPreference}`);
  }
  if (profile?.complimentPreferences?.length) {
    identityLines.push(
      `Compliments: ${profile.complimentPreferences.join(", ")}`,
    );
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

  const summaryData = {
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
  };
  const summaryChanged =
    !currentSummary ||
    Object.entries(summaryData).some(
      ([key, value]) =>
        currentSummary[key as keyof typeof summaryData] !== value,
    );
  if (summaryChanged) {
    await prisma.shoppingProfileSummary.upsert({
      where: { userId },
      create: { userId, ...summaryData, version: 1 },
      update: { ...summaryData, version: { increment: 1 } },
    });
  }

  const memoryWrites: Promise<unknown>[] = [];
  const expectedMemoryKeys = new Set<string>();
  function upsertMemory(params: {
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
    expectedMemoryKeys.add(params.memoryKey);
    memoryWrites.push(prisma.shoppingMemory.upsert({
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
      },
    }));
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
      memoryKey: `onboarding.brand.love.${slugKey(`${b.category}:${b.brand}`)}`,
      value: `Loves brand ${b.brand}`,
      type: "brand",
      scope: "brand",
      brand: b.brand,
    });
  }
  for (const b of avoids.slice(0, 16)) {
    await upsertMemory({
      memoryKey: `onboarding.brand.avoid.${slugKey(`${b.category}:${b.brand}`)}`,
      value: `Avoids brand ${b.brand}`,
      type: "dislike",
      scope: "brand",
      brand: b.brand,
    });
  }

  for (const h of hardNegatives.slice(0, 16)) {
    await upsertMemory({
      memoryKey: `onboarding.hard.${h.scope}.${slugKey(`${h.category}:${h.value}`)}`,
      value: `Never: ${h.value}`,
      type: "constraint",
      scope: "global",
      isHardRule: true,
    });
  }

  await Promise.all(memoryWrites);
  const stale = await prisma.shoppingMemory.findMany({
    where: {
      userId,
      memoryKey: { startsWith: "onboarding." },
      isActive: true,
    },
    select: { memoryKey: true },
  });
  const staleKeys = stale
    .map((row) => row.memoryKey)
    .filter((key) => !expectedMemoryKeys.has(key));
  if (staleKeys.length > 0) {
    await prisma.shoppingMemory.updateMany({
      where: { userId, memoryKey: { in: staleKeys } },
      data: { isActive: false },
    });
  }
}
