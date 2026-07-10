/**
 * Projector: maps extractor output → typed user-knowledge tables.
 *
 * The extractor (`extractor.ts`) emits raw + canonical memory rows.
 * This module derives the **typed projections** the agent reads at
 * retrieval time and the user edits in the profile UI:
 *
 *   UserProfile          (identity / lifestyle / value philosophy)
 *   SizingProfile        (body & sizing)
 *   CategoryPreference   (per-category style/colors/budget)
 *   BrandPreference      (brand relationship graph)
 *   Recipient            (gift recipients)
 *   ShoppingIntent       (active shopping missions)
 *   TasteTag             (positive/negative taste graph)
 *   HardNegative         (hard rules: never recommend)
 *
 * Design rules:
 * - All upserts are idempotent — calling the projector twice with the same
 *   extraction must not double-count.
 * - Arrays are deduped (case-insensitive) before write.
 * - We never *remove* values during projection (an extractor turn that
 *   doesn't mention a value is silent, not a deletion). Removal happens
 *   only through the profile CRUD endpoints.
 * - Identity fields (name, age, gender, pronouns, birth date) are never
 *   written from chat memory — only via profile settings / onboarding.
 * - Observations scoped to a gift recipient never update buyer typed tables.
 * - Field-level conflicts: highest-confidence value wins, ties keep the
 *   most recent.
 */

import { prisma } from "../db";
import type { InteractiveTransactionClient } from "../prisma-types";
import {
  observationTargetsBuyer,
  stripChatProtectedIdentityFields,
} from "./observation-scope";
import type { ShoppingMemoryExtraction } from "./types";

type Obs = ShoppingMemoryExtraction["observations"][number];
type Intent = NonNullable<ShoppingMemoryExtraction["activeIntent"]>;
type Attrs = Record<string, unknown>;

function attrs(o: Obs): Attrs {
  return (o.attributes ?? {}) as Attrs;
}

/** Minimal OwnedProduct row shape used by the projector. */
type OwnedProductRow = {
  id: string;
  model: string;
  attributes: unknown;
  acquiredAt: Date | null;
  acquiredNote: string | null;
  notes: string | null;
  confidence: number;
};

type OwnedProductDelegate = {
  findUnique: (args: object) => Promise<OwnedProductRow | null>;
  create: (args: object) => Promise<unknown>;
  update: (args: object) => Promise<unknown>;
  updateMany: (args: object) => Promise<unknown>;
};

function ownedProductOf(tx: InteractiveTransactionClient): OwnedProductDelegate {
  return (tx as unknown as { ownedProduct: OwnedProductDelegate }).ownedProduct;
}

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

function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "yes", "1"].includes(t)) return true;
    if (["false", "no", "0"].includes(t)) return false;
  }
  return undefined;
}

function mergeStringSet(prev: string[], incoming: string[]): string[] {
  const seen = new Set<string>(prev.map((s) => s.trim().toLowerCase()));
  const out = [...prev];
  for (const v of incoming) {
    const k = v.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(v.trim());
    }
  }
  return out.slice(-32);
}

/** Map natural-language sentiment to enum; falls back from positive/negative signalTypes. */
function brandSentimentFor(
  o: Obs,
): "love" | "like" | "neutral" | "avoid" | "hate" {
  const raw = asString(attrs(o).sentiment)?.toLowerCase();
  if (
    raw === "love" ||
    raw === "like" ||
    raw === "neutral" ||
    raw === "avoid" ||
    raw === "hate"
  ) {
    return raw;
  }
  if (o.signalType === "brand_dislike") {
    return o.isHardRule ? "hate" : "avoid";
  }
  if (o.signalType === "brand_like") {
    return o.confidence >= 0.9 ? "love" : "like";
  }
  return "neutral";
}

function hardNegativeScopeFor(
  o: Obs,
):
  | "brand"
  | "material"
  | "color"
  | "retailer"
  | "category"
  | "ingredient"
  | "style"
  | "fit"
  | null {
  const explicit = asString(attrs(o).scope)?.toLowerCase();
  const allowed = [
    "brand",
    "material",
    "color",
    "retailer",
    "category",
    "ingredient",
    "style",
    "fit",
  ] as const;
  if (explicit && (allowed as readonly string[]).includes(explicit)) {
    return explicit as (typeof allowed)[number];
  }
  if (o.brand) return "brand";
  if (attrs(o).material) return "material";
  if (attrs(o).color) return "color";
  if (attrs(o).retailer) return "retailer";
  if (attrs(o).style) return "style";
  if (attrs(o).fit) return "fit";
  return null;
}

