import { prisma } from "@/lib/ai-chat/db";
import { ownedProduct } from "@/lib/ai-chat/owned-product-db";
import { userProfilePatchSchema } from "@/lib/ai-chat/profile/validators";
import { getAuthContext } from "@/lib/auth/session";
import {
  catalogLocalizationFromProfile,
  resolveCatalogLocalization,
} from "@/lib/shopify/catalog-localization";
import { loadDefaultSavedAddressLocale } from "@/lib/shopify/default-saved-address";
import { detectRequestArea } from "@/lib/server/request-area";
import { assertSignupAge } from "@/lib/legal/age-gate";
import { closeIfUnderageBirthDate } from "@/lib/legal/close-account";

/**
 * GET /api/profile
 *
 * Returns the full typed shopper profile in one payload:
 *   identity (UserProfile), sizing (SizingProfile), category preferences,
 *   brand graph, recipients, active intents, taste tags, and hard rules.
 *
 * Designed to back a "Your shopping profile" settings screen.
 */
export async function GET(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const now = new Date();

    const [
      profile,
      sizing,
      categoryPreferences,
      brandPreferences,
      recipients,
      intents,
      tasteTags,
      hardNegatives,
      ownedProducts,
      savedAddress,
    ] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.sizingProfile.findUnique({ where: { userId } }),
      prisma.categoryPreference.findMany({
        where: { userId },
        orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      }),
      prisma.brandPreference.findMany({
        where: { userId },
        orderBy: [{ sentiment: "asc" }, { strength: "desc" }],
      }),
      prisma.recipient.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }],
      }),
      prisma.shoppingIntent.findMany({
        where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
      }),
      prisma.tasteTag.findMany({
        where: { userId },
        orderBy: [{ polarity: "asc" }, { score: "desc" }, { evidenceCount: "desc" }],
      }),
      prisma.hardNegative.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }],
      }),
      ownedProduct.findMany({
        where: { userId },
        orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
      }),
      loadDefaultSavedAddressLocale(userId),
    ]);

    const profileLocalization = catalogLocalizationFromProfile(
      profile ?? {},
      savedAddress,
    );
    const detectedArea = detectRequestArea(req.headers);
    const usesDetectedArea = !profileLocalization.countryCode && detectedArea;
    const catalogLocalization = usesDetectedArea
      ? {
            ...resolveCatalogLocalization(detectedArea.countryCode, null),
            currency: profileLocalization.currency,
        }
      : profileLocalization;

    return Response.json({
      profile,
      catalogLocalization,
      catalogLocalizationSource: usesDetectedArea ? "ip" : "profile",
      detectedArea,
      sizing,
      categoryPreferences,
      brandPreferences,
      recipients,
      intents,
      tasteTags,
      hardNegatives,
      ownedProducts,
    });
  } catch {
    return Response.json({ error: "Could not load profile." }, { status: 500 });
  }
}

/**
 * PATCH /api/profile
 *
 * Edit identity / lifestyle / value-philosophy fields on UserProfile.
 * Field-level: only keys present in the body are updated. `null` clears.
 */
export async function PATCH(req: Request) {
  try {
    const raw = await req.json();
    const parsed = userProfilePatchSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body.", issues: parsed.error.flatten() }, { status: 400 });
    }

    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const body = parsed.data;

    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      if (k === "birthDate" && typeof v === "string") {
        if (await closeIfUnderageBirthDate(userId, v.slice(0, 10))) {
          return Response.json(
            { error: "This account has been closed.", closed: true },
            { status: 403 },
          );
        }
        const age = assertSignupAge(v.slice(0, 10));
        if (!age.ok) {
          return Response.json({ error: age.error }, { status: 403 });
        }
        data[k] = new Date(`${age.birthDate}T00:00:00.000Z`);
        continue;
      }
      if (k === "currency" && typeof v === "string") {
        data[k] = v.toUpperCase().slice(0, 6);
        continue;
      }
      data[k] = v;
    }

    const row = await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...data, confidence: 1, evidenceCount: 1 },
      update: {
        ...data,
        confidence: 1,
        evidenceCount: { increment: 1 },
      },
    });

    return Response.json({ profile: row });
  } catch {
    return Response.json({ error: "Could not update profile." }, { status: 500 });
  }
}
