import { z } from "zod";
import { prisma } from "@/lib/ai-chat/db";
import { refreshTypedProfileIntoShoppingView } from "@/lib/onboarding/sync-profile-summary";
import { ownedProduct } from "@/lib/ai-chat/owned-product-db";
import {
  brandPreferencePostSchema,
  hardNegativePostSchema,
  ownedProductPostSchema,
  sizingProfilePatchSchema,
  userProfilePatchSchema,
} from "@/lib/ai-chat/profile/validators";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";

export const REQUIRED_ONBOARDING_FIELDS = [
  "preferredName",
  "genderPresentation",
  "ageRange",
] as const;

export type RequiredOnboardingField = (typeof REQUIRED_ONBOARDING_FIELDS)[number];

const tasteTagSchema = z
  .object({
    tag: z.string().min(1).max(80),
    polarity: z.enum(["positive", "negative"]),
    category: z.string().max(80).optional(),
  })
  .strict();

export const onboardingPatchSchema = z
  .object({
    profile: userProfilePatchSchema.optional(),
    sizing: sizingProfilePatchSchema.optional(),
    brands: z.array(brandPreferencePostSchema).max(20).optional(),
    hardNegatives: z.array(hardNegativePostSchema).max(20).optional(),
    ownedProducts: z.array(ownedProductPostSchema).max(12).optional(),
    tasteTags: z.array(tasteTagSchema).max(24).optional(),
  })
  .strict();

export const onboardingIntakeSchema = z
  .object({
    text: z.string().min(3).max(24_000),
  })
  .strict();

function cleanString(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t.length ? t : null;
}

function cleanObject<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = cleanString(value);
  }
  return out;
}

function isFilled(v: unknown): boolean {
  return typeof v === "string" ? v.trim().length > 0 : Boolean(v);
}

export function missingRequiredOnboardingFields(profile: {
  preferredName?: string | null;
  genderPresentation?: string | null;
  ageRange?: string | null;
} | null): RequiredOnboardingField[] {
  return REQUIRED_ONBOARDING_FIELDS.filter((field) => !isFilled(profile?.[field]));
}

async function getProfileBundle(userId: string) {
  const [
    profile,
    sizing,
    brandPreferences,
    hardNegatives,
    ownedProducts,
    tasteTags,
  ] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.sizingProfile.findUnique({ where: { userId } }),
    prisma.brandPreference.findMany({
      where: { userId },
      orderBy: [{ sentiment: "asc" }, { strength: "desc" }],
    }),
    prisma.hardNegative.findMany({
      where: { userId },
      orderBy: [{ scope: "asc" }, { value: "asc" }],
    }),
    ownedProduct.findMany({
      where: { userId },
      orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.tasteTag.findMany({
      where: { userId },
      orderBy: [{ polarity: "asc" }, { score: "desc" }],
    }),
  ]);

  return {
    profile,
    sizing,
    brandPreferences,
    hardNegatives,
    ownedProducts,
    tasteTags,
  };
}

export async function getOnboardingStatus(userId: string) {
  const bundle = await getProfileBundle(userId);
  const missingRequiredFields = missingRequiredOnboardingFields(bundle.profile);

  return {
    onboarding: {
      started: bundle.profile?.onboardingStarted ?? false,
      completed: bundle.profile?.onboardingCompleted ?? false,
      missingRequiredFields,
    },
    ...bundle,
  };
}

export async function markOnboardingStarted(userId: string) {
  await prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      onboardingStarted: true,
      confidence: 0,
      evidenceCount: 0,
    },
    update: { onboardingStarted: true },
  });
}