function hardNegativeValueFor(o: Obs, scope: string): string | null {
  const a = attrs(o);
  switch (scope) {
    case "brand":
      return o.brand ?? asString(a.brand) ?? null;
    case "material":
      return asString(a.material) ?? null;
    case "color":
      return asString(a.color) ?? null;
    case "retailer":
      return asString(a.retailer) ?? null;
    case "category":
      return o.category ?? asString(a.category) ?? null;
    case "ingredient":
      return asString(a.ingredient) ?? null;
    case "style":
      return asString(a.style) ?? null;
    case "fit":
      return asString(a.fit) ?? null;
    default:
      return null;
  }
}

function hardNegativeReasonFor(
  o: Obs,
):
  | "allergy"
  | "ethics"
  | "religion"
  | "health"
  | "taste"
  | "past_bad_experience"
  | "other"
  | null {
  const r = asString(attrs(o).reason)?.toLowerCase();
  const allowed = [
    "allergy",
    "ethics",
    "religion",
    "health",
    "taste",
    "past_bad_experience",
    "other",
  ];
  if (r && allowed.includes(r)) return r as never;
  if (o.signalType === "style_dislike" || o.signalType === "brand_dislike")
    return "taste";
  return null;
}

async function projectUserProfile(
  tx: InteractiveTransactionClient,
  userId: string,
  o: Obs,
) {
  if (!observationTargetsBuyer(o)) return;

  const a = attrs(o);
  const data: Record<string, unknown> = {};

  const country = asString(a.country);
  if (country) data.country = country;
  const city = asString(a.city);
  if (city) data.city = city;
  const currency = asString(a.currency);
  if (currency) data.currency = currency.toUpperCase().slice(0, 6);
  const language = asString(a.language);
  if (language) data.language = language;
  const tz = asString(a.timezone);
  if (tz) data.timezone = tz;
  const climate = asString(a.climate) ?? asString(a.weatherProfile);
  if (climate) data.climate = climate;

  const unitsLength = asString(a.unitsLength);
  if (unitsLength) data.unitsLength = unitsLength;
  const unitsWeight = asString(a.unitsWeight);
  if (unitsWeight) data.unitsWeight = unitsWeight;
  const unitsShoe = asString(a.unitsShoe);
  if (unitsShoe) data.unitsShoe = unitsShoe;

  const occupation = asString(a.occupation);
  if (occupation) data.occupation = occupation;
  const workEnv = asString(a.workEnvironment);
  if (workEnv) data.workEnvironment = workEnv;
  const lifestyle = asStringArray(a.lifestyleTags ?? a.lifestyle);

  const shippingCountry = asString(a.shippingCountry) ?? country;
  if (shippingCountry) data.shippingCountry = shippingCountry;
  const acceptsIntl = asBoolean(a.acceptsInternational);
  if (acceptsIntl !== undefined) data.acceptsInternational = acceptsIntl;
  const speed = asString(a.preferredDeliverySpeed);
  if (speed) data.preferredDeliverySpeed = speed;

  const value = asString(a.valuePhilosophy) ?? asString(a.valuePreference);
  if (value) data.valuePhilosophy = value;
  const decision = asString(a.decisionStyle);
  if (decision) data.decisionStyle = decision;
  const risk = asString(a.riskTolerance);
  if (risk) data.riskTolerance = risk;
  const deal = asString(a.dealSensitivity);
  if (deal) data.dealSensitivity = deal;
  const quality = asString(a.qualityThreshold);
  if (quality) data.qualityThreshold = quality;

  stripChatProtectedIdentityFields(data);

  const noStructured = Object.keys(data).length === 0 && lifestyle.length === 0;
  if (noStructured) return;

  const existing = await tx.userProfile.findUnique({ where: { userId } });
  const mergedLifestyle = mergeStringSet(
    existing?.lifestyleTags ?? [],
    lifestyle,
  );

  if (!existing) {
    await tx.userProfile.create({
      data: {
        userId,
        ...data,
        lifestyleTags: mergedLifestyle,
        confidence: o.confidence,
        evidenceCount: 1,
      },
    });
    return;
  }

  await tx.userProfile.update({
    where: { userId },
    data: {
      ...data,
      lifestyleTags: mergedLifestyle,
      confidence: Math.max(existing.confidence, o.confidence),
      evidenceCount: { increment: 1 },
    },
  });
}

