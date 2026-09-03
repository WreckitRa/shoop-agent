import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FITTING_STEPS,
  fittingBackTarget,
  type FittingStep,
} from "@/components/onboarding/fitting/types";
import {
  firstIncompleteFittingStep,
  resolveFittingResumeStep,
  type ResumeStatus,
} from "@/components/onboarding/fitting/resume-step";
import { GET as onboardingGET, POST as onboardingPOST } from "@/app/api/onboarding/route";
import { POST as reviewPOST } from "@/app/api/onboarding/review/route";
import { GET as tasteGET, POST as tastePOST } from "@/app/api/onboarding/taste/route";
import { POST as circlePOST } from "@/app/api/onboarding/circle/route";
import { POST as tellPOST } from "@/app/api/onboarding/fitting-tell/route";
import { GET as brandsGET, POST as brandsPOST } from "@/app/api/onboarding/brands/route";
import { POST as verdictPOST } from "@/app/api/onboarding/stylist-verdict/route";
import { GET as photoGET } from "@/app/api/onboarding/photo-analysis/route";
import { GET as looksGET } from "@/app/api/onboarding/reading-looks/route";
import {
  brandsPostSchema,
  circlePostSchema,
  fittingTellPostSchema,
  reviewPostSchema,
  tasteDeckQuerySchema,
  tastePostSchema,
} from "./request-schemas";
import { onboardingPatchSchema } from "./status";
import { honestyPreferenceForSave } from "./taste-persist";
import { missingRequiredOnboardingFields } from "./status";
import { normalizeCircleNames } from "./trusted-circle";
import {
  isAtLeastAge,
  joinCsvValues,
  styleEraToAgeRange,
} from "./form-options";
import { heightCmFromPhotoValues } from "@/components/onboarding/fitting/FittingPhotoStep";

function status(partial: {
  started?: boolean;
  completed?: boolean;
  profile?: Partial<NonNullable<ResumeStatus["profile"]>> | null;
  sizing?: ResumeStatus["sizing"];
  tasteTags?: ResumeStatus["tasteTags"];
  brandPreferences?: unknown[];
  hardNegatives?: unknown[];
}): ResumeStatus {
  return {
    onboarding: {
      started: partial.started ?? true,
      completed: partial.completed ?? false,
    },
    profile:
      partial.profile === null
        ? null
        : {
            preferredName: null,
            genderPresentation: null,
            styleEra: null,
            ageRange: null,
            weekIs: null,
            dressingFor: null,
            kids: null,
            climate: null,
            valuePhilosophy: null,
            honestyPreference: null,
            styleFriction: null,
            styleBecome: null,
            ...partial.profile,
          },
    sizing: partial.sizing ?? null,
    tasteTags: partial.tasteTags ?? [],
    brandPreferences: partial.brandPreferences ?? [],
    hardNegatives: partial.hardNegatives ?? [],
  };
}

const you = {
  preferredName: "Maya",
  genderPresentation: "feminine",
  styleEra: "30s",
};

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withoutSupabaseEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try {
    return await fn();
  } finally {
    if (prevUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (prevKey) process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = prevKey;
    else delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  }
}

describe("onboarding flow resume after each save", () => {
  it("walks quiz → mint without skipping skippable steps or required ones", () => {
    const afterConsent = status({ started: false });
    assert.equal(firstIncompleteFittingStep(afterConsent), "consent");
    assert.equal(
      resolveFittingResumeStep(afterConsent, "photo"),
      "photo",
    );

    const afterFit = status({
      sizing: { heightCm: 170, bodyType: "average" },
    });
    assert.equal(firstIncompleteFittingStep(afterFit), "photo");

    const afterName = status({
      profile: you,
      sizing: { heightCm: 170, bodyType: "average" },
    });
    assert.equal(firstIncompleteFittingStep(afterName), "life");
    assert.equal(resolveFittingResumeStep(afterName, "life"), "life");

    const afterLifeSpend = status({
      profile: { ...you, weekIs: "office", valuePhilosophy: "quality" },
      sizing: { heightCm: 170, bodyType: "average" },
    });
    assert.equal(firstIncompleteFittingStep(afterLifeSpend), "worn");

    const afterWorn = status({
      profile: { ...you, weekIs: "office", valuePhilosophy: "quality" },
      sizing: { heightCm: 170, bodyType: "average" },
      tasteTags: [{ category: "worn" }],
    });
    assert.equal(firstIncompleteFittingStep(afterWorn), "corner");
    assert.equal(resolveFittingResumeStep(afterWorn, "corner"), "corner");

    const afterCornerSkip = status({
      profile: { ...you, weekIs: "office", valuePhilosophy: "quality" },
      sizing: { heightCm: 170, bodyType: "average" },
      tasteTags: [{ category: "worn" }],
    });
    assert.equal(
      resolveFittingResumeStep(afterCornerSkip, "nolist"),
      "nolist",
    );

    const afterNolist = status({
      profile: {
        ...you,
        weekIs: "office",
        valuePhilosophy: "quality",
        styleBecome: "tailored",
      },
      sizing: { heightCm: 170, bodyType: "average" },
      tasteTags: [{ category: "worn" }],
      brandPreferences: [{ brand: "COS" }],
    });
    assert.equal(firstIncompleteFittingStep(afterNolist), "honesty");
    assert.notEqual(firstIncompleteFittingStep(afterNolist), "verdict");

    const afterHonesty = status({
      profile: {
        ...you,
        weekIs: "office",
        valuePhilosophy: "quality",
        styleBecome: "tailored",
        honestyPreference: "3",
      },
      sizing: { heightCm: 170, bodyType: "average" },
      tasteTags: [{ category: "worn" }],
      brandPreferences: [{ brand: "COS" }],
    });
    assert.equal(firstIncompleteFittingStep(afterHonesty), "verdict");
    assert.equal(resolveFittingResumeStep(afterHonesty, "circle"), "circle");
  });

  it("does not let a premature honesty default clamp past no-list", () => {
    const afterCorner = status({
      profile: {
        ...you,
        weekIs: "office",
        valuePhilosophy: "quality",
        styleBecome: "tailored",
      },
      sizing: { heightCm: 170, bodyType: "average" },
      tasteTags: [{ category: "worn" }],
    });
    assert.equal(firstIncompleteFittingStep(afterCorner), "nolist");
    assert.equal(honestyPreferenceForSave("worn", ""), undefined);
    assert.equal(honestyPreferenceForSave("wanted", "3"), undefined);
  });
});

