import { z } from "zod";

/**
 * Validators for the typed user-knowledge endpoints under /api/profile.
 *
 * Permissive on shape (everything optional in PATCH), strict on values.
 * Keep these schemas the single source of truth for the UI form layer.
 */

const enumOrEmpty = (allowed: readonly string[]) =>
  z
    .string()
    .max(80)
    .refine(
      (v) => v === "" || (allowed as readonly string[]).includes(v),
      `must be one of ${allowed.join(", ")} or empty`,
    );

const birthDateString = z
  .string()
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) ||
      /^\d{4}-\d{2}-\d{2}$/.test(v),
    "must be an ISO date or datetime",
  );

export const styleMixSchema = z
  .object({
    axes: z
      .array(
        z.object({
          label: z.string().min(1).max(40),
          percent: z.number().min(0).max(100),
        }),
      )
      .min(1)
      .max(6),
    headingToward: z.string().max(40).optional().nullable(),
    headingPercent: z.number().min(0).max(100).optional().nullable(),
  })
  .strict();

export const userProfilePatchSchema = z
  .object({
    preferredName: z.string().max(120).optional().nullable(),
    pronouns: z.string().max(40).optional().nullable(),
    ageRange: z.string().max(20).optional().nullable(),
    birthDate: birthDateString.optional().nullable(),
    genderPresentation: z.string().max(40).optional().nullable(),
    country: z.string().max(80).optional().nullable(),
    city: z.string().max(120).optional().nullable(),
    currency: z.string().max(6).optional().nullable(),
    language: z.string().max(20).optional().nullable(),
    timezone: z.string().max(60).optional().nullable(),
    climate: z.string().max(40).optional().nullable(),
    unitsLength: enumOrEmpty(["cm", "in"]).optional(),
    unitsWeight: enumOrEmpty(["kg", "lb"]).optional(),
    unitsShoe: enumOrEmpty(["EU", "US", "UK"]).optional(),
    occupation: z.string().max(120).optional().nullable(),
    workEnvironment: z.string().max(80).optional().nullable(),
    lifestyleTags: z.array(z.string().max(60)).max(24).optional(),
    valuePhilosophy: z.string().max(40).optional().nullable(),
    decisionStyle: z.string().max(40).optional().nullable(),
    riskTolerance: z.string().max(40).optional().nullable(),
    dealSensitivity: z.string().max(40).optional().nullable(),
    qualityThreshold: z.string().max(40).optional().nullable(),
    shippingCountry: z.string().max(80).optional().nullable(),
    acceptsInternational: z.boolean().optional().nullable(),
    preferredDeliverySpeed: z.string().max(40).optional().nullable(),
    primaryAiAssistant: enumOrEmpty([
      "chatgpt",
      "claude",
      "gemini",
      "copilot",
      "perplexity",
      "meta_ai",
      "other",
    ]).optional().nullable(),
    styleEra: z.string().max(40).optional().nullable(),
    honestyPreference: enumOrEmpty([
      "gentle",
      "straight",
      "no_mercy",
    ]).optional().nullable(),
    complimentPreferences: z.array(z.string().max(40)).max(4).optional(),
    styleMix: styleMixSchema.optional().nullable(),
  })
  .strict();

export const sizingProfilePatchSchema = z
  .object({
    heightCm: z.number().int().min(50).max(280).optional().nullable(),
    weightKg: z.number().int().min(20).max(400).optional().nullable(),
    bodyType: z.string().max(40).optional().nullable(),
    shoulderWidth: z.string().max(40).optional().nullable(),
    topUsualSize: z.string().max(40).optional().nullable(),
    topPreferredFit: z.string().max(40).optional().nullable(),
    topNotes: z.array(z.string().max(120)).max(16).optional(),
    bottomWaist: z.string().max(20).optional().nullable(),
    bottomInseam: z.string().max(20).optional().nullable(),
    bottomRise: z.string().max(20).optional().nullable(),
    bottomPreferredFit: z.string().max(40).optional().nullable(),
    bottomUsualSize: z.string().max(40).optional().nullable(),
    bottomNotes: z.array(z.string().max(120)).max(16).optional(),
    shoeEU: z.number().min(15).max(70).optional().nullable(),
    shoeUS: z.number().min(0).max(20).optional().nullable(),
    shoeUK: z.number().min(0).max(20).optional().nullable(),
    shoeWidth: z.string().max(20).optional().nullable(),
    shoeNotes: z.array(z.string().max(120)).max(16).optional(),
    neckSize: z.string().max(20).optional().nullable(),
    sleeveLength: z.string().max(20).optional().nullable(),
    ringSize: z.string().max(20).optional().nullable(),
    gloveSize: z.string().max(20).optional().nullable(),
    sensitivities: z.array(z.string().max(160)).max(16).optional(),
    brandSizingNotes: z
      .array(
        z.object({
          brand: z.string().max(80),
          category: z.string().max(80).optional(),
          usualSize: z.string().max(40),
          notes: z.string().max(280).optional(),
        }),
      )
      .max(32)
      .optional(),
  })
  .strict();