async function projectSizing(
  tx: InteractiveTransactionClient,
  userId: string,
  o: Obs,
) {
  if (!observationTargetsBuyer(o)) return;

  const a = attrs(o);
  const data: Record<string, unknown> = {};

  const heightCm = asNumber(a.heightCm);
  if (heightCm !== undefined) data.heightCm = Math.round(heightCm);
  const weightKg = asNumber(a.weightKg);
  if (weightKg !== undefined) data.weightKg = Math.round(weightKg);
  const bodyType = asString(a.bodyType);
  if (bodyType) data.bodyType = bodyType;
  const shoulder = asString(a.shoulderWidth);
  if (shoulder) data.shoulderWidth = shoulder;

  const topSize =
    asString(a.topSize) ?? asString(a.shirtSize) ?? asString(a.tshirtSize);
  if (topSize) data.topUsualSize = topSize;
  const topFit = asString(a.topPreferredFit) ?? asString(a.topFit);
  if (topFit) data.topPreferredFit = topFit;
  const topNotes = asStringArray(a.topNotes ?? a.topFitNotes);

  const bottomWaist = asString(a.bottomWaist) ?? asString(a.waist);
  if (bottomWaist) data.bottomWaist = bottomWaist;
  const inseam = asString(a.bottomInseam) ?? asString(a.inseam);
  if (inseam) data.bottomInseam = inseam;
  const rise = asString(a.bottomRise);
  if (rise) data.bottomRise = rise;
  const bottomFit = asString(a.bottomPreferredFit) ?? asString(a.bottomFit);
  if (bottomFit) data.bottomPreferredFit = bottomFit;
  const bottomSize = asString(a.bottomUsualSize) ?? asString(a.pantsSize);
  if (bottomSize) data.bottomUsualSize = bottomSize;
  if (!data.bottomUsualSize && bottomWaist && inseam) {
    const w = bottomWaist.replace(/\s*W$/i, "");
    const i = inseam.replace(/\s*L$/i, "");
    data.bottomUsualSize = `${w}x${i}`;
  }
  const bottomNotes = asStringArray(a.bottomNotes);

  const shoeEU = asNumber(a.shoeSizeEU ?? a.shoeEU);
  if (shoeEU !== undefined) data.shoeEU = shoeEU;
  const shoeUS = asNumber(a.shoeSizeUS ?? a.shoeUS);
  if (shoeUS !== undefined) data.shoeUS = shoeUS;
  const shoeUK = asNumber(a.shoeSizeUK ?? a.shoeUK);
  if (shoeUK !== undefined) data.shoeUK = shoeUK;
  const shoeWidth = asString(a.shoeWidth);
  if (shoeWidth) data.shoeWidth = shoeWidth;
  const shoeNotes = asStringArray(a.shoeNotes ?? a.shoeFitIssues);

  const neck = asString(a.neckSize);
  if (neck) data.neckSize = neck;
  const sleeve = asString(a.sleeveLength);
  if (sleeve) data.sleeveLength = sleeve;
  const ring = asString(a.ringSize);
  if (ring) data.ringSize = ring;
  const glove = asString(a.gloveSize);
  if (glove) data.gloveSize = glove;

  const sensitivities = asStringArray(a.sensitivities);

  const noStructured =
    Object.keys(data).length === 0 &&
    topNotes.length === 0 &&
    bottomNotes.length === 0 &&
    shoeNotes.length === 0 &&
    sensitivities.length === 0;
  if (noStructured) return;

  const existing = await tx.sizingProfile.findUnique({ where: { userId } });

  if (!existing) {
    await tx.sizingProfile.create({
      data: {
        userId,
        ...data,
        topNotes: mergeStringSet([], topNotes),
        bottomNotes: mergeStringSet([], bottomNotes),
        shoeNotes: mergeStringSet([], shoeNotes),
        sensitivities: mergeStringSet([], sensitivities),
        confidence: o.confidence,
        evidenceCount: 1,
      },
    });
    return;
  }

  await tx.sizingProfile.update({
    where: { userId },
    data: {
      ...data,
      topNotes: mergeStringSet(existing.topNotes, topNotes),
      bottomNotes: mergeStringSet(existing.bottomNotes, bottomNotes),
      shoeNotes: mergeStringSet(existing.shoeNotes, shoeNotes),
      sensitivities: mergeStringSet(existing.sensitivities, sensitivities),
      confidence: Math.max(existing.confidence, o.confidence),
      evidenceCount: { increment: 1 },
    },
  });
}

