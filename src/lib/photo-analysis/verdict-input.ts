import { prisma } from "@/lib/ai-chat/db";
import { parseStylePhotoAnalysis } from "./result";
import { parseStyleUserReview } from "./review";
import { findByHash } from "./store";

export type VerdictMissing = { field: string; reason: string };

export function verdictReadiness(opts: {
  analysisUsable: boolean;
  reviewSubmitted: boolean;
  genderPresentation: string | null | undefined;
  lifestyle: string | null | undefined;
  heightCm: number | null | undefined;
}): VerdictMissing[] {
  const missing: VerdictMissing[] = [];
  if (!opts.analysisUsable) {
    missing.push({
      field: "photo_analysis",
      reason: "Need a usable photo analysis first.",
    });
  }
  if (!opts.reviewSubmitted) {
    missing.push({
      field: "user_review",
      reason: "Confirm or correct what I saw in the photo.",
    });
  }
  if (!opts.genderPresentation?.trim()) {
    missing.push({
      field: "gender_presentation",
      reason: "How you dress is still missing.",
    });
  }
  if (!opts.lifestyle?.trim()) {
    missing.push({
      field: "lifestyle",
      reason: "How your week actually looks is still missing.",
    });
  }
  if (opts.heightCm == null || !Number.isFinite(opts.heightCm) || opts.heightCm <= 0) {
    missing.push({
      field: "height",
      reason: "A declared height is still missing.",
    });
  }
  return missing;
}

function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export async function assembleVerdictInput(userId: string, photoHash: string) {
  const [row, profile, sizing, brands, hardNegatives, tasteTags] =
    await Promise.all([
      findByHash(userId, photoHash),
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.sizingProfile.findUnique({ where: { userId } }),
      prisma.brandPreference.findMany({ where: { userId } }),
      prisma.hardNegative.findMany({ where: { userId } }),
      prisma.tasteTag.findMany({ where: { userId } }),
    ]);

  const analysis = parseStylePhotoAnalysis(row?.result);
  const review = parseStyleUserReview(row?.userReview);
  const lifestyle =
    profile?.weekIs?.trim() ||
    profile?.dressingFor?.trim() ||
    profile?.lifestyleTags?.join(", ") ||
    null;

  const missing = verdictReadiness({
    analysisUsable: analysis?.analysis_status.usable === true,
    reviewSubmitted: review != null,
    genderPresentation: profile?.genderPresentation,
    lifestyle,
    heightCm: sizing?.heightCm,
  });

  const likes = brands
    .filter((b) => b.sentiment === "like" || b.sentiment === "love")
    .map((b) => b.brand);
  const avoids = [
    ...brands
    .filter((b) => b.sentiment === "avoid" || b.sentiment === "hate")
      .map((b) => b.brand),
    ...hardNegatives.map((h) => h.value),
  ];

  const questionnaireAnswers = compact({
    gender_presentation: profile?.genderPresentation ?? null,
    goal: profile?.dressingFor ?? null,
    lifestyle: compact({
      week_is: profile?.weekIs ?? null,
      kids: profile?.kids ?? null,
      occupation: profile?.occupation ?? null,
      work_environment: profile?.workEnvironment ?? null,
      lifestyle_tags: profile?.lifestyleTags ?? [],
    }),
    climate: profile?.climate ?? null,
    location: profile?.shippingCountry || profile?.country || null,
    budget: compact({
      currency: profile?.currency ?? null,
      philosophy: profile?.valuePhilosophy ?? null,
    }),
    taste: compact({
      style_era: profile?.styleEra ?? null,
      honesty: profile?.honestyPreference ?? null,
      compliments: profile?.complimentPreferences ?? [],
    }),
  });

  const measurements = compact({
    body: compact({
      height_cm: sizing?.heightCm ?? null,
      body_type: sizing?.bodyType ?? null,
      shoulder_width: sizing?.shoulderWidth ?? null,
      neck: sizing?.neckSize ?? null,
      sleeve: sizing?.sleeveLength ?? null,
      top_usual_size: sizing?.topUsualSize ?? null,
      bottom_waist: sizing?.bottomWaist ?? null,
      bottom_inseam: sizing?.bottomInseam ?? null,
      bottom_rise: sizing?.bottomRise ?? null,
      shoe_eu: sizing?.shoeEU ?? null,
      shoe_width: sizing?.shoeWidth ?? null,
    }),
    preferred_fit: compact({
      top: sizing?.topPreferredFit ?? null,
      bottom: sizing?.bottomPreferredFit ?? null,
    }),
    sensitivities: sizing?.sensitivities ?? [],
    known_good_garments: [],
  });

  const wardrobeInventory = compact({
    worn: tasteTags.filter((t) => t.category === "worn").map((t) => t.tag),
    wanted: tasteTags
      .filter((t) => t.category === "aspirational")
      .map((t) => t.tag),
    brands_like: likes,
    brands_avoid: avoids,
    comfort: tasteTags.filter((t) => t.category === "comfort").map((t) => t.tag),
  });

  const systems = [sizing ? profile?.unitsLength : null, profile?.unitsShoe]
    .filter((v): v is string => Boolean(v?.trim()));

  const applicationContext = compact({
    market: profile?.shippingCountry || profile?.country || null,
    preferred_size_systems: systems.length ? systems : ["EU", "international"],
  });

  return {
    row,
    analysis,
    review,
    missing,
    questionnaireAnswers,
    measurements,
    wardrobeInventory,
    applicationContext,
  };
}
