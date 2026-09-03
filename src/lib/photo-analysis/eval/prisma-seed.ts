import { PHOTO_ANALYSIS_ENGINE_VERSION } from "../types";
import { buildVerdictPayload } from "../verdict-input";

export type EvalVerdictSeedSpec = {
  id: string;
  gender: "masculine" | "feminine";
  taste: "minimal" | "bold";
  photo: boolean;
  weekendsAre: string;
  weekIs: string;
  styleFriction: string;
  styleBecome: string;
  vetoes: Array<{
    value: string;
    scope: "style" | "fit";
    note?: string;
    reason?: "taste" | "health" | "past_bad_experience";
  }>;
  brands: Array<{
    brand: string;
    sentiment: "love" | "avoid";
    reasons: string[];
  }>;
  worn: string[];
  heightCm: number;
};

export const EVAL_VERDICT_SEED_USER_PREFIX = "eval-verdict:";

export function evalVerdictSeedUserId(id: string): string {
  return `${EVAL_VERDICT_SEED_USER_PREFIX}${id}`;
}

export const EVAL_VERDICT_SEED_SPECS: EvalVerdictSeedSpec[] = [
  {
    id: "male-minimal-photo",
    gender: "masculine",
    taste: "minimal",
    photo: true,
    weekIs: "working_mixed",
    weekendsAre: "home,errands",
    styleFriction: "hoodies every day",
    styleBecome: "quietly put-together",
    vetoes: [
      { value: "heels", scope: "fit", note: "comfort", reason: "health" },
      { value: "logos", scope: "style", note: "reads cheap on me", reason: "taste" },
    ],
    brands: [{ brand: "COS", sentiment: "love", reasons: ["clean cuts"] }],
    worn: ["grey tee", "navy knit"],
    heightCm: 180,
  },
  {
    id: "male-bold-photo",
    gender: "masculine",
    taste: "bold",
    photo: true,
    weekIs: "working_onsite",
    weekendsAre: "nightlife,friends",
    styleFriction: "everything black",
    styleBecome: "bolder nights",
    vetoes: [
      { value: "skinny jeans", scope: "style", note: "clings through the thigh", reason: "taste" },
    ],
    brands: [{ brand: "Ami", sentiment: "love", reasons: ["one loud knit"] }],
    worn: ["print shirt"],
    heightCm: 178,
  },
  {
    id: "female-minimal-photo",
    gender: "feminine",
    taste: "minimal",
    photo: true,
    weekIs: "working_home",
    weekendsAre: "home,family",
    styleFriction: "optical white up top",
    styleBecome: "quiet luxury",
    vetoes: [
      { value: "heels", scope: "fit", note: "cannot walk in them", reason: "health" },
    ],
    brands: [{ brand: "The Row", sentiment: "love", reasons: ["weight of the cloth"] }],
    worn: ["black knit"],
    heightCm: 168,
  },
  {
    id: "female-bold-photo",
    gender: "feminine",
    taste: "bold",
    photo: true,
    weekIs: "own_thing",
    weekendsAre: "nightlife,travel",
    styleFriction: "mid-calf hems",
    styleBecome: "nights out",
    vetoes: [
      { value: "cling", scope: "fit", note: "comfort", reason: "health" },
    ],
    brands: [{ brand: "Ganni", sentiment: "love", reasons: ["print that moves"] }],
    worn: ["sequin top"],
    heightCm: 165,
  },
  {
    id: "male-minimal-nophoto",
    gender: "masculine",
    taste: "minimal",
    photo: false,
    weekIs: "studying",
    weekendsAre: "outdoors,friends",
    styleFriction: "logo tees",
    styleBecome: "value without looking cheap",
    vetoes: [
      { value: "logos", scope: "style", note: "I already own too many", reason: "taste" },
    ],
    brands: [{ brand: "Uniqlo", sentiment: "love", reasons: ["price holds"] }],
    worn: ["grey tee"],
    heightCm: 176,
  },
  {
    id: "female-bold-nophoto",
    gender: "feminine",
    taste: "bold",
    photo: false,
    weekIs: "working_mixed",
    weekendsAre: "friends,travel",
    styleFriction: "tight dresses",
    styleBecome: "sharper waist",
    vetoes: [
      { value: "tight dresses", scope: "fit", note: "comfort", reason: "health" },
    ],
    brands: [{ brand: "Zara", sentiment: "avoid", reasons: ["falls apart"] }],
    worn: ["print blouse"],
    heightCm: 170,
  },
];

const STUB_ANALYSIS = {
  analysis_status: { usable: true, summary: "eval seed" },
  capture_quality: {},
  declared_context_used: {},
  visible_profile: {},
  outfit_analysis: [],
  preliminary_styling_implications: [],
  missing_information: [],
  follow_up_questions: [],
  requested_measurements: [],
  requested_additional_photos: [],
  final_summary: {},
};