async function projectCategoryPreference(
  tx: InteractiveTransactionClient,
  userId: string,
  o: Obs,
) {
  if (!observationTargetsBuyer(o)) return;

  const category = o.category ?? asString(attrs(o).category);
  if (!category) return;
  const subcategory = o.subcategory ?? asString(attrs(o).subcategory) ?? "";

  const a = attrs(o);
  const isLike =
    o.signalType === "style_like" ||
    o.signalType === "color_like" ||
    o.signalType === "product_type_like" ||
    o.signalType === "fit_like";
  const isDislike =
    o.signalType === "style_dislike" ||
    o.signalType === "color_dislike" ||
    o.signalType === "product_type_dislike" ||
    o.signalType === "fit_dislike";

  const styleVal = asString(a.style);
  const colorVal = asString(a.color);
  const materialVal = asString(a.material);
  const fitVal = asString(a.fit);
  const patternVal = asString(a.pattern);

  const styles = asStringArray(a.styles ?? a.preferredStyles);
  const colors = asStringArray(a.colors ?? a.preferredColors);
  const materials = asStringArray(a.materials ?? a.preferredMaterials);
  const fits = asStringArray(a.fits ?? a.preferredFits);
  const patterns = asStringArray(a.patterns ?? a.preferredPatterns);

  if (styleVal) styles.push(styleVal);
  if (colorVal) colors.push(colorVal);
  if (materialVal) materials.push(materialVal);
  if (fitVal) fits.push(fitVal);
  if (patternVal) patterns.push(patternVal);

  const budgetMin = asNumber(a.budgetMin);
  const budgetMax = asNumber(a.budgetMax);
  const budgetTarget = asNumber(a.budgetTypical ?? a.budgetTarget ?? a.budget);
  const currency = asString(a.currency);

  const hasBudget =
    budgetMin !== undefined ||
    budgetMax !== undefined ||
    budgetTarget !== undefined;

  const nothing =
    styles.length === 0 &&
    colors.length === 0 &&
    materials.length === 0 &&
    fits.length === 0 &&
    patterns.length === 0 &&
    !hasBudget;
  if (nothing && o.signalType !== "budget") return;

  const existing = await tx.categoryPreference.findUnique({
    where: {
      userId_category_subcategory: { userId, category, subcategory },
    },
  });

  const baseStyles = existing?.preferredStyles ?? [];
  const baseStylesDis = existing?.dislikedStyles ?? [];
  const baseColors = existing?.preferredColors ?? [];
  const baseColorsDis = existing?.dislikedColors ?? [];
  const baseMats = existing?.preferredMaterials ?? [];
  const baseMatsDis = existing?.dislikedMaterials ?? [];
  const baseFits = existing?.preferredFits ?? [];
  const baseFitsDis = existing?.dislikedFits ?? [];
  const basePat = existing?.preferredPatterns ?? [];
  const basePatDis = existing?.dislikedPatterns ?? [];

  const nextStyles = isLike ? mergeStringSet(baseStyles, styles) : baseStyles;
  const nextStylesDis = isDislike
    ? mergeStringSet(baseStylesDis, styles)
    : baseStylesDis;
  const nextColors = isLike ? mergeStringSet(baseColors, colors) : baseColors;
  const nextColorsDis = isDislike
    ? mergeStringSet(baseColorsDis, colors)
    : baseColorsDis;
  const nextMats = isLike ? mergeStringSet(baseMats, materials) : baseMats;
  const nextMatsDis = isDislike
    ? mergeStringSet(baseMatsDis, materials)
    : baseMatsDis;
  const nextFits = isLike ? mergeStringSet(baseFits, fits) : baseFits;
  const nextFitsDis = isDislike
    ? mergeStringSet(baseFitsDis, fits)
    : baseFitsDis;
  const nextPat = isLike ? mergeStringSet(basePat, patterns) : basePat;
  const nextPatDis = isDislike
    ? mergeStringSet(basePatDis, patterns)
    : basePatDis;

  const data: Record<string, unknown> = {
    preferredStyles: nextStyles,
    dislikedStyles: nextStylesDis,
    preferredColors: nextColors,
    dislikedColors: nextColorsDis,
    preferredMaterials: nextMats,
    dislikedMaterials: nextMatsDis,
    preferredFits: nextFits,
    dislikedFits: nextFitsDis,
    preferredPatterns: nextPat,
    dislikedPatterns: nextPatDis,
  };
  if (budgetMin !== undefined) data.budgetMin = budgetMin;
  if (budgetMax !== undefined) data.budgetMax = budgetMax;
  if (budgetTarget !== undefined) data.budgetTypical = budgetTarget;
  if (currency) data.currency = currency.toUpperCase().slice(0, 6);

  if (!existing) {
    await tx.categoryPreference.create({
      data: {
        userId,
        category,
        subcategory,
        ...data,
        confidence: o.confidence,
        evidenceCount: 1,
      },
    });
    return;
  }

  await tx.categoryPreference.update({
    where: { id: existing.id },
    data: {
      ...data,
      confidence: Math.max(existing.confidence, o.confidence),
      evidenceCount: { increment: 1 },
    },
  });
}

