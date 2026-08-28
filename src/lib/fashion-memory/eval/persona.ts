import { createHash } from "node:crypto";
import { z } from "zod";

export const profileStateSchema = z.enum([
  "new",
  "known_relevant",
  "known_irrelevant",
  "quick_shopper",
  "has_depth_default",
  "has_pick_history",
]);

export const patienceSchema = z.enum(["quick", "normal", "guided"]);
export const volunteersSchema = z.enum(["little", "some", "everything"]);
export const languageSchema = z.enum(["en", "fr", "ar"]);
export const requestTypeSchema = z.enum([
  "single_item",
  "outfit",
  "capsule",
  "multi_item",
]);
export const edgeSchema = z.enum([
  "speed_signal_turn2",
  "dodges_size",
  "refines_after_results",
  "mentions_new_person",
  "typos",
  "changes_mind",
]);

export const personaTruthSchema = z.object({
  request_type: requestTypeSchema,
  garments: z.array(z.string()).min(1),
  owns: z.array(z.string()).default([]),
  occasion: z.string().min(1),
  formality: z.string().optional(),
  color: z.union([z.string(), z.literal("surprise")]).optional(),
  budget: z
    .union([
      z.object({
        max: z.number().positive(),
        currency: z.string(),
        scope: z.enum(["per_item", "total"]),
      }),
      z.literal("no_cap"),
    ])
    .optional(),
  depth: z.union([
    z.object({
      looks: z.number().int().positive().optional(),
      options: z.number().int().positive().optional(),
    }),
    z.literal("you_decide"),
  ]),
  anchor: z.enum(["keep", "push", "explore", "n/a"]),
  brand: z.string().optional(),
  /** Sizes they will give when asked (even if profile has none). */
  sizes: z.record(z.string(), z.string()).optional(),
});

export const personaProfileSchema = z.object({
  state: profileStateSchema,
  department: z.enum(["mens", "womens"]).optional(),
  sizes: z.record(z.string(), z.string()).optional(),
  signals: z.array(z.string()).optional(),
  shopping_style: z.enum(["quick", "guided"]).optional(),
  depth_default: z
    .object({
      count: z.number().int().positive(),
      unit: z.enum(["looks", "options"]),
    })
    .optional(),
  recent_picks: z.array(z.string()).optional(),
});

export const personaSchema = z.object({
  id: z.string().min(8),
  name: z.string().min(1),
  language: languageSchema,
  patience: patienceSchema,
  volunteers: volunteersSchema,
  profile: personaProfileSchema,
  truth: personaTruthSchema,
  opening_message: z.string().min(1),
  edge: edgeSchema.optional(),
  /** vague | partial | complete — generator bookkeeping */
  specificity: z.enum(["vague", "partial", "complete"]).optional(),
});

export type Persona = z.infer<typeof personaSchema>;
export type PersonaTruth = z.infer<typeof personaTruthSchema>;
export type PersonaProfile = z.infer<typeof personaProfileSchema>;
export type ProfileState = z.infer<typeof profileStateSchema>;
export type Patience = z.infer<typeof patienceSchema>;
export type Volunteers = z.infer<typeof volunteersSchema>;
export type PersonaEdge = z.infer<typeof edgeSchema>;

export function patienceRounds(patience: Patience): number {
  if (patience === "quick") return 1;
  if (patience === "guided") return 3;
  return 2;
}

export function personaIdFromFields(fields: Omit<Persona, "id">): string {
  const payload = JSON.stringify({
    name: fields.name,
    language: fields.language,
    patience: fields.patience,
    volunteers: fields.volunteers,
    profile: fields.profile,
    truth: fields.truth,
    opening_message: fields.opening_message,
    edge: fields.edge ?? null,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function withPersonaId(fields: Omit<Persona, "id">): Persona {
  return personaSchema.parse({
    ...fields,
    id: personaIdFromFields(fields),
  });
}
