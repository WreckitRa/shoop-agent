import { z } from "zod";

export const fashionFactGenderPresentationValueSchema = z.object({
  presentation: z.enum(["mens", "womens", "boys", "girls", "baby", "mixed"]),
});

export const fashionFactSizeValueSchema = z.object({
  system: z.enum(["alpha", "eu", "us", "uk", "waist_inseam"]),
  value: z.union([
    z.string(),
    z.number(),
    z.object({
      waist: z.number(),
      inseam: z.number(),
    }),
  ]),
  brand_exception: z
    .object({
      brand: z.string(),
      value: z.union([z.string(), z.number()]),
    })
    .nullable()
    .optional(),
});

export const fashionFactFitValueSchema = z.object({
  fit: z.enum(["slim", "regular", "relaxed", "oversized"]),
});

export const fashionFactNoGoValueSchema = z.object({
  kind: z.enum(["material", "style", "color", "garment"]),
  value: z.string().min(1),
});

export const fashionFactBudgetBandValueSchema = z.object({
  min: z.number().nullable(),
  max: z.number(),
  currency: z.string().min(3).max(3),
});

/** Reserved for future size-chart fit — store only; no consumer yet. */
export const fashionFactMeasurementValueSchema = z.object({
  metric: z.enum(["height", "neck", "chest", "waist", "hips", "inseam"]),
  value: z.number().positive(),
  unit: z.enum(["cm", "in"]),
});