async function projectBrandPreference(
  tx: InteractiveTransactionClient,
  userId: string,
  o: Obs,
) {
  if (!observationTargetsBuyer(o)) return;

  const brand = (o.brand ?? asString(attrs(o).brand))?.trim();
  if (!brand) return;
  const category = o.category ?? asString(attrs(o).category) ?? "";

  const sentiment = brandSentimentFor(o);
  const strength = Math.min(1, Math.max(0, o.confidence));
  const reasons = asStringArray(attrs(o).reasons ?? attrs(o).reason);
  const owns = asBoolean(attrs(o).ownsProducts);
  const aspirational = asBoolean(attrs(o).aspirational);

  const existing = await tx.brandPreference.findUnique({
    where: {
      userId_brand_category: { userId, brand, category },
    },
  });

  if (!existing) {
    await tx.brandPreference.create({
      data: {
        userId,
        brand,
        category,
        sentiment,
        strength,
        reasons: mergeStringSet([], reasons),
        ownsProducts: owns ?? false,
        aspirational: aspirational ?? false,
        confidence: o.confidence,
        evidenceCount: 1,
      },
    });
    return;
  }

  await tx.brandPreference.update({
    where: { id: existing.id },
    data: {
      sentiment:
        o.confidence >= existing.confidence ? sentiment : existing.sentiment,
      strength: Math.max(existing.strength, strength),
      reasons: mergeStringSet(existing.reasons, reasons),
      ownsProducts: owns ?? existing.ownsProducts,
      aspirational: aspirational ?? existing.aspirational,
      confidence: Math.max(existing.confidence, o.confidence),
      evidenceCount: { increment: 1 },
    },
  });
}

async function projectRecipient(
  tx: InteractiveTransactionClient,
  userId: string,
  o: Obs,
) {
  const label = (
    o.recipientLabel ??
    asString(attrs(o).recipientLabel) ??
    asString(attrs(o).label)
  )
    ?.toLowerCase()
    .trim();
  if (!label) return;

  const a = attrs(o);
  const name = asString(a.name);
  const relationship = asString(a.relationship) ?? label;
  const ageRange = asString(a.ageRange);
  const birth = asString(a.birthDate);

  const knownPrefs = asStringArray(a.knownPreferences ?? a.preferences);
  const dislikes = asStringArray(a.dislikes);
  const favBrands = asStringArray(a.favoriteBrands);
  const disBrands = asStringArray(a.dislikedBrands);

  const sizes = (
    a.sizes && typeof a.sizes === "object" ? a.sizes : {}
  ) as Record<string, unknown>;
  const importantDates = Array.isArray(a.importantDates)
    ? a.importantDates
    : [];
  const giftHistory = Array.isArray(a.giftHistory) ? a.giftHistory : [];

  const existing = await tx.recipient.findUnique({
    where: { userId_label: { userId, label } },
  });

  if (!existing) {
    await tx.recipient.create({
      data: {
        userId,
        label,
        name: name ?? null,
        relationship: relationship ?? null,
        ageRange: ageRange ?? null,
        birthDate: birth ? new Date(birth) : null,
        knownPreferences: mergeStringSet([], knownPrefs),
        dislikes: mergeStringSet([], dislikes),
        favoriteBrands: mergeStringSet([], favBrands),
        dislikedBrands: mergeStringSet([], disBrands),
        sizes: sizes as object,
        importantDates: importantDates as object,
        giftHistory: giftHistory as object,
        confidence: o.confidence,
        evidenceCount: 1,
      },
    });
    return;
  }

  const mergedSizes = {
    ...(existing.sizes as Record<string, unknown>),
    ...sizes,
  };

  await tx.recipient.update({
    where: { id: existing.id },
    data: {
      name: name ?? existing.name,
      relationship: relationship ?? existing.relationship,
      ageRange: ageRange ?? existing.ageRange,
      birthDate: birth ? new Date(birth) : existing.birthDate,
      knownPreferences: mergeStringSet(existing.knownPreferences, knownPrefs),
      dislikes: mergeStringSet(existing.dislikes, dislikes),
      favoriteBrands: mergeStringSet(existing.favoriteBrands, favBrands),
      dislikedBrands: mergeStringSet(existing.dislikedBrands, disBrands),
      sizes: mergedSizes as object,
      confidence: Math.max(existing.confidence, o.confidence),
      evidenceCount: { increment: 1 },
    },
  });
}

