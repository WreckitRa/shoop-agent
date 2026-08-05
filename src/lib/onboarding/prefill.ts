import type { z } from "zod";
import { tagsFromFreeText } from "@/lib/onboarding/taste-tags";
import type { onboardingPatchSchema } from "@/lib/onboarding/status";
import type { OnboardingExtraction } from "@/lib/onboarding/memory-extract/types";
import { observationTargetsBuyer } from "@/lib/onboarding/memory-extract/observation-scope";

export type OnboardingFormPrefill = {
  preferredName?: string;
  genderPresentation?: string;
  ageRange?: string;
  shippingCountry?: string;
  currency?: string;
  topSize?: string;
  bottomSize?: string;
  shoeEU?: string;
  budgetPhilosophy?: string;
  styleLikes?: string;
  styleAvoids?: string;
  brandLikes?: string;
  brandAvoids?: string;
  hardAvoids?: string;
};

type OnboardingPatch = z.infer<typeof onboardingPatchSchema>;

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => asString(x)).filter((x): x is string => Boolean(x));
  }
  const s = asString(v);
  return s ? [s] : [];
}

function joinUnique(values: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join(", ");
}

function mergePrefill(
  base: OnboardingFormPrefill,
  next: OnboardingFormPrefill,
): OnboardingFormPrefill {
  const out = { ...base };
  for (const [key, value] of Object.entries(next) as [keyof OnboardingFormPrefill, string | undefined][]) {
    if (value?.trim()) out[key] = value.trim();
  }
  return out;
}

function normalizeBottomSize(raw: string): string {
  const t = raw
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const wxl = t.match(/(\d{2})\s*W?\s*[/x]\s*(\d{2})\s*L?/i);
  if (wxl) return `${wxl[1]}x${wxl[2]}`;
  return t;
}

function normalizeTopSize(raw: string): string {
  return raw.replace(/\*\*/g, "").trim();
}

function mapValuePhilosophy(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toLowerCase();
  const known = [
    "best_value",
    "premium",
    "luxury",
    "deal_hunter",
    "design_first",
  ] as const;
  if ((known as readonly string[]).includes(t)) return t;
  if (t.includes("luxury") || t.includes("designer") || t.includes("herm")) {
    return "luxury";
  }
  if (t.includes("premium") || t.includes("quality")) return "premium";
  if (t.includes("deal") || t.includes("cheap") || t.includes("sale")) {
    return "deal_hunter";
  }
  if (t.includes("design") || t.includes("aesthetic")) return "design_first";
  if (t.includes("value") || t.includes("flexible") || t.includes("smart")) {
    return "best_value";
  }
  return undefined;
}

function parseBracketList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.replace(/^\[|\]$/g, "").trim())
    .filter((s) => s.length > 0 && s.length < 80);
}

