import { z } from "zod";
import { prisma } from "@/lib/ai-chat/db";
import {
  enqueueOnboardingExtraNotes,
  enqueueOnboardingProjection,
} from "@/lib/onboarding/background-jobs";
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

export async function applyOnboardingPatch(
  input: z.infer<typeof onboardingPatchSchema>,
  userId: string,
  options?: { extraNotes?: string; requestKey?: string; complete?: boolean },
) {
  const profileData = input.profile ? cleanObject(input.profile) : {};
  if (typeof profileData.currency === "string") {
    profileData.currency = profileData.currency.toUpperCase().slice(0, 6);
  }
  if (typeof profileData.birthDate === "string") {
    const d = new Date(profileData.birthDate);
    profileData.birthDate = Number.isNaN(d.getTime()) ? null : d;
  }
  if (input.profile?.styleMix !== undefined) {
    profileData.styleMix =
      input.profile.styleMix === null
        ? null
        : (input.profile.styleMix as InputJsonValue);
  }
  if (input.profile?.complimentPreferences !== undefined) {
    profileData.complimentPreferences = input.profile.complimentPreferences;
  }
  if (input.profile?.lifestyleTags !== undefined) {
    profileData.lifestyleTags = input.profile.lifestyleTags;
  }

  const sizingData = input.sizing ? cleanObject(input.sizing) : null;
  if (sizingData && input.sizing?.brandSizingNotes !== undefined) {
    sizingData.brandSizingNotes = (input.sizing.brandSizingNotes ?? []) as InputJsonValue;
  }

  await prisma.$transaction(
    async (tx) => {
    const profile = await tx.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...profileData,
        onboardingStarted: true,
        onboardingCompleted: options?.complete ?? false,
        onboardingProjectionVersion: 1,
        confidence: input.profile ? 1 : 0,
        evidenceCount: input.profile ? 1 : 0,
      },
      update: {
        ...profileData,
        onboardingStarted: true,
        ...(options?.complete ? { onboardingCompleted: true } : {}),
        onboardingProjectionVersion: { increment: 1 },
        ...(input.profile ? { confidence: 1 } : {}),
      },
    });
    if (
      options?.complete &&
      missingRequiredOnboardingFields(profile).length > 0
    ) {
      throw new Error("missing_required_onboarding_fields");
    }

    // Lazy ops — don't start queries until the batch runs (avoids stampeding
    // the interactive transaction and hitting the default 5s timeout).
    const writes: Array<() => Promise<unknown>> = [];
    if (sizingData) {
      writes.push(() =>
        tx.sizingProfile.upsert({
          where: { userId },
          create: { userId, ...sizingData, confidence: 1, evidenceCount: 1 },
          update: { ...sizingData, confidence: 1 },
        }),
      );
    }

    for (const b of input.brands ?? []) {
      const category = b.category?.trim() ?? "";
      writes.push(() =>
        tx.brandPreference.upsert({
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
          },
        }),
      );
    }

    for (const h of input.hardNegatives ?? []) {
      const category = h.category?.trim() ?? "";
      writes.push(() =>
        tx.hardNegative.upsert({
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
        }),
      );
    }

    for (const p of input.ownedProducts ?? []) {
      const category = p.category.trim();
      const subcategory = p.subcategory?.trim() ?? "";
      const brand = p.brand?.trim() ?? "";
      const productName = p.productName.trim();
      writes.push(() =>
        tx.ownedProduct.upsert({
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
          },
        }),
      );
    }

    for (const t of input.tasteTags ?? []) {
      const tag = t.tag.trim();
      const category = t.category?.trim() ?? "";
      const scope = category ? "category" : "global";
      writes.push(() =>
        tx.tasteTag.upsert({
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
          },
        }),
      );
    }

    const WRITE_BATCH = 8;
    for (let i = 0; i < writes.length; i += WRITE_BATCH) {
      const slice = writes.slice(i, i + WRITE_BATCH);
      await Promise.all(slice.map((run) => run()));
    }
    await enqueueOnboardingProjection(
      tx,
      userId,
      profile.onboardingProjectionVersion,
    );
    const extraNotes = options?.extraNotes?.trim();
    if (extraNotes) {
      await enqueueOnboardingExtraNotes(tx, {
        userId,
        requestKey: options?.requestKey ?? crypto.randomUUID(),
        text: extraNotes,
      });
    }
    },
    { maxWait: 10_000, timeout: 20_000 },
  );

  return getOnboardingStatus(userId);
}

export async function completeOnboarding(userId: string) {
  const completed = await prisma.$transaction(
    async (tx) => {
    const current = await tx.userProfile.findUnique({ where: { userId } });
    if (missingRequiredOnboardingFields(current).length > 0) return false;
    if (current?.onboardingCompleted) return true;

    const profile = await tx.userProfile.update({
      where: { userId },
      data: {
        onboardingStarted: true,
        onboardingCompleted: true,
        onboardingProjectionVersion: { increment: 1 },
      },
    });
    await enqueueOnboardingProjection(
      tx,
      userId,
      profile.onboardingProjectionVersion,
    );
    return true;
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
  const status = await getOnboardingStatus(userId);
  return completed
    ? { ok: true as const, status }
    : { ok: false as const, status };
}