async function projectTasteTag(
  tx: InteractiveTransactionClient,
  userId: string,
  o: Obs,
) {
  if (!observationTargetsBuyer(o)) return;

  const a = attrs(o);
  const rawTags = asStringArray(a.tasteTags ?? a.tags);
  const single = asString(a.tag);
  if (single) rawTags.push(single);

  const styleSig =
    o.signalType === "style_like" ||
    o.signalType === "style_dislike" ||
    o.signalType === "color_like" ||
    o.signalType === "color_dislike" ||
    o.signalType === "product_type_like" ||
    o.signalType === "product_type_dislike" ||
    o.signalType === "fit_like" ||
    o.signalType === "fit_dislike";

  if (styleSig) {
    const s =
      asString(a.style) ??
      asString(a.color) ??
      asString(a.material) ??
      asString(a.fit) ??
      asString(a.pattern);
    if (s) rawTags.push(s);
  }

  if (rawTags.length === 0) return;

  const polarity: "positive" | "negative" =
    o.signalType.endsWith("_dislike") || o.signalType === "hard_negative"
      ? "negative"
      : "positive";
  const scope: "global" | "category" = o.category ? "category" : "global";
  const category = o.category ?? "";

  for (const tag of rawTags) {
    const norm = tag.trim().toLowerCase();
    if (!norm) continue;

    const existing = await tx.tasteTag.findUnique({
      where: {
        userId_scope_category_tag_polarity: {
          userId,
          scope,
          category,
          tag: norm,
          polarity,
        },
      },
    });

    if (!existing) {
      await tx.tasteTag.create({
        data: {
          userId,
          scope,
          category,
          tag: norm,
          polarity,
          score: o.importance,
          evidenceCount: 1,
        },
      });
    } else {
      await tx.tasteTag.update({
        where: { id: existing.id },
        data: {
          score: Math.min(1, existing.score + 0.05),
          evidenceCount: { increment: 1 },
        },
      });
    }
  }
}

async function projectHardNegative(
  tx: InteractiveTransactionClient,
  userId: string,
  o: Obs,
) {
  if (!o.isHardRule && o.signalType !== "hard_negative") return;
  const scope = hardNegativeScopeFor(o);
  if (!scope) return;
  const value = hardNegativeValueFor(o, scope);
  if (!value) return;
  const reason = hardNegativeReasonFor(o);
  const category = o.category ?? "";

  await tx.hardNegative.upsert({
    where: {
      userId_scope_value_category: {
        userId,
        scope,
        value: value.trim(),
        category,
      },
    },
    create: {
      userId,
      scope,
      value: value.trim(),
      category,
      reason,
      note: o.normalizedText.slice(0, 280),
    },
    update: {
      reason: reason ?? undefined,
      note: o.normalizedText.slice(0, 280),
    },
  });
}

