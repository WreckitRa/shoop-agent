import { z } from "zod";
import { onboardingPatchSchema } from "@/lib/onboarding/status";

export const tasteDeckQuerySchema = z.object({
  mode: z.enum(["worn", "aspirational"]).default("worn"),
  genderPresentation: z.string().optional(),
  styleEra: z.string().optional(),
  lifestyleTags: z.string().optional(),
  valuePhilosophy: z.string().optional(),
  brandLikes: z.string().optional(),
  brandAvoids: z.string().optional(),
  shippingCountry: z.string().optional(),
  currency: z.string().optional(),
  wornLabels: z.string().optional(),
  wornTasteTags: z.string().optional(),
  wornLookIds: z.string().optional(),
  excludeLookIds: z.string().optional(),
});

const outfitPickSchema = z
  .object({
    id: z.string().min(1).max(256),
    label: z.string().min(1).max(80),
    tasteTags: z.array(z.string().max(80)).max(16).optional(),
    productTitle: z.string().max(280).optional(),
    productId: z.string().max(256).optional(),
    archetype: z.string().max(40).optional(),
  })
  .strict();

export const tastePostSchema = z
  .object({
    wornPicks: z.array(outfitPickSchema).max(6).optional(),
    aspirationalPicks: z.array(outfitPickSchema).max(4).optional(),
    brandLikes: z.array(z.string().max(120)).max(40).optional(),
    brandAvoids: z.array(z.string().max(120)).max(40).optional(),
    hardAvoids: z.array(z.string().max(120)).max(20).optional(),
    comfort: z.array(z.string().max(160)).max(16).optional(),
    compliments: z.array(z.string().max(40)).max(4).optional(),
    honestyPreference: z
      .enum(["1", "2", "3", "4", "5", "gentle", "straight", "no_mercy"])
      .optional()
      .nullable(),
    styleFriction: z.string().max(2000).optional().nullable(),
    styleBecome: z.string().max(2000).optional().nullable(),
    valuePhilosophy: z.string().max(120).optional().nullable(),
    complete: z.boolean().optional(),
  })
  .strict();

export const reviewPostSchema = z
  .object({
    patch: onboardingPatchSchema,
    extraNotes: z.string().max(24_000).optional(),
    requestKey: z.string().min(8).max(128),
  })
  .strict();

export const circlePostSchema = z
  .object({
    names: z.array(z.string().max(40)).max(6),
  })
  .strict();

export const brandsPostSchema = z
  .object({
    name: z.string().min(1).max(60),
  })
  .strict();

const fittingTellSteps = [
  "consent",
  "photo",
  "name",
  "life",
  "spend",
  "fit",
  "worn",
  "corner",
  "wanted",
  "nolist",
  "honesty",
  "circle",
  "verdict",
] as const;

export const fittingTellPostSchema = z
  .object({
    text: z.string().min(1).max(2000),
    known: z
      .object({
        preferredName: z.string().max(120).optional(),
        genderPresentation: z.string().max(40).optional(),
        styleEras: z.array(z.string().max(40)).max(8).optional(),
        budgetPhilosophies: z.array(z.string().max(40)).max(8).optional(),
        brandLikes: z.array(z.string().max(60)).max(20).optional(),
        brandAvoids: z.array(z.string().max(60)).max(20).optional(),
        hardAvoids: z.array(z.string().max(80)).max(20).optional(),
        comfort: z.array(z.string().max(80)).max(16).optional(),
        weekIs: z.string().max(40).optional(),
        dressingFor: z.string().max(40).optional(),
        kids: z.string().max(20).optional(),
        climate: z.string().max(40).optional(),
        honestyPreference: z.string().max(40).optional(),
        styleFriction: z.string().max(2000).optional(),
        styleBecome: z.string().max(2000).optional(),
        circleNames: z.array(z.string().max(40)).max(3).optional(),
        heightCm: z.number().int().min(50).max(280).nullable().optional(),
        weightKg: z.number().int().min(20).max(400).nullable().optional(),
        build: z.string().max(40).nullable().optional(),
        currentStep: z.enum(fittingTellSteps).optional(),
      })
      .optional(),
  })
  .strict();