describe("skippable vs required fitting steps", () => {
  it("requires name, clothing style, and era before identity can save", () => {
    const missing: string[] = [];
    const preferredName = "";
    const genderPresentation = "";
    const styleEraWire = joinCsvValues([]);
    if (!preferredName.trim()) missing.push("name");
    if (!genderPresentation.trim()) missing.push("clothing style");
    if (!styleEraWire) missing.push("style era");
    assert.deepEqual(missing, ["name", "clothing style", "style era"]);
    assert.deepEqual(missingRequiredOnboardingFields(null), [
      "preferredName",
      "genderPresentation",
      "ageRange",
    ]);
    assert.equal(styleEraToAgeRange("30s"), "25-34");
    assert.equal(isAtLeastAge("2020-01-01"), false);
  });

  it("allows empty life, spend, photo, corner, no-list, and circle", () => {
    assert.equal(heightCmFromPhotoValues({
      photoPreview: null,
      photoCoverage: "face",
      heightUnit: "ft",
      heightFt: null,
      heightIn: null,
      heightCm: null,
      weightValue: null,
      weightUnit: "lb",
      weightSkipped: false,
      build: null,
      muscularity: null,
      bodyShape: null,
      bustFullness: null,
      legLine: null,
    }), null);
    assert.deepEqual(normalizeCircleNames(["", "  "]), []);
    assert.equal(tastePostSchema.safeParse({ wornPicks: [] }).success, true);
    assert.equal(tastePostSchema.safeParse({ brandLikes: [] }).success, true);
    assert.equal(
      circlePostSchema.safeParse({ names: ["", "", ""] }).success,
      true,
    );
    assert.equal(
      reviewPostSchema.safeParse({
        patch: { profile: { weekIs: null, kids: null } },
        requestKey: "review-1",
      }).success,
      true,
    );
  });
});

