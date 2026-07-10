import { createHash } from "node:crypto";
import { prisma } from "../db";
import type {
  InputJsonValue,
  InteractiveTransactionClient,
  ShoppingMemoryRow,
} from "../prisma-types";
import type { ShoppingMemoryExtraction } from "./types";
import {
  mapMemoryScope,
  mapObservationSignal,
  mapObservationSource,
  memoryTypeFromSignal,
} from "./signal-maps";

/**
 * Signal types whose canonical ShoppingMemory row represents a single CURRENT
 * FACT (newest statement supersedes the previous one), not an accumulating
 * taste/preference.
 *
 * For these, we key strictly on (scope, signalType, category, subcategory)
 * and ignore any LLM-suggested key that would embed the value itself — so
 * "I'm a US 10" and a later "actually US 11" UPDATE the same row instead of
 * stacking up as two competing memories. Newest also wins on value+confidence.
 *
 * NOTE: product_owned used to be in this set but it's now handled in its own
 * branch in the observation loop — owned products are multi-value-per-slot
 * (user can own two phones) so they live exclusively in the typed
 * OwnedProduct table. See the `if (signalType === "product_owned")` skip
 * above.
 */
const STATEFUL_FACT_SIGNALS = new Set<string>([
  "size",
  "budget",
]);

export function isStatefulFactSignal(signalType: string): boolean {
  return STATEFUL_FACT_SIGNALS.has(signalType.trim().toLowerCase());
}

export function deriveMemoryKey(parts: {
  suggestedMemoryKey?: string | null;
  scope: string;
  signalType: string;
  category?: string | null;
  subcategory?: string | null;
  normalizedText: string;
}): string {
  if (isStatefulFactSignal(parts.signalType)) {
    const slotKey = [
      parts.scope,
      parts.signalType,
      parts.category ?? "",
      parts.subcategory ?? "",
    ].join("|");
    return createHash("sha256").update(slotKey).digest("hex").slice(0, 48);
  }

  const sug = parts.suggestedMemoryKey?.trim();
  if (sug) {
    return slugKey(sug).slice(0, 200);
  }
  const base = [
    parts.scope,
    parts.signalType,
    parts.category ?? "",
    parts.subcategory ?? "",
    parts.normalizedText.toLowerCase().slice(0, 400),
  ].join("|");
  return createHash("sha256").update(base).digest("hex").slice(0, 48);
}

function slugKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 200);
}

