import { z } from "zod";
import {
  buildCatalogTasteDeck,
  type TasteDeckContext,
} from "@/lib/onboarding/taste-catalog";
import { buildPatchFromTasteSwipes } from "@/lib/onboarding/taste-persist";
import { getAuthContext } from "@/lib/auth/session";
import {
  applyOnboardingPatch,
  getOnboardingStatus,
} from "@/lib/onboarding/status";
import { kickOnboardingJobWorker } from "@/lib/onboarding/background-jobs";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deckQuerySchema = z
  .object({
    styleLikes: z.string().optional(),
    styleAvoids: z.string().optional(),
    brandLikes: z.string().optional(),
    brandAvoids: z.string().optional(),
    genderPresentation: z.string().optional(),
    valuePhilosophy: z.string().optional(),
    shippingCountry: z.string().optional(),
    currency: z.string().optional(),
    topSize: z.string().optional(),
  })
  .optional();

const swipeSchema = z
  .object({
    cardId: z.string().min(1).max(256),
    swipe: z.enum(["like", "dislike", "neutral"]),
    tasteTags: z.array(z.string().max(80)).max(16).optional(),
    productTitle: z.string().max(280).optional(),
    category: z
      .enum(["outfit", "furniture", "tech", "lifestyle", "personality"])
      .optional(),
  })
  .strict();

const postSchema = z
  .object({
    responses: z.array(swipeSchema).max(40),
    complete: z.boolean().optional(),
  })
  .strict();

function contextFromStatus(
  query: z.infer<typeof deckQuerySchema>,
  status: Awaited<ReturnType<typeof getOnboardingStatus>>,
): TasteDeckContext {
  if (query) return query;
  const profile = status.profile;
  const tasteTags = status.tasteTags ?? [];
  return {
    styleLikes: tasteTags
      .filter((t) => t.polarity === "positive")
      .map((t) => t.tag)
      .join(", "),
    styleAvoids: tasteTags
      .filter((t) => t.polarity === "negative")
      .map((t) => t.tag)
      .join(", "),
    brandLikes: status.brandPreferences
      .filter((b) => b.sentiment === "love" || b.sentiment === "like")
      .map((b) => b.brand)
      .join(", "),
    brandAvoids: status.brandPreferences
      .filter((b) => b.sentiment === "avoid" || b.sentiment === "hate")
      .map((b) => b.brand)
      .join(", "),
    genderPresentation: profile?.genderPresentation ?? undefined,
    valuePhilosophy: profile?.valuePhilosophy ?? undefined,
    shippingCountry: profile?.shippingCountry ?? profile?.country ?? undefined,
    currency: profile?.currency ?? undefined,
  };
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const url = new URL(req.url);
    const parsedQuery = deckQuerySchema.safeParse({
      styleLikes: url.searchParams.get("styleLikes") ?? undefined,
      styleAvoids: url.searchParams.get("styleAvoids") ?? undefined,
      brandLikes: url.searchParams.get("brandLikes") ?? undefined,
      brandAvoids: url.searchParams.get("brandAvoids") ?? undefined,
      genderPresentation: url.searchParams.get("genderPresentation") ?? undefined,
      valuePhilosophy: url.searchParams.get("valuePhilosophy") ?? undefined,
      shippingCountry: url.searchParams.get("shippingCountry") ?? undefined,
      currency: url.searchParams.get("currency") ?? undefined,
      topSize: url.searchParams.get("topSize") ?? undefined,
    });

    const suppliedContext =
      parsedQuery.success &&
      parsedQuery.data &&
      Object.values(parsedQuery.data).some((value) => Boolean(value?.trim()))
        ? parsedQuery.data
        : undefined;
    const ctx = suppliedContext
      ? suppliedContext
      : contextFromStatus(undefined, await getOnboardingStatus(userId));

    const deck = await buildCatalogTasteDeck(ctx, { signal: req.signal });

    return Response.json({
      source: "shopify_catalog",
      deck: deck.map((c) => ({
        id: c.id,
        productId: c.productId,
        category: c.category,
        categoryLabel: c.categoryLabel,
        title: c.title,
        subtitle: c.subtitle,
        imageUrl: c.imageUrl,
        tasteTags: c.tasteTags,
      })),
      contextUsed: ctx,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not build taste deck.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body.", issues: parsed.error.flatten() }, { status: 400 });
    }

    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const patch = buildPatchFromTasteSwipes(parsed.data.responses);
    const status = await applyOnboardingPatch(patch, userId, {
      complete: parsed.data.complete,
    });
    after(kickOnboardingJobWorker);

    return Response.json({
      saved: parsed.data.responses.filter((r) => r.swipe !== "neutral").length,
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
    return Response.json({ error: "Could not save taste swipes." }, { status: 500 });
  }
}