export const recipientPostSchema = z
  .object({
    label: z.string().min(1).max(60),
    name: z.string().max(120).optional(),
    relationship: z.string().max(80).optional(),
    ageRange: z.string().max(20).optional(),
    birthDate: z.string().datetime().optional(),
    knownPreferences: z.array(z.string().max(120)).max(20).optional(),
    dislikes: z.array(z.string().max(120)).max(20).optional(),
    favoriteBrands: z.array(z.string().max(80)).max(20).optional(),
    dislikedBrands: z.array(z.string().max(80)).max(20).optional(),
    sizes: z.record(z.string(), z.string().max(40)).optional(),
    importantDates: z
      .array(
        z.object({
          label: z.string().max(80),
          date: z.string().max(40),
        }),
      )
      .max(20)
      .optional(),
    giftHistory: z
      .array(
        z.object({
          productName: z.string().max(280),
          occasion: z.string().max(80).optional(),
          reaction: z.enum(["loved", "liked", "neutral", "bad"]).optional(),
          date: z.string().max(40).optional(),
        }),
      )
      .max(50)
      .optional(),
    privacyLevel: z.enum(["normal", "sensitive"]).optional(),
  })
  .strict();

export const recipientPatchSchema = recipientPostSchema.partial();

export const intentPostSchema = z
  .object({
    intentName: z.string().min(1).max(240),
    description: z.string().max(2000).optional(),
    category: z.string().max(80).optional(),
    subcategory: z.string().max(80).optional(),
    recipientId: z.string().cuid().optional(),
    constraints: z.record(z.string(), z.unknown()).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    neededBy: z.string().datetime().optional(),
  })
  .strict();

export const intentPatchSchema = z
  .object({
    status: z.enum(["active", "paused", "completed", "expired"]).optional(),
    intentName: z.string().min(1).max(240).optional(),
    description: z.string().max(2000).optional(),
    category: z.string().max(80).optional(),
    subcategory: z.string().max(80).optional(),
    recipientId: z.string().cuid().nullable().optional(),
    constraints: z.record(z.string(), z.unknown()).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    neededBy: z.string().datetime().nullable().optional(),
  })
  .strict();

export const hardNegativePostSchema = z
  .object({
    scope: z.enum([
      "brand",
      "material",
      "color",
      "retailer",
      "category",
      "ingredient",
      "style",
      "fit",
    ]),
    value: z.string().min(1).max(120),
    category: z.string().max(80).optional(),
    reason: z
      .enum([
        "allergy",
        "ethics",
        "religion",
        "health",
        "taste",
        "past_bad_experience",
        "other",
      ])
      .optional(),
    note: z.string().max(280).optional(),
  })
  .strict();

export const brandPreferencePostSchema = z
  .object({
    brand: z.string().min(1).max(120),
    category: z.string().max(80).optional(),
    sentiment: z.enum(["love", "like", "neutral", "avoid", "hate"]),
    strength: z.number().min(0).max(1).optional(),
    reasons: z.array(z.string().max(160)).max(8).optional(),
    ownsProducts: z.boolean().optional(),
    aspirational: z.boolean().optional(),
  })
  .strict();

export const brandPreferencePatchSchema = brandPreferencePostSchema.partial();

export const ownedProductPostSchema = z
  .object({
    category: z.string().min(1).max(80),
    subcategory: z.string().max(80).optional(),
    brand: z.string().max(120).optional(),
    productName: z.string().min(1).max(200),
    model: z.string().max(120).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    acquiredAt: z.string().datetime().optional().nullable(),
    acquiredNote: z.string().max(200).optional().nullable(),
    isCurrent: z.boolean().optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strict();

export const ownedProductPatchSchema = ownedProductPostSchema.partial();