function parseExpires(iso?: string): Date | undefined {
  if (!iso?.trim()) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Generous timeout for the persistence transaction.
 *
 * The default Prisma interactive-tx budget is 5 s, which is too tight on
 * Supabase's session-mode pooler: every statement adds 30–80 ms of network
 * round-trip latency, so an extraction that returns 6+ observations easily
 * blows past 5 s and crashes with "Transaction already closed". This pipeline
 * runs detached from the chat stream (caller spawns it with its own abort
 * controller), so a longer transaction does not slow the user.
 */
const SHOPPING_MEMORY_TX_TIMEOUT_MS = 30_000;

type PromotableObservation = {
  obs: ShoppingMemoryExtraction["observations"][number];
  memoryKey: string;
};

export async function writeMemoryFromExtraction(
  userId: string,
  conversationId: string | null | undefined,
  messageId: string | null | undefined,
  extraction: ShoppingMemoryExtraction,
): Promise<void> {
  const hasWork =
    extraction.observations.length > 0 ||
    extraction.activeIntent ||
    extraction.profileUpdates;

  /** Persist whenever the model returned observations/intent/profile deltas — even if it marked the turn not shopping-specific. */
  if (!hasWork) return;

  // -------- 1) Pre-resolve memory keys + existing rows OUTSIDE the tx.
  // We do this to shrink the critical section: by the time we open the
  // interactive transaction, all read work is already done, and the tx
  // only has to perform writes (one batched lookup + N creates/updates).
  const promotable: PromotableObservation[] = [];
  for (const obs of extraction.observations) {
    if (!obs.shouldPromoteToMemory) continue;
    const memoryKey = deriveMemoryKey({
      suggestedMemoryKey: obs.suggestedMemoryKey,
      scope: obs.scope,
      signalType: obs.signalType,
      category: obs.category,
      subcategory: obs.subcategory,
      normalizedText: obs.normalizedText,
    });
    promotable.push({ obs, memoryKey });
  }

  const intent = extraction.activeIntent ?? null;
  const intentLine = intent
    ? `Active intent: ${intent.intentName}${intent.category ? ` (${intent.category})` : ""}. Constraints: ${JSON.stringify(intent.constraints ?? {})}`
    : null;
  const intentMemoryKey = intent
    ? deriveMemoryKey({
        suggestedMemoryKey: `session.intent.${slugKey(intent.intentName)}`,
        scope: "session",
        signalType: "wishlist",
        category: intent.category,
        normalizedText: intentLine!,
      })
    : null;

  // Batch-fetch every ShoppingMemory row we might touch in one round-trip.
  const allKeys = [
    ...promotable.map((p) => p.memoryKey),
    ...(intentMemoryKey ? [intentMemoryKey] : []),
  ];
  const existingRows: ShoppingMemoryRow[] = allKeys.length
    ? await prisma.shoppingMemory.findMany({
        where: {
          userId,
          memoryKey: { in: allKeys },
        },
      })
    : [];
  const existingByKey = new Map<string, ShoppingMemoryRow>(
    existingRows.map((r: ShoppingMemoryRow) => [r.memoryKey, r] as const),
  );

  // -------- 2) Apply writes in a small interactive tx.
  await prisma.$transaction(
    async (tx: InteractiveTransactionClient) => {
      if (extraction.profileUpdates) {
        const u = extraction.profileUpdates;
        const hasAny =
          u.styleSummary !== undefined ||
          u.sizingSummary !== undefined ||
          u.budgetSummary !== undefined ||
          u.brandSummary !== undefined ||
          u.dislikesSummary !== undefined ||
          u.logisticsSummary !== undefined;
        if (hasAny) {
          await tx.shoppingProfileSummary.upsert({
            where: { userId },
            create: {
              userId,
              summary: "",
              styleSummary: u.styleSummary ?? null,
              sizingSummary: u.sizingSummary ?? null,
              budgetSummary: u.budgetSummary ?? null,
              brandSummary: u.brandSummary ?? null,
              dislikesSummary: u.dislikesSummary ?? null,
              logisticsSummary: u.logisticsSummary ?? null,
              version: 1,
            },
            update: {
              ...(u.styleSummary !== undefined
                ? { styleSummary: u.styleSummary }
                : {}),
              ...(u.sizingSummary !== undefined
                ? { sizingSummary: u.sizingSummary }
                : {}),
              ...(u.budgetSummary !== undefined
                ? { budgetSummary: u.budgetSummary }
                : {}),
              ...(u.brandSummary !== undefined
                ? { brandSummary: u.brandSummary }
                : {}),
              ...(u.dislikesSummary !== undefined
                ? { dislikesSummary: u.dislikesSummary }
                : {}),
              ...(u.logisticsSummary !== undefined
                ? { logisticsSummary: u.logisticsSummary }
                : {}),
              version: { increment: 1 },
            },
          });
        }
      }

      for (const obs of extraction.observations) {
        const signalType = mapObservationSignal(obs.signalType);
        const source = mapObservationSource(obs.source);
        const stability = obs.stability;

        const obsRow = await tx.memoryObservation.create({
          data: {
            userId,
            conversationId: conversationId ?? null,
            messageId: messageId ?? null,
            signalType,
            rawText: obs.rawText.slice(0, 12_000),
            normalizedText: obs.normalizedText.slice(0, 12_000),
            entityType: obs.recipientLabel ? "recipient" : undefined,
            entityName: obs.recipientLabel,
            category: obs.category,
            subcategory: obs.subcategory,
            brand: obs.brand,
            attributes: obs.attributes as InputJsonValue,
            confidence: obs.confidence,
            importance: obs.importance,
            stability,
            source,
          },
        });

        // product_owned lives exclusively in the typed OwnedProduct table —
        // the canonical ShoppingMemory row can only hold ONE value per slot
        // key, which silently broke multi-ownership ("I have two phones").
        // Also opportunistically retire any legacy `owned_product` canonical
        // rows from before this refactor so they stop leaking into the
        // <other_memories> fallback in retrieval. The typed projector still
        // runs in `projectExtractionToTypedTables` and handles the row.
        if (signalType === "product_owned") {
          await tx.shoppingMemory.updateMany({
            where: {
              userId,
              isActive: true,
              type: "owned_product",
              category: obs.category ?? undefined,
              ...(obs.subcategory
                ? { subcategory: obs.subcategory }
                : {}),
            },
            data: { isActive: false },
          });
          continue;
        }

        if (!obs.shouldPromoteToMemory) continue;

        const memoryKey = promotable.find((p) => p.obs === obs)?.memoryKey;
        if (!memoryKey) continue;

        const scope = mapMemoryScope(obs.scope);
        const memType = memoryTypeFromSignal(signalType);
        const expiresAt = parseExpires(obs.expiresAt);

        const existing = existingByKey.get(memoryKey);

        // Removal observation: user said they no longer own / use / have this
        // thing. Deactivate any matching canonical row but DON'T overwrite the
        // remembered value — that history is useful ("you used to own a Sony,
        // want to compare alternatives?"). Skip insert when there's nothing
        // to mark.
        const isRemoval =
          (obs.attributes as Record<string, unknown> | undefined)?.removed ===
          true;
        if (isRemoval) {
          if (existing) {
            await tx.shoppingMemory.update({
              where: { id: existing.id },
              data: {
                isActive: false,
                evidenceCount: existing.evidenceCount + 1,
                evidenceObservationIds: [
                  ...existing.evidenceObservationIds,
                  obsRow.id,
                ].slice(-64),
              },
            });
          }
          // Also catch legacy stale rows that pre-date the slot-key fix.
          if (obs.category || obs.subcategory) {
            await tx.shoppingMemory.updateMany({
              where: {
                userId,
                isActive: true,
                type: memType,
                category: obs.category ?? undefined,
                subcategory: obs.subcategory ?? undefined,
              },
              data: { isActive: false },
            });
          }
          continue;
        }

        if (!existing) {
          // Stateful single-value slots (size, budget): if any pre-existing
          // rows describe the same (signalType, category, subcategory) but
          // were saved under a legacy key (e.g. value embedded in the key),
          // deactivate them. The new row under the canonical slot key is
          // the source of truth. product_owned is handled separately above —
          // it doesn't reach this branch.
          if (
            isStatefulFactSignal(obs.signalType) &&
            (obs.category || obs.subcategory)
          ) {
            await tx.shoppingMemory.updateMany({
              where: {
                userId,
                isActive: true,
                type: memType,
                category: obs.category ?? undefined,
                subcategory: obs.subcategory ?? undefined,
                NOT: { memoryKey },
              },
              data: { isActive: false },
            });
          }

          await tx.shoppingMemory.create({
            data: {
              userId,
              memoryKey,
              value: obs.normalizedText.slice(0, 12_000),
              type: memType,
              scope,
              category: obs.category,
              subcategory: obs.subcategory,
              brand: obs.brand,
              confidence: obs.confidence,
              importance: obs.importance,
              isHardRule: obs.isHardRule,
              evidenceCount: 1,
              evidenceObservationIds: [obsRow.id],
              expiresAt,
            },
          });
        } else {
          const mergedEvidence = [
            ...existing.evidenceObservationIds,
            obsRow.id,
          ].slice(-64);

          if (isStatefulFactSignal(obs.signalType)) {
            // CURRENT-FACT slot (e.g. product_owned): newest user statement
            // is the source of truth. Replace value/confidence/brand/category
            // outright so "I have iPhone 17 Pro Max" → "actually iPhone X"
            // updates the row instead of leaving the old value alive.
            await tx.shoppingMemory.update({
              where: { id: existing.id },
              data: {
                value: obs.normalizedText.slice(0, 12_000),
                confidence: obs.confidence,
                importance: Math.max(existing.importance, obs.importance),
                isHardRule: existing.isHardRule || obs.isHardRule,
                evidenceCount: existing.evidenceCount + 1,
                evidenceObservationIds: mergedEvidence,
                expiresAt: expiresAt ?? existing.expiresAt,
                category: obs.category ?? existing.category,
                subcategory: obs.subcategory ?? existing.subcategory,
                brand: obs.brand ?? existing.brand,
              },
            });
          } else {
            // Accumulating taste/preference signal: keep the higher-confidence
            // narrative; never let a lower-confidence restatement clobber it.
            const nextValue =
              obs.confidence >= existing.confidence
                ? obs.normalizedText.slice(0, 12_000)
                : existing.value;

            await tx.shoppingMemory.update({
              where: { id: existing.id },
              data: {
                value: nextValue,
                confidence: Math.max(existing.confidence, obs.confidence),
                importance: Math.max(existing.importance, obs.importance),
                isHardRule: existing.isHardRule || obs.isHardRule,
                evidenceCount: existing.evidenceCount + 1,
                evidenceObservationIds: mergedEvidence,
                expiresAt: expiresAt ?? existing.expiresAt,
                category: obs.category ?? existing.category,
                subcategory: obs.subcategory ?? existing.subcategory,
                brand: obs.brand ?? existing.brand,
              },
            });
          }
        }
      }

      if (intent && intentLine && intentMemoryKey) {
        const existing = existingByKey.get(intentMemoryKey);
        if (!existing) {
          await tx.shoppingMemory.create({
            data: {
              userId,
              memoryKey: intentMemoryKey,
              value: intentLine.slice(0, 12_000),
              type: "intent",
              scope: "session",
              category: intent.category,
              confidence: 0.85,
              importance: 0.75,
              isHardRule: false,
              evidenceCount: 1,
              evidenceObservationIds: [],
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          });
        } else {
          await tx.shoppingMemory.update({
            where: { id: existing.id },
            data: {
              value: intentLine.slice(0, 12_000),
              importance: Math.max(existing.importance, 0.75),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          });
        }
      }
    },
    {
      timeout: SHOPPING_MEMORY_TX_TIMEOUT_MS,
      maxWait: 5_000,
    },
  );
}