const STUB_REVIEW = {
  confirmed_paths: ["visible_profile"],
  corrections: [],
  rejected_paths: [],
  notes: [],
  submitted_at: "2026-09-02T00:00:00.000Z",
  confirmed_body: {
    height_cm: 180,
    weight_kg: 72,
    body_type: "athletic",
    muscularity: null,
    body_shape: null,
    bust_fullness: null,
    leg_line: null,
  },
};

export function payloadInputFromSeedSpec(spec: EvalVerdictSeedSpec) {
  return {
    profile: {
      genderPresentation: spec.gender === "masculine" ? "menswear" : "womenswear",
      ageRange: "25-34",
      styleEra: spec.taste === "bold" ? "23_29" : "30s",
      weekIs: spec.weekIs,
      weekendsAre: spec.weekendsAre,
      dressingFor: "with_someone",
      kids: "none",
      climate: "four_seasons",
      honestyPreference: "5",
      styleFriction: spec.styleFriction,
      styleBecome: spec.styleBecome,
      styleMix: {
        axes: [
          {
            label: spec.taste === "bold" ? "Bold" : "Minimal",
            percent: 60,
          },
          { label: "Classic", percent: 40 },
        ],
      },
    },
    sizing: { heightCm: spec.heightCm, weightKg: 72, bodyType: "athletic" },
    brands: spec.brands,
    hardNegatives: spec.vetoes,
    tasteTags: spec.worn.map((tag) => ({ tag, category: "worn" })),
    confirmedBody: spec.photo
      ? {
          height_cm: spec.heightCm,
          weight_kg: 72,
          body_type: "athletic",
          muscularity: null,
          body_shape: null,
          bust_fullness: null,
          leg_line: null,
        }
      : null,
  };
}

export function buildSeedPayload(spec: EvalVerdictSeedSpec) {
  return buildVerdictPayload(payloadInputFromSeedSpec(spec));
}

export async function seedEvalVerdictProfiles() {
  const { prisma } = await import("@/lib/ai-chat/db");
  for (const spec of EVAL_VERDICT_SEED_SPECS) {
    const userId = evalVerdictSeedUserId(spec.id);
    await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        genderPresentation: spec.gender === "masculine" ? "menswear" : "womenswear",
        ageRange: "25-34",
        weekIs: spec.weekIs,
        weekendsAre: spec.weekendsAre,
        dressingFor: "with_someone",
        kids: "none",
        climate: "four_seasons",
        honestyPreference: "5",
        styleFriction: spec.styleFriction,
        styleBecome: spec.styleBecome,
        styleMix: {
          axes: [
            {
              label: spec.taste === "bold" ? "Bold" : "Minimal",
              percent: 60,
            },
            { label: "Classic", percent: 40 },
          ],
        },
      },
      update: {
        genderPresentation: spec.gender === "masculine" ? "menswear" : "womenswear",
        weekIs: spec.weekIs,
        weekendsAre: spec.weekendsAre,
        styleFriction: spec.styleFriction,
        styleBecome: spec.styleBecome,
      },
    });
    await prisma.sizingProfile.upsert({
      where: { userId },
      create: {
        userId,
        heightCm: spec.heightCm,
        weightKg: 72,
        bodyType: "athletic",
      },
      update: { heightCm: spec.heightCm },
    });
    await prisma.hardNegative.deleteMany({ where: { userId } });
    for (const v of spec.vetoes) {
      await prisma.hardNegative.create({
        data: {
          userId,
          scope: v.scope,
          value: v.value,
          note: v.note,
          reason: v.reason,
        },
      });
    }
    await prisma.brandPreference.deleteMany({ where: { userId } });
    for (const b of spec.brands) {
      await prisma.brandPreference.create({
        data: {
          userId,
          brand: b.brand,
          sentiment: b.sentiment,
          reasons: b.reasons,
        },
      });
    }
    await prisma.tasteTag.deleteMany({ where: { userId } });
    for (const tag of spec.worn) {
      await prisma.tasteTag.create({
        data: {
          userId,
          scope: "global",
          category: "worn",
          tag,
          polarity: "positive",
        },
      });
    }
    const photoHash = `eval-${spec.id}`;
    await prisma.photoAnalysis.deleteMany({ where: { userId } });
    if (spec.photo) {
      await prisma.photoAnalysis.create({
        data: {
          userId,
          photoHash,
          status: "done",
          verdictStatus: "idle",
          engineVersion: PHOTO_ANALYSIS_ENGINE_VERSION,
          result: STUB_ANALYSIS,
          userReview: {
            ...STUB_REVIEW,
            confirmed_body: {
              ...STUB_REVIEW.confirmed_body,
              height_cm: spec.heightCm,
            },
          },
        },
      });
    }
  }
}
