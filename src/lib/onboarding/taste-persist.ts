import { normalizeTasteTag } from "@/lib/onboarding/taste-tags";
import { computeStyleMix } from "@/lib/onboarding/style-mix";
import { normalizeHonestyPreference } from "@/lib/onboarding/form-options";
import type { onboardingPatchSchema } from "@/lib/onboarding/status";
import type { z } from "zod";

export type OutfitPick = {
  id: string;
  label: string;
  tasteTags?: string[];
  productTitle?: string;
  productId?: string;
  /** Casting-matrix archetype for 1:1 styleMix axis votes. */
  archetype?: string;
};

type OnboardingPatch = z.infer<typeof onboardingPatchSchema>;

export type TasteSaveMark = "worn" | "wanted" | "nolist" | "final";

/** Honesty is locked on the honesty step — earlier taste saves must not stamp a default. */
export function honestyPreferenceForSave(
  mark: TasteSaveMark | undefined,
  value: string | null | undefined,
): "1" | "2" | "3" | "4" | "5" | undefined {
  if (mark !== "final") return undefined;
  return normalizeHonestyPreference(value) || "3";
}

function pushPickLabels(
  tasteTags: NonNullable<OnboardingPatch["tasteTags"]>,
  seen: Set<string>,
  picks: OutfitPick[],
  category: string,
) {
  for (const pick of picks) {
    const norm = normalizeTasteTag(pick.label.trim());
    if (!norm) continue;
    const key = `${category}|positive|${norm.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tasteTags.push({ tag: norm, polarity: "positive", category });
  }
}

/** Maps worn/aspirational picks + brands/vetoes/compliments/honesty → onboarding patch. */
export function buildPatchFromTastePicks(input: {
  wornPicks?: OutfitPick[];
  aspirationalPicks?: OutfitPick[];
  brandLikes?: string[];
  brandAvoids?: string[];
  hardAvoids?: string[];
  comfort?: string[];
  compliments?: string[];
  honestyPreference?: string | null;
  valuePhilosophy?: string | null;
  styleFriction?: string | null;
  styleBecome?: string | null;
}): OnboardingPatch {
  const tasteTags: NonNullable<OnboardingPatch["tasteTags"]> = [];
  const seen = new Set<string>();

  pushPickLabels(tasteTags, seen, input.wornPicks ?? [], "worn");
  pushPickLabels(tasteTags, seen, input.aspirationalPicks ?? [], "aspirational");

  for (const c of input.compliments ?? []) {
    const norm = normalizeTasteTag(c.trim().toLowerCase());
    if (!norm) continue;
    const key = `compliment|positive|${norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tasteTags.push({ tag: norm, polarity: "positive", category: "compliment" });
  }

  const brands: NonNullable<OnboardingPatch["brands"]> = [];
  for (const brand of input.brandLikes ?? []) {
    const b = brand.trim();
    if (!b) continue;
    brands.push({ brand: b.slice(0, 120), sentiment: "love" });
  }
  for (const brand of input.brandAvoids ?? []) {
    const b = brand.trim();
    if (!b) continue;
    brands.push({ brand: b.slice(0, 120), sentiment: "avoid" });
  }

  const hardNegatives: NonNullable<OnboardingPatch["hardNegatives"]> = [];
  const comfortSet = new Set(
    (input.comfort ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
  for (const value of input.hardAvoids ?? []) {
    const v = value.trim();
    if (!v) continue;
    if (comfortSet.has(v.toLowerCase())) continue;
    hardNegatives.push({
      scope: "style",
      value: v.slice(0, 120),
      reason: "taste",
    });
  }
  for (const value of input.comfort ?? []) {
    const v = value.trim();
    if (!v) continue;
    hardNegatives.push({
      scope: "fit",
      value: v.slice(0, 120),
      reason: "other",
      note: "comfort",
    });
  }

  const styleMix = computeStyleMix({
    wornLabels: (input.wornPicks ?? []).map((p) => p.label),
    aspirationalLabels: (input.aspirationalPicks ?? []).map((p) => p.label),
    wornArchetypes: (input.wornPicks ?? [])
      .map((p) => p.archetype)
      .filter((a): a is string => Boolean(a?.trim())),
    aspirationalArchetypes: (input.aspirationalPicks ?? [])
      .map((p) => p.archetype)
      .filter((a): a is string => Boolean(a?.trim())),
    compliments: input.compliments ?? [],
    tasteTags: [
      ...(input.wornPicks ?? []).flatMap((p) => p.tasteTags ?? []),
      ...(input.aspirationalPicks ?? []).flatMap((p) => p.tasteTags ?? []),
    ],
    styleBecome: input.styleBecome,
    styleFriction: input.styleFriction,
  });

  const profile: NonNullable<OnboardingPatch["profile"]> = {
    styleMix,
    complimentPreferences: (input.compliments ?? []).slice(0, 4),
  };
  if (input.honestyPreference?.trim()) {
    const honesty = normalizeHonestyPreference(input.honestyPreference);
    if (honesty) profile.honestyPreference = honesty;
  }
  if (input.valuePhilosophy?.trim()) {
    profile.valuePhilosophy = input.valuePhilosophy.trim();
  }
  if (input.styleFriction !== undefined) {
    const t = input.styleFriction?.trim() ?? "";
    profile.styleFriction = t || null;
  }
  if (input.styleBecome !== undefined) {
    const t = input.styleBecome?.trim() ?? "";
    profile.styleBecome = t || null;
  }

  const sizing: NonNullable<OnboardingPatch["sizing"]> | undefined =
    input.comfort != null
      ? { sensitivities: input.comfort.map((c) => c.trim()).filter(Boolean) }
      : undefined;

  return {
    profile,
    ...(sizing ? { sizing } : {}),
    ...(tasteTags.length ? { tasteTags } : {}),
    ...(brands.length ? { brands } : {}),
    ...(hardNegatives.length ? { hardNegatives } : {}),
  };
}