export async function applyOnboardingPatch(
  input: z.infer<typeof onboardingPatchSchema>,
  userId: string,
) {
  await markOnboardingStarted(userId);

  if (input.profile) {
    const data = cleanObject(input.profile);
    if (typeof data.currency === "string") {
      data.currency = data.currency.toUpperCase().slice(0, 6);
    }
    if (typeof data.birthDate === "string") {
      const d = new Date(data.birthDate);
      data.birthDate = Number.isNaN(d.getTime()) ? null : d;
    }

    await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...data,
        onboardingStarted: true,
        confidence: 1,
        evidenceCount: 1,
      },
      update: {
        ...data,
        onboardingStarted: true,
        confidence: 1,
        evidenceCount: { increment: 1 },
      },
    });
  }

  if (input.sizing) {
    const data = cleanObject(input.sizing);
    if (input.sizing.brandSizingNotes !== undefined) {
      data.brandSizingNotes = (input.sizing.brandSizingNotes ?? []) as InputJsonValue;
    }

    await prisma.sizingProfile.upsert({
      where: { userId },
      create: { userId, ...data, confidence: 1, evidenceCount: 1 },
      update: { ...data, confidence: 1, evidenceCount: { increment: 1 } },
    });
  }

  for (const b of input.brands ?? []) {
    const category = b.category?.trim() ?? "";
    await prisma.brandPreference.upsert({
      where: {
        userId_brand_category: { userId, brand: b.brand.trim(), category },
      },
      create: {
        userId,
        brand: b.brand.trim(),
        category,
        sentiment: b.sentiment,
        strength: b.strength ?? 0.75,
        reasons: b.reasons ?? [],
        ownsProducts: b.ownsProducts ?? false,
        aspirational: b.aspirational ?? false,
        confidence: 1,
        evidenceCount: 1,
      },
      update: {
        sentiment: b.sentiment,
        strength: b.strength ?? undefined,
        reasons: b.reasons ?? undefined,
        ownsProducts: b.ownsProducts ?? undefined,
        aspirational: b.aspirational ?? undefined,
        confidence: 1,
        evidenceCount: { increment: 1 },
      },
    });
  }

  for (const h of input.hardNegatives ?? []) {
    const category = h.category?.trim() ?? "";
    await prisma.hardNegative.upsert({
      where: {
        userId_scope_value_category: {
          userId,
          scope: h.scope,
          value: h.value.trim(),
          category,
        },
      },
      create: {
        userId,
        scope: h.scope,
        value: h.value.trim(),
        category,
        reason: h.reason ?? null,
        note: h.note ?? null,
      },
      update: {
        reason: h.reason ?? undefined,
        note: h.note ?? undefined,
      },
    });
  }

  for (const p of input.ownedProducts ?? []) {
    const category = p.category.trim();
    const subcategory = p.subcategory?.trim() ?? "";
    const brand = p.brand?.trim() ?? "";
    const productName = p.productName.trim();
    await ownedProduct.upsert({
      where: {
        userId_category_subcategory_brand_productName: {
          userId,
          category,
          subcategory,
          brand,
          productName,
        },
      },
      create: {
        userId,
        category,
        subcategory,
        brand,
        productName,
        model: p.model?.trim() ?? "",
        attributes: (p.attributes ?? {}) as object,
        acquiredAt: p.acquiredAt ? new Date(p.acquiredAt) : null,
        acquiredNote: p.acquiredNote ?? null,
        isCurrent: p.isCurrent ?? true,
        notes: p.notes ?? null,
        confidence: 1,
        evidenceCount: 1,
      },
      update: {
        model: p.model?.trim() ?? undefined,
        attributes: p.attributes as object | undefined,
        acquiredAt: p.acquiredAt ? new Date(p.acquiredAt) : undefined,
        acquiredNote: p.acquiredNote ?? undefined,
        isCurrent: p.isCurrent ?? undefined,
        notes: p.notes ?? undefined,
        confidence: 1,
        evidenceCount: { increment: 1 },
      },
    });
  }

  for (const t of input.tasteTags ?? []) {
    const tag = t.tag.trim();
    const category = t.category?.trim() ?? "";
    const scope = category ? "category" : "global";
    await prisma.tasteTag.upsert({
      where: {
        userId_scope_category_tag_polarity: {
          userId,
          scope,
          category,
          tag,
          polarity: t.polarity,
        },
      },
      create: {
        userId,
        scope,
        category,
        tag,
        polarity: t.polarity,
        score: 0.8,
        evidenceCount: 1,
      },
      update: {
        score: 0.9,
        evidenceCount: { increment: 1 },
      },
    });
  }

  await refreshTypedProfileIntoShoppingView(userId).catch(() => {});

  return getOnboardingStatus(userId);
}

export async function completeOnboarding(userId: string) {
  const status = await getOnboardingStatus(userId);
  if (status.onboarding.missingRequiredFields.length > 0) {
    return { ok: false as const, status };
  }

  await prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      onboardingStarted: true,
      onboardingCompleted: true,
      confidence: 1,
      evidenceCount: 1,
    },
    update: {
      onboardingStarted: true,
      onboardingCompleted: true,
    },
  });

  await refreshTypedProfileIntoShoppingView(userId).catch(() => {});

  return { ok: true as const, status: await getOnboardingStatus(userId) };
}
