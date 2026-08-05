import { z } from "zod";
import { GUEST_FASHION_MEMORY_VERSION } from "@/lib/fashion-memory/local/store";
import {
  MAX_OUTPUT_TOKENS_MAX,
  MAX_OUTPUT_TOKENS_MIN,
  MAX_USER_MESSAGE_LENGTH,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  isAllowedModel,
} from "./constants";

const guestFashionMemoryPayloadSchema = z.object({
  version: z.literal(GUEST_FASHION_MEMORY_VERSION),
  people: z.array(z.record(z.string(), z.unknown())).default([]),
  fashion_facts: z.array(z.record(z.string(), z.unknown())).default([]),
  style_signals: z.array(z.record(z.string(), z.unknown())).default([]),
  request_events: z.array(z.record(z.string(), z.unknown())).default([]),
  extraction_runs: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const responseStyleSchema = z.enum(["concise", "balanced", "detailed"]);

const optionalAllowedModel = z
  .string()
  .optional()
  .refine((m) => m === undefined || isAllowedModel(m), "Unsupported model");

export const settingsPayloadSchema = z
  .object({
    model: optionalAllowedModel,
    temperature: z.number().min(TEMPERATURE_MIN).max(TEMPERATURE_MAX).optional(),
    maxTokens: z
      .number()
      .int()
      .min(MAX_OUTPUT_TOKENS_MIN)
      .max(MAX_OUTPUT_TOKENS_MAX)
      .optional(),
    responseStyle: responseStyleSchema.optional(),
    systemPrompt: z.string().max(8000).optional(),
  })
  .strict();

export const chatStreamModeSchema = z.enum(["send", "edit", "regenerate"]);

export type ChatStreamMode = z.infer<typeof chatStreamModeSchema>;

const composerReplyContextSchema = z
  .object({
    productId: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    reason: z.string().max(2000).optional(),
    slot: z.string().max(80).optional(),
    verdict: z.string().max(40).optional(),
    imageUrl: z.string().max(2000).optional(),
    priceLabel: z.string().max(80).optional(),
    sourceMessageId: z.string().cuid(),
  })
  .strict();

export const chatPostBodySchema = z
  .object({
    conversationId: z.string().cuid().optional(),
    /** Default 'send'. Edit/regenerate flow through a single SSE round-trip. */
    mode: chatStreamModeSchema.optional(),
    message: z.string().max(MAX_USER_MESSAGE_LENGTH).optional(),
    /** edit: latest user message id. regenerate: latest assistant id. */
    targetMessageId: z.string().cuid().optional(),
    /** Product pick the user is replying about — enriches the model prompt and is shown on the user bubble. */
    replyContext: composerReplyContextSchema.optional(),
    settings: settingsPayloadSchema.optional(),
    /** Guest fashion memory snapshot for profile-aware routing. */
    guestFashionMemory: guestFashionMemoryPayloadSchema.optional(),
    /** Assistant message id holding the mid-session fashion quiz just answered. */
    fashionClarificationMessageId: z.string().min(1).max(80).optional(),
    /** question.text → structured answer. */
    fashionClarificationAnswers: z
      .record(
        z.string().max(500),
        z.object({
          selected: z.array(z.string().max(200)).max(12),
          customText: z.string().max(500).optional(),
        }),
      )
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const mode: ChatStreamMode = val.mode ?? "send";

    if (mode === "send" || mode === "edit") {
      const m = val.message?.trim();
      if (!m) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "`message` is required",
          path: ["message"],
        });
      }
    }
    if (mode === "edit" || mode === "regenerate") {
      if (!val.targetMessageId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "`targetMessageId` is required",
          path: ["targetMessageId"],
        });
      }
    }
    if (mode !== "send" && !val.conversationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`conversationId` is required for non-send modes",
        path: ["conversationId"],
      });
    }
  });

export const conversationPostSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    archived: z.boolean().optional(),
    pinned: z.boolean().optional(),
    model: optionalAllowedModel,
    temperature: z.number().min(TEMPERATURE_MIN).max(TEMPERATURE_MAX).optional(),
    maxTokens: z
      .number()
      .int()
      .min(MAX_OUTPUT_TOKENS_MIN)
      .max(MAX_OUTPUT_TOKENS_MAX)
      .optional(),
    responseStyle: responseStyleSchema.optional(),
    systemPrompt: z.string().max(8000).nullable().optional(),
    shippingCountry: z.string().max(80).nullable().optional(),
    currency: z.string().max(6).nullable().optional(),
  })
  .strict();

export const conversationPatchSchema = conversationPostSchema.partial();

export const messagePatchSchema = z
  .object({
    status: z.enum(["completed", "streaming", "failed", "stopped"]).optional(),
    content: z.string().max(MAX_USER_MESSAGE_LENGTH).optional(),
  })
  .strict();