async function projectOwnedProduct(
  tx: InteractiveTransactionClient,
  userId: string,
  o: Obs,
) {
  if (!observationTargetsBuyer(o)) return;

  const a = attrs(o);
  const category = (o.category ?? asString(a.category) ?? "").trim();
  if (!category) return;

  const subcategory = (o.subcategory ?? asString(a.subcategory) ?? "").trim();
  const brand = (o.brand ?? asString(a.brand) ?? "").trim();
  const productName = (
    asString(a.product) ??
    asString(a.productName) ??
    asString(a.model) ??
    ""
  ).trim();

  // We need at LEAST a product name to slot this; otherwise we can't
  // distinguish between competing items in the same (category, subcategory).
  if (!productName) return;

  const model = (asString(a.model) ?? "").trim();
  const acquiredRaw = asString(a.acquiredAt) ?? asString(a.acquired);
  const acquiredAt = acquiredRaw ? new Date(acquiredRaw) : null;
  const acquiredAtValid =
    acquiredAt && !Number.isNaN(acquiredAt.getTime()) ? acquiredAt : null;
  const acquiredNote = asString(a.acquiredNote);
  const notes = asString(a.notes);

  // Strip the bookkeeping flags from the attribute bag we persist.
  const persistableAttrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    if (
      [
        "product",
        "productName",
        "model",
        "brand",
        "category",
        "subcategory",
        "acquiredAt",
        "acquired",
        "acquiredNote",
        "notes",
        "removed",
        "correction",
      ].includes(k)
    ) {
      continue;
    }
    persistableAttrs[k] = v;
  }

  // Three LLM-emitted intents drive what happens here:
  //   removed  = true → flip THIS specific product to no-longer-current.
  //   replaces = true → add/refresh this product AND retire OTHER current
  //                     items in the same (category, subcategory) slot.
  //                     This is the "actually X not Y" correction case.
  //   neither         → just add/refresh this product. Other items in the
  //                     same slot stay current. This is the additive
  //                     "I have another phone too" case.
  //
  // We deliberately DON'T auto-retire siblings on every insert — that was
  // too opinionated and broke legitimate multi-ownership. The extractor
  // prompt now classifies each statement explicitly and emits the flag.
  const isRemoval = a.removed === true;
  const isReplacement = a.replaces === true || a.correction === true;

  const ownedProduct = ownedProductOf(tx);
  const existing = await ownedProduct.findUnique({
    where: {
      userId_category_subcategory_brand_productName: {
        userId,
        category,
        subcategory,
        brand,
        productName,
      },
    },
  });

  if (!existing) {
    if (isRemoval) {
      // "I sold my X" with no prior record — store as historical so the
      // agent still knows the user used to own it.
      await ownedProduct.create({
        data: {
          userId,
          category,
          subcategory,
          brand,
          productName,
          model,
          attributes: persistableAttrs as object,
          acquiredAt: acquiredAtValid,
          acquiredNote: acquiredNote ?? null,
          notes: notes ?? null,
          isCurrent: false,
          confidence: o.confidence,
          evidenceCount: 1,
        },
      });
      return;
    }

    await ownedProduct.create({
      data: {
        userId,
        category,
        subcategory,
        brand,
        productName,
        model,
        attributes: persistableAttrs as object,
        acquiredAt: acquiredAtValid,
        acquiredNote: acquiredNote ?? null,
        notes: notes ?? null,
        isCurrent: true,
        confidence: o.confidence,
        evidenceCount: 1,
      },
    });
  } else if (isRemoval) {
    await ownedProduct.update({
      where: { id: existing.id },
      data: {
        isCurrent: false,
        evidenceCount: { increment: 1 },
      },
    });
    return;
  } else {
    // Restate or correction-as-update: merge attributes, mark current.
    const mergedAttrs = {
      ...(existing.attributes as Record<string, unknown>),
      ...persistableAttrs,
    };
    await ownedProduct.update({
      where: { id: existing.id },
      data: {
        model: model || existing.model,
        attributes: mergedAttrs as object,
        acquiredAt: acquiredAtValid ?? existing.acquiredAt,
        acquiredNote: acquiredNote ?? existing.acquiredNote,
        notes: notes ?? existing.notes,
        isCurrent: true,
        confidence: Math.max(existing.confidence, o.confidence),
        evidenceCount: { increment: 1 },
      },
    });
  }

  // If the LLM signalled this statement REPLACES the prior item in the
  // same slot, retire every other current row sharing (category,
  // subcategory). Skipping when subcategory is empty avoids accidentally
  // wiping unrelated rows under a broad category.
  if (isReplacement && subcategory) {
    await ownedProduct.updateMany({
      where: {
        userId,
        category,
        subcategory,
        isCurrent: true,
        NOT: { productName },
      },
      data: { isCurrent: false },
    });
  }
}