/** Regex fallbacks when the LLM extractor misses structured markdown profiles. */
export function heuristicPrefillFromText(text: string): OnboardingFormPrefill {
  const prefill: OnboardingFormPrefill = {};

  const nameFromTitle = text.match(/^#+\s*([A-Za-z][\w-]*)'?s\s+shopping\s+profile/im);
  if (nameFromTitle) prefill.preferredName = nameFromTitle[1];

  const ageFromPhrase = text.match(/\b(\d{1,2})[- ]?year[- ]?old\b/i);
  if (ageFromPhrase) {
    const n = Number(ageFromPhrase[1]);
    if (n >= 13 && n < 18) prefill.ageRange = "13-17";
    else if (n < 25) prefill.ageRange = "18-24";
    else if (n < 35) prefill.ageRange = "25-34";
    else if (n < 45) prefill.ageRange = "35-44";
    else if (n < 55) prefill.ageRange = "45-54";
    else if (n < 65) prefill.ageRange = "55-64";
    else if (n >= 65) prefill.ageRange = "65+";
  }

  const basedIn = text.match(/\bbased in\s+([^,\n]+),\s*([A-Za-z][A-Za-z\s]{1,40})\b/i);
  if (basedIn) prefill.shippingCountry = basedIn[2].trim();

  if (/\bUSD\b/i.test(text) && !prefill.currency) prefill.currency = "USD";
  if (/\bEUR\b/i.test(text) && !prefill.currency) prefill.currency = "EUR";
  if (/\bGBP\b/i.test(text) && !prefill.currency) prefill.currency = "GBP";

  const topsBracket = text.match(/\btops?\s*\[([^\]]+)\]/i);
  if (topsBracket) prefill.topSize = normalizeTopSize(topsBracket[1]);

  const waistInseam = text.match(
    /\bwaist\s*\[([^\]]+)\][^\n]*(?:inseam\s*\[([^\]]+)\])/i,
  );
  if (waistInseam) {
    prefill.bottomSize = normalizeBottomSize(`${waistInseam[1]}x${waistInseam[2]}`);
  }

  const shoeEu = text.match(/\bshoe[s]?\s*\[\s*EU\s*(\d{2})/i);
  if (shoeEu) prefill.shoeEU = shoeEu[1];

  const brandsLikeBracket = text.match(/\bbrands?\s+i\s+like:?\s*\[([^\]]+)\]/i);
  if (brandsLikeBracket) {
    prefill.brandLikes = joinUnique(parseBracketList(brandsLikeBracket[1]));
  }

  const brandsAvoidBracket = text.match(/\bbrands?\s+i\s+avoid:?\s*\[([^\]]+)\]/i);
  if (brandsAvoidBracket) {
    prefill.brandAvoids = joinUnique(parseBracketList(brandsAvoidBracket[1]));
  }

  if (!prefill.budgetPhilosophy) {
    prefill.budgetPhilosophy = mapValuePhilosophy(text);
  }

  const styleBlock = text.match(/\*\*Style:\*\*\s*([\s\S]*?)(?=\n\*\*|\n##|$)/i);
  if (styleBlock) {
    const style = styleBlock[1].replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    if (style) prefill.styleLikes = style.slice(0, 500);
  }

  const tops = text.match(/Tops?:\s*\*?\*?([^*\n]+)\*?\*?/i);
  if (tops) prefill.topSize = normalizeTopSize(tops[1]);

  const bottoms = text.match(/Bottoms?:\s*\*?\*?([^*\n]+)\*?\*?/i);
  if (bottoms) prefill.bottomSize = normalizeBottomSize(bottoms[1]);

  const shoes = text.match(/Shoes?:\s*\*?\*?(?:EU\s*)?(\d{2})\*?\*?/i);
  if (shoes) prefill.shoeEU = shoes[1];

  const budget = text.match(/\*\*Budget:\*\*\s*([\s\S]*?)(?=\n\*\*|\n##|$)/i);
  if (budget) {
    prefill.budgetPhilosophy = mapValuePhilosophy(budget[1]);
  }

  const hardNos = text.match(/\*\*Hard no['’]?s?:\*\*\s*([\s\S]*?)(?=\n\*\*|\n##|$)/i);
  if (hardNos) {
    const lines = hardNos[1]
      .split(/\n+/)
      .map((l) => l.replace(/^[-*•]\s*/, "").replace(/\*\*/g, "").trim())
      .filter(Boolean);
    if (lines.length) prefill.hardAvoids = lines.join(", ");
  }

  const brandsLike = text.match(
    /\*\*Brands\s*\/\s*vibe[^*]*\*\*\s*([\s\S]*?)(?=\n\*\*|\n##|$)/i,
  );
  if (brandsLike) {
    const chunk = brandsLike[1];
    const named = [...chunk.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
    const brands = named.filter((b) => b.length > 1 && b.length < 40);
    if (brands.length) prefill.brandLikes = joinUnique(brands);
  }

  const brandsAvoid = text.match(
    /\*\*Brands to avoid:\*\*\s*([\s\S]*?)(?=\n\*\*|\n##|$)/i,
  );
  if (brandsAvoid) {
    const body = brandsAvoid[1].replace(/\*\*/g, "").trim();
    if (body && !/no specific/i.test(body)) {
      prefill.styleAvoids = body.slice(0, 400);
    }
  }

  if (/\bmasculine\b/i.test(text) && !prefill.genderPresentation) {
    prefill.genderPresentation = "masculine";
  }

  return prefill;
}

export function prefillFromExtraction(
  extraction: OnboardingExtraction,
): OnboardingFormPrefill {
  const prefill: OnboardingFormPrefill = {};
  const styleLikes: string[] = [];
  const styleAvoids: string[] = [];
  const brandLikes: string[] = [];
  const brandAvoids: string[] = [];
  const hardAvoids: string[] = [];

  for (const o of extraction.observations) {
    const a = o.attributes ?? {};

    if (o.signalType === "profile" && observationTargetsBuyer(o)) {
      const name = asString(a.name) ?? asString(a.preferredName);
      if (name) prefill.preferredName = name;
      const gender = asString(a.genderPresentation) ?? asString(a.gender);
      if (gender) prefill.genderPresentation = gender;
      const age = asString(a.ageRange) ?? asString(a.age_range);
      if (age) prefill.ageRange = age;
      const country = asString(a.shippingCountry) ?? asString(a.country);
      if (country) prefill.shippingCountry = country;
      const currency = asString(a.currency);
      if (currency) prefill.currency = currency.toUpperCase();
      const value = asString(a.valuePhilosophy) ?? asString(a.valuePreference);
      if (value) prefill.budgetPhilosophy = value;
    }

    if ((o.signalType === "size" || o.signalType === "fit") && observationTargetsBuyer(o)) {
      const top = asString(a.topSize) ?? asString(a.shirtSize) ?? asString(a.tshirtSize);
      if (top) prefill.topSize = top;
      const bottom =
        asString(a.bottomUsualSize) ??
        asString(a.pantsSize) ??
        (() => {
          const w = asString(a.bottomWaist) ?? asString(a.waist);
          const i = asString(a.bottomInseam) ?? asString(a.inseam);
          if (w && i) return `${w.replace(/W$/i, "")}x${i.replace(/L$/i, "")}`;
          return undefined;
        })();
      if (bottom) prefill.bottomSize = normalizeBottomSize(bottom);
      const shoe = asNumber(a.shoeSizeEU ?? a.shoeEU);
      if (shoe !== undefined) prefill.shoeEU = String(Math.round(shoe));
    }

    if (
      o.signalType === "style_like" ||
      o.signalType === "color_like" ||
      o.signalType === "product_type_like" ||
      o.signalType === "fit_like"
    ) {
      for (const v of [
        ...asStringArray(a.tasteTags ?? a.tags),
        ...asStringArray(a.styles),
        asString(a.style),
        asString(a.color),
        asString(a.tag),
      ]) {
        if (v) styleLikes.push(v);
      }
    }

    if (
      o.signalType === "style_dislike" ||
      o.signalType === "color_dislike" ||
      o.signalType === "product_type_dislike" ||
      o.signalType === "fit_dislike"
    ) {
      for (const v of [
        ...asStringArray(a.tasteTags ?? a.tags),
        ...asStringArray(a.styles),
        asString(a.style),
        asString(a.color),
        asString(a.tag),
      ]) {
        if (v) styleAvoids.push(v);
      }
    }

    if (o.signalType === "brand_like" && o.brand) {
      brandLikes.push(o.brand);
    }
    if (o.signalType === "brand_dislike" && o.brand) {
      brandAvoids.push(o.brand);
    }

    if (o.signalType === "hard_negative" || o.isHardRule) {
      const scope = asString(a.scope);
      const value =
        asString(a.value) ??
        asString(a.style) ??
        o.brand ??
        asString(a.brand);
      if (value) hardAvoids.push(scope ? `${scope}: ${value}` : value);
    }

    if (o.signalType === "budget") {
      const value = mapValuePhilosophy(asString(a.valuePhilosophy) ?? o.normalizedText);
      if (value) prefill.budgetPhilosophy = value;
    }
  }

  if (extraction.profileUpdates?.styleSummary) {
    styleLikes.push(extraction.profileUpdates.styleSummary);
  }
  if (extraction.profileUpdates?.dislikesSummary) {
    styleAvoids.push(extraction.profileUpdates.dislikesSummary);
  }
  if (extraction.profileUpdates?.budgetSummary) {
    const v = mapValuePhilosophy(extraction.profileUpdates.budgetSummary);
    if (v) prefill.budgetPhilosophy = v;
  }
  if (extraction.profileUpdates?.brandSummary) {
    brandLikes.push(extraction.profileUpdates.brandSummary);
  }

  if (styleLikes.length) prefill.styleLikes = joinUnique(styleLikes);
  if (styleAvoids.length) prefill.styleAvoids = joinUnique(styleAvoids);
  if (brandLikes.length) prefill.brandLikes = joinUnique(brandLikes);
  if (brandAvoids.length) prefill.brandAvoids = joinUnique(brandAvoids);
  if (hardAvoids.length) prefill.hardAvoids = joinUnique(hardAvoids);

  return prefill;
}

export function mergeOnboardingPrefill(
  text: string,
  extraction: OnboardingExtraction | null,
): OnboardingFormPrefill {
  const fromHeuristic = heuristicPrefillFromText(text);
  if (!extraction) return fromHeuristic;
  return mergePrefill(fromHeuristic, prefillFromExtraction(extraction));
}

export function buildOnboardingPatchFromPrefill(
  prefill: OnboardingFormPrefill,
): OnboardingPatch {
  const profile: NonNullable<OnboardingPatch["profile"]> = {};
  if (prefill.preferredName) profile.preferredName = prefill.preferredName;
  if (prefill.genderPresentation) profile.genderPresentation = prefill.genderPresentation;
  if (prefill.ageRange) profile.ageRange = prefill.ageRange;
  if (prefill.shippingCountry) profile.shippingCountry = prefill.shippingCountry;
  if (prefill.currency) profile.currency = prefill.currency;
  if (prefill.budgetPhilosophy) profile.valuePhilosophy = prefill.budgetPhilosophy;

  const sizing: NonNullable<OnboardingPatch["sizing"]> = {};
  if (prefill.topSize) sizing.topUsualSize = prefill.topSize;
  if (prefill.bottomSize) sizing.bottomUsualSize = prefill.bottomSize;
  if (prefill.shoeEU) {
    const n = Number(prefill.shoeEU);
    if (Number.isFinite(n)) sizing.shoeEU = n;
  }

  const brands: NonNullable<OnboardingPatch["brands"]> = [];
  for (const brand of prefill.brandLikes?.split(",").map((b) => b.trim()).filter(Boolean) ?? []) {
    brands.push({ brand, sentiment: "love" });
  }
  for (const brand of prefill.brandAvoids?.split(",").map((b) => b.trim()).filter(Boolean) ?? []) {
    brands.push({ brand, sentiment: "avoid" });
  }

  const tasteTags: NonNullable<OnboardingPatch["tasteTags"]> = [];
  for (const tag of tagsFromFreeText(prefill.styleLikes)) {
    tasteTags.push({ tag, polarity: "positive" });
  }
  for (const tag of tagsFromFreeText(prefill.styleAvoids)) {
    tasteTags.push({ tag, polarity: "negative" });
  }

  const hardNegatives: NonNullable<OnboardingPatch["hardNegatives"]> = [];
  for (const value of tagsFromFreeText(prefill.hardAvoids, 24)) {
    hardNegatives.push({ scope: "style", value, reason: "taste" });
  }

  const patch: OnboardingPatch = {};
  if (Object.keys(profile).length) patch.profile = profile;
  if (Object.keys(sizing).length) patch.sizing = sizing;
  if (brands.length) patch.brands = brands;
  if (tasteTags.length) patch.tasteTags = tasteTags;
  if (hardNegatives.length) patch.hardNegatives = hardNegatives;
  return patch;
}
