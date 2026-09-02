import { buildOutfitGridDeck } from "@/lib/onboarding/outfit-grid";
import { buildPatchFromTastePicks } from "@/lib/onboarding/taste-persist";
import { getAuthContext } from "@/lib/auth/session";
import {
  applyOnboardingPatch,
  getOnboardingStatus,
} from "@/lib/onboarding/status";
import { kickOnboardingJobWorker } from "@/lib/onboarding/background-jobs";
import { findSeedBrand } from "@/lib/onboarding/brand-catalog";
import { rememberCommunityBrand } from "@/lib/onboarding/onboarding-brand-db";
import {
  tasteDeckQuerySchema,
  tastePostSchema,
} from "@/lib/onboarding/request-schemas";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function splitCsv(value?: string): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const url = new URL(req.url);
    const parsedQuery = tasteDeckQuerySchema.safeParse({
      mode: url.searchParams.get("mode") ?? "worn",
      genderPresentation: url.searchParams.get("genderPresentation") ?? undefined,
      styleEra: url.searchParams.get("styleEra") ?? undefined,
      lifestyleTags: url.searchParams.get("lifestyleTags") ?? undefined,
      valuePhilosophy: url.searchParams.get("valuePhilosophy") ?? undefined,
      brandLikes: url.searchParams.get("brandLikes") ?? undefined,
      brandAvoids: url.searchParams.get("brandAvoids") ?? undefined,
      shippingCountry: url.searchParams.get("shippingCountry") ?? undefined,
      currency: url.searchParams.get("currency") ?? undefined,
      wornLabels: url.searchParams.get("wornLabels") ?? undefined,
      wornTasteTags: url.searchParams.get("wornTasteTags") ?? undefined,
      wornLookIds: url.searchParams.get("wornLookIds") ?? undefined,
      excludeLookIds: url.searchParams.get("excludeLookIds") ?? undefined,
    });

    if (!parsedQuery.success) {
      return Response.json(
        { error: "Invalid query.", issues: parsedQuery.error.flatten() },
        { status: 400 },
      );
    }

    const q = parsedQuery.data;
    const status = await getOnboardingStatus(userId);
    const profile = status.profile;

    const ctx = {
      mode: q.mode,
      genderPresentation:
        q.genderPresentation?.trim() ||
        profile?.genderPresentation ||
        undefined,
      styleEra: q.styleEra?.trim() || profile?.styleEra || undefined,
      lifestyleTags:
        splitCsv(q.lifestyleTags).length > 0
          ? splitCsv(q.lifestyleTags)
          : profile?.lifestyleTags ?? undefined,
      valuePhilosophy:
        q.valuePhilosophy?.trim() ||
        profile?.valuePhilosophy ||
        undefined,
      brandLikes:
        q.brandLikes?.trim() ||
        status.brandPreferences
          .filter((b) => b.sentiment === "love" || b.sentiment === "like")
          .map((b) => b.brand)
          .join(", ") ||
        undefined,
      brandAvoids:
        q.brandAvoids?.trim() ||
        status.brandPreferences
          .filter((b) => b.sentiment === "avoid" || b.sentiment === "hate")
          .map((b) => b.brand)
          .join(", ") ||
        undefined,
      shippingCountry:
        q.shippingCountry?.trim() ||
        profile?.shippingCountry ||
        profile?.country ||
        undefined,
      currency: q.currency?.trim() || profile?.currency || undefined,
      wornLabels: splitCsv(q.wornLabels),
      wornTasteTags: splitCsv(q.wornTasteTags),
      wornLookIds: splitCsv(q.wornLookIds),
      excludeLookIds: splitCsv(q.excludeLookIds),
      shuffleSeed: userId,
    };

    const { deck, hasMore } = await buildOutfitGridDeck(ctx, {
      signal: req.signal,
    });

    return Response.json({
      source: "inhouse_catalog",
      mode: ctx.mode,
      hasMore,
      deck: deck.map((c) => ({
        id: c.id,
        productId: c.productId,
        label: c.label,
        title: c.title,
        imageUrl: c.imageUrl,
        tasteTags: c.tasteTags,
        mode: c.mode,
        archetype: c.archetype,
        cell: c.cell,
      })),
      contextUsed: ctx,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not build outfit grid.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = tastePostSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid body.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const patch = buildPatchFromTastePicks(parsed.data);
    const status = await applyOnboardingPatch(patch, userId, {
      complete: parsed.data.complete,
    });
    after(() => {
      kickOnboardingJobWorker();
      const typed = [
        ...(parsed.data.brandLikes ?? []),
        ...(parsed.data.brandAvoids ?? []),
      ];
      for (const name of typed) {
        if (findSeedBrand(name)) continue;
        void rememberCommunityBrand(name);
      }
    });

    return Response.json({
      saved: true,
      styleMix: status.profile?.styleMix ?? patch.profile?.styleMix ?? null,
      ...status,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "missing_required_onboarding_fields"
    ) {
      return Response.json(
        { error: "Required onboarding fields are missing." },
        { status: 400 },
      );
    }
    return Response.json({ error: "Could not save taste picks." }, { status: 500 });
  }
}