describe("onboarding API request contracts", () => {
  it("rejects invalid review, taste, tell, brands, and circle bodies", () => {
    assert.equal(
      reviewPostSchema.safeParse({ patch: {}, requestKey: "short" }).success,
      false,
    );
    assert.equal(
      reviewPostSchema.safeParse({
        patch: { extra: true },
        requestKey: "review-ok",
      }).success,
      false,
    );
    assert.equal(
      tastePostSchema.safeParse({ wornPicks: [{ id: "", label: "x" }] }).success,
      false,
    );
    assert.equal(
      tastePostSchema.safeParse({ honestyPreference: "brutal" }).success,
      false,
    );
    assert.equal(fittingTellPostSchema.safeParse({ text: "" }).success, false);
    assert.equal(
      fittingTellPostSchema.safeParse({
        text: "I'm Maya",
        known: { currentStep: "consent" },
      }).success,
      true,
    );
    assert.equal(
      fittingTellPostSchema.safeParse({
        text: "I'm Maya",
        known: { currentStep: "nope" },
      }).success,
      false,
    );
    assert.equal(brandsPostSchema.safeParse({ name: "" }).success, false);
    assert.equal(circlePostSchema.safeParse({ names: 3 }).success, false);
    assert.equal(
      tasteDeckQuerySchema.safeParse({ mode: "nope" }).success,
      false,
    );
    assert.equal(
      onboardingPatchSchema.safeParse({
        sizing: { heightCm: 10 },
      }).success,
      false,
    );
    assert.equal(
      onboardingPatchSchema.safeParse({
        sizing: { heightCm: 170, bodyType: "average" },
      }).success,
      true,
    );
  });

  it("accepts the payloads each quiz save actually sends", () => {
    assert.equal(
      reviewPostSchema.safeParse({
        patch: {
          profile: {
            preferredName: "Maya",
            genderPresentation: "womenswear",
            ageRange: "25-34",
            styleEra: "30s",
          },
        },
        requestKey: crypto.randomUUID(),
      }).success,
      true,
    );
    assert.equal(
      reviewPostSchema.safeParse({
        patch: {
          sizing: { bodyType: "average" },
        },
        requestKey: crypto.randomUUID(),
      }).success,
      true,
    );
    const wornBody = {
      wornPicks: [
        { id: "look-1", label: "Streetwear", tasteTags: ["street"], archetype: "Street" },
      ],
      honestyPreference: honestyPreferenceForSave("worn", ""),
      complete: false,
    };
    assert.equal(tastePostSchema.safeParse(wornBody).success, true);
    assert.equal(wornBody.honestyPreference, undefined);
    assert.equal(
      tastePostSchema.safeParse({
        honestyPreference: honestyPreferenceForSave("final", "4"),
        complete: false,
      }).success,
      true,
    );
  });
});

describe("onboarding API handlers", () => {
  it("returns 401 without a session on authenticated GETs and POSTs", async () => {
    await withoutSupabaseEnv(async () => {
      const unauthorized = [
        await onboardingGET(),
        await onboardingPOST(),
        await tasteGET(new Request("http://local/api/onboarding/taste")),
        await circlePOST(
          jsonRequest("http://local/api/onboarding/circle", { names: [] }),
        ),
        await brandsGET(new Request("http://local/api/onboarding/brands")),
        await photoGET(
          new Request("http://local/api/onboarding/photo-analysis"),
        ),
        await looksGET(
          new Request("http://local/api/onboarding/reading-looks"),
        ),
        await verdictPOST(
          jsonRequest("http://local/api/onboarding/stylist-verdict", {
            hash: "abc",
          }),
        ),
      ];
      for (const res of unauthorized) {
        assert.equal(res.status, 401);
        const body = (await res.json()) as { error?: string };
        assert.equal(body.error, "Sign in required.");
      }
    });
  });

  it("returns 400 on invalid bodies before hitting the database", async () => {
    await withoutSupabaseEnv(async () => {
      const review = await reviewPOST(
        jsonRequest("http://local/api/onboarding/review", {
          patch: {},
          requestKey: "x",
        }),
      );
      assert.equal(review.status, 400);

      const taste = await tastePOST(
        jsonRequest("http://local/api/onboarding/taste", {
          wornPicks: [{ id: "", label: "x" }],
        }),
      );
      assert.equal(taste.status, 400);

      const tell = await tellPOST(
        jsonRequest("http://local/api/onboarding/fitting-tell", { text: "" }),
      );
      assert.equal(tell.status, 400);

      const brands = await brandsPOST(
        jsonRequest("http://local/api/onboarding/brands", { name: "" }),
      );
      assert.equal(brands.status, 401);

      const verdict = await verdictPOST(
        jsonRequest("http://local/api/onboarding/stylist-verdict", {}),
      );
      assert.equal(verdict.status, 401);
    });
  });

  it("accepts a well-formed identity review as 401 without a session, not 400", async () => {
    await withoutSupabaseEnv(async () => {
      const res = await reviewPOST(
        jsonRequest("http://local/api/onboarding/review", {
          patch: {
            profile: {
              preferredName: "Maya",
              genderPresentation: "womenswear",
              ageRange: "25-34",
              styleEra: "30s",
            },
          },
          requestKey: "review-key-ok",
        }),
      );
      assert.equal(res.status, 401);
    });
  });
});

describe("back and forth through Fitting", () => {
  it("can reverse every quiz step and re-enter scan from the card", () => {
    const quiz = FITTING_STEPS.filter(
      (s) => s !== "verdict" && s !== "circle" && s !== "consent",
    );
    let step: FittingStep = "honesty";
    const seen: FittingStep[] = [step];
    while (step !== "consent") {
      const target = fittingBackTarget({ step });
      assert.ok(target, `expected back from ${step}`);
      step = target.step;
      seen.push(step);
    }
    assert.deepEqual(seen.slice().reverse(), [
      "consent",
      "photo",
      "name",
      "fit",
      "life",
      "spend",
      "worn",
      "corner",
      "nolist",
      "honesty",
    ]);
    assert.ok(quiz.every((s) => seen.includes(s)));
  });
});
