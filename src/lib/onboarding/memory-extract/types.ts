import { z } from "zod";

/** LLM extraction payload (guide §18). */
export const extractionObservationSchema = z.object({
  signalType: z.string(),
  rawText: z.string(),
  normalizedText: z.string(),
  scope: z.string(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  brand: z.string().optional(),
  recipientLabel: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  stability: z.enum(["temporary", "medium", "stable"]),
  source: z.enum(["explicit", "inferred", "behavioral"]),
  shouldPromoteToMemory: z.boolean(),
  isHardRule: z.boolean(),
  expiresAt: z.string().optional(),
  suggestedMemoryKey: z.string().max(240).optional(),
});

export const onboardingExtractionSchema = z
  .object({
    isShoppingRelevant: z.boolean().optional(),
    observations: z.array(extractionObservationSchema).default([]),
    profileUpdates: z
      .object({
        styleSummary: z.string().optional(),
        sizingSummary: z.string().optional(),
        budgetSummary: z.string().optional(),
        brandSummary: z.string().optional(),
        dislikesSummary: z.string().optional(),
        logisticsSummary: z.string().optional(),
      })
      .optional(),
    activeIntent: z
      .object({
        intentName: z.string(),
        category: z.string().optional(),
        constraints: z.record(z.string(), z.unknown()).optional(),
        priority: z.enum(["low", "medium", "high"]),
      })
      .optional(),
  })
  .transform((data) => {
    const profileUpdates =
      data.profileUpdates &&
      Object.values(data.profileUpdates).some(
        (v) => v != null && String(v).trim() !== "",
      )
        ? data.profileUpdates
        : undefined;

    const hasSignals =
      data.observations.length > 0 ||
      Boolean(data.activeIntent) ||
      Boolean(profileUpdates);

    return {
      ...data,
      profileUpdates,
      isShoppingRelevant: data.isShoppingRelevant ?? hasSignals,
    };
  });

export type OnboardingExtraction = z.infer<
  typeof onboardingExtractionSchema
>;