async function projectActiveIntent(
  tx: InteractiveTransactionClient,
  userId: string,
  intent: Intent,
  sourceMessageId?: string,
) {
  const constraints = (intent.constraints ?? {}) as Record<string, unknown>;
  const category = intent.category ?? asString(constraints.category) ?? null;
  const subcategory = asString(constraints.subcategory) ?? null;
  const neededByRaw = asString(constraints.neededBy);
  const neededBy = neededByRaw ? new Date(neededByRaw) : null;
  const recipientLabel = asString(constraints.recipientLabel)?.toLowerCase();

  let recipientId: string | null = null;
  if (recipientLabel) {
    const r = await tx.recipient.findUnique({
      where: { userId_label: { userId, label: recipientLabel } },
    });
    recipientId = r?.id ?? null;
  }

  const existing = await tx.shoppingIntent.findFirst({
    where: {
      userId,
      status: "active",
      intentName: intent.intentName,
      category,
    },
  });

  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  if (!existing) {
    await tx.shoppingIntent.create({
      data: {
        userId,
        intentName: intent.intentName.slice(0, 240),
        description: null,
        category,
        subcategory,
        recipientId,
        constraints: constraints as object,
        priority: intent.priority,
        neededBy:
          neededBy && !Number.isNaN(neededBy.getTime()) ? neededBy : null,
        sourceMessageId: sourceMessageId ?? null,
        evidenceCount: 1,
        confidence: 0.85,
        expiresAt,
      },
    });
    return;
  }

  const mergedConstraints = {
    ...(existing.constraints as Record<string, unknown>),
    ...constraints,
  };

  await tx.shoppingIntent.update({
    where: { id: existing.id },
    data: {
      constraints: mergedConstraints as object,
      priority: intent.priority,
      neededBy:
        neededBy && !Number.isNaN(neededBy.getTime())
          ? neededBy
          : existing.neededBy,
      recipientId: recipientId ?? existing.recipientId,
      evidenceCount: { increment: 1 },
      confidence: Math.max(existing.confidence, 0.85),
      expiresAt,
    },
  });
}

/**
 * Public entrypoint: project a fresh extraction into typed tables.
 *
 * Runs as a single transaction so an extraction either lands fully or not at all.
 * Idempotent: re-running with the same payload won't duplicate rows.
 */
export async function projectExtractionToTypedTables(params: {
  userId: string;
  extraction: ShoppingMemoryExtraction;
  sourceMessageId?: string;
}): Promise<void> {
  const { userId, extraction, sourceMessageId } = params;

  // The typed projector fans out N upserts/findUniques per observation. With
  // Supabase's pooler RTT (~30-80 ms per statement) and 6+ observations per
  // turn this routinely exceeds Prisma's default 5 s interactive-tx budget,
  // causing "Transaction already closed". The pipeline runs detached from
  // the chat stream so a longer transaction does not slow the user.
  await prisma.$transaction(
    async (tx: InteractiveTransactionClient) => {
      for (const obs of extraction.observations) {
        switch (obs.signalType) {
          case "profile":
            await projectUserProfile(tx, userId, obs);
            break;
          case "size":
          case "fit":
          case "fit_like":
          case "fit_dislike":
            await projectSizing(tx, userId, obs);
            break;
          case "style_like":
          case "style_dislike":
          case "color_like":
          case "color_dislike":
          case "product_type_like":
          case "product_type_dislike":
            await projectCategoryPreference(tx, userId, obs);
            await projectTasteTag(tx, userId, obs);
            break;
          case "brand_like":
          case "brand_dislike":
            await projectBrandPreference(tx, userId, obs);
            break;
          case "budget":
            await projectCategoryPreference(tx, userId, obs);
            break;
          case "product_owned":
            await projectOwnedProduct(tx, userId, obs);
            // Also project brand sentiment as soft positive (you usually like
            // brands you currently own — useful for cross-category nudges).
            if (obs.brand) {
              await projectBrandPreference(tx, userId, obs);
            }
            break;
          case "purchase":
            // Purchases imply current ownership.
            await projectOwnedProduct(tx, userId, obs);
            break;
          case "product_return":
            // Returns imply NOT owning anymore. Flip isCurrent if the
            // extractor sets attributes.removed = true; otherwise leave alone.
            await projectOwnedProduct(tx, userId, obs);
            break;
          case "gift_recipient":
            await projectRecipient(tx, userId, obs);
            break;
          case "shipping":
          case "constraint":
            await projectUserProfile(tx, userId, obs);
            break;
          case "hard_negative":
            await projectHardNegative(tx, userId, obs);
            await projectTasteTag(tx, userId, obs);
            break;
          default:
            break;
        }

        if (obs.isHardRule && obs.signalType !== "hard_negative") {
          await projectHardNegative(tx, userId, obs);
        }
      }

      if (extraction.activeIntent) {
        await projectActiveIntent(
          tx,
          userId,
          extraction.activeIntent,
          sourceMessageId,
        );
      }
    },
    {
      timeout: 30_000,
      maxWait: 5_000,
    },
  );
}
