import type { ProductCard } from "@/lib/ai-chat/types";
import type { StyleSignalType } from "../types";
import { ensureSelfPerson, listPeopleForUser } from "../people";
import { isGuestUserId } from "@/lib/auth/guest-session";
import { isSupabaseAuthUserId } from "../auth";
import { upsertStyleSignal, logRequestEvent } from "../signals";
import { fashionMemoryDb } from "../db";
import { recordPipelineEvent } from "../observability/trace";

export type InteractionKind =
  | "tier1_expand"
  | "tier2_promote"
  | "tier1_reject"
  | "look_swap"
  | "tier3_verify"
  | "show_more"
  | "outbound_click"
  | "recurate"
  | "tryon_tap";

const SIGNAL_ATTRS: Array<{ key: string; type: StyleSignalType }> = [
  { key: "color", type: "color" },
  { key: "style", type: "style" },
  { key: "brand", type: "brand" },
  { key: "material", type: "material" },
  { key: "pattern", type: "pattern" },
  { key: "garment", type: "garment" },
];

/** Extract signal attributes from normalized candidate data — never raw titles. */
export function attributesFromNormalized(params: {
  colors?: string[];
  style_tags?: string[];
  brand?: string;
  material?: string;
  pattern?: string;
  garment?: string;
}): Array<{ signalType: StyleSignalType; value: string }> {
  const out: Array<{ signalType: StyleSignalType; value: string }> = [];
  const push = (type: StyleSignalType, value?: string) => {
    const v = value?.trim().toLowerCase();
    if (v) out.push({ signalType: type, value: v });
  };
  for (const c of params.colors ?? []) push("color", c);
  for (const s of params.style_tags ?? []) push("style", s);
  push("brand", params.brand);
  push("material", params.material);
  push("pattern", params.pattern);
  push("garment", params.garment);
  return out;
}

export function attributesFromProductCard(
  product: ProductCard,
): Array<{ signalType: StyleSignalType; value: string }> {
  const out: Array<{ signalType: StyleSignalType; value: string }> = [];
  for (const { key, type } of SIGNAL_ATTRS) {
    const hit = product.catalogAttributes?.find(
      (a) => a.name.toLowerCase() === key,
    );
    const value = hit?.value?.trim();
    if (value) out.push({ signalType: type, value: value.toLowerCase() });
  }
  return out;
}

const memoryDedup = new Set<string>();

export function clearInteractionSignalDedup(): void {
  memoryDedup.clear();
}

async function alreadyWritten(
  searchId: string,
  interaction: InteractionKind,
  ref: string,
): Promise<boolean> {
  const key = `${searchId}:${interaction}:${ref}`;
  if (memoryDedup.has(key)) return true;
  if (testSignalCapture || process.env.NODE_ENV === "test") return false;

  const { data } = await fashionMemoryDb()
    .from("interaction_signal_dedup")
    .select("ref")
    .eq("search_id", searchId)
    .eq("interaction", interaction)
    .eq("ref", ref)
    .maybeSingle();
  return Boolean(data);
}

async function markWritten(
  searchId: string,
  interaction: InteractionKind,
  ref: string,
): Promise<void> {
  const key = `${searchId}:${interaction}:${ref}`;
  memoryDedup.add(key);
  if (testSignalCapture || process.env.NODE_ENV === "test") return;
  await fashionMemoryDb()
    .from("interaction_signal_dedup")
    .upsert(
      { search_id: searchId, interaction, ref },
      { onConflict: "search_id,interaction,ref" },
    );
}

let testSignalCapture: Array<{
  interaction: InteractionKind;
  ref: string;
  polarity: -1 | 1;
  confidence: number;
  source: string;
}> | null = null;

export function setTestSignalCapture(
  cap: typeof testSignalCapture,
): void {
  testSignalCapture = cap;
}

/** Gift-search rejections land on the recipient at 0.3 candidate; else unchanged. */
export function giftRejectionTarget(params: {
  selfPersonId: string;
  recipient: { personId: string; isSelf: boolean } | null;
}): { personId: string; confidence: number; status: "candidate" } | null {
  if (!params.recipient || params.recipient.isSelf) return null;
  return {
    personId: params.recipient.personId,
    confidence: 0.3,
    status: "candidate",
  };
}

async function lookupSearchRecipient(
  userId: string,
  searchId: string,
): Promise<{ personId: string; isSelf: boolean } | null> {
  const { data, error } = await fashionMemoryDb()
    .from("request_events")
    .select("person_id, attributes")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data?.length) return null;
  const hit = (
    data as Array<{ person_id: string; attributes: Record<string, unknown> | null }>
  ).find((row) => row.attributes?.search_id === searchId);
  if (!hit) return null;
  const people = await listPeopleForUser(userId);
  const person = people.find((p) => p.id === hit.person_id);
  return {
    personId: hit.person_id,
    isSelf: person?.relation === "self",
  };
}

async function writeSignals(params: {
  userId: string;
  searchId: string;
  interaction: InteractionKind;
  ref: string;
  attributes: Array<{ signalType: StyleSignalType; value: string }>;
  polarity: -1 | 1;
  source: "inferred" | "rejection";
  confidence: number;
  context: string;
  traceId?: string | null;
}): Promise<void> {
  if (params.interaction === "show_more") return;
  if (await alreadyWritten(params.searchId, params.interaction, params.ref)) {
    return;
  }
  if (isGuestUserId(params.userId)) return;
  if (!isSupabaseAuthUserId(params.userId) && !testSignalCapture) return;

  const selfId = testSignalCapture
    ? "test-person"
    : (await ensureSelfPerson(params.userId)).id;
  let personId = selfId;
  let confidence = params.confidence;
  let status: "active" | "candidate" =
    params.source === "rejection" ? "active" : "candidate";
  if (params.source === "rejection" && !testSignalCapture) {
    const gift = giftRejectionTarget({
      selfPersonId: selfId,
      recipient: await lookupSearchRecipient(params.userId, params.searchId),
    });
    if (gift) {
      personId = gift.personId;
      confidence = gift.confidence;
      status = gift.status;
    }
  }
  for (const { signalType, value } of params.attributes) {
    if (testSignalCapture) {
      testSignalCapture.push({
        interaction: params.interaction,
        ref: params.ref,
        polarity: params.polarity,
        confidence,
        source: params.source,
      });
      continue;
    }
    await upsertStyleSignal({
      userId: params.userId,
      personId,
      context: params.context,
      signalType,
      value,
      polarity: params.polarity,
      source: params.source,
      confidence,
      status,
    });
    // CHOKE POINT: announce every successful style_signals write from this map.
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "style_signal_written",
      payload: {
        signal_type: signalType,
        value,
        polarity: params.polarity,
        source: params.source,
        interaction_kind: params.interaction,
        person_id: personId,
        search_id: params.searchId,
        ref: params.ref,
      },
    });
  }
  await markWritten(params.searchId, params.interaction, params.ref);
}

/** Single source of truth — every interaction maps to its style_signals write. */
export async function writeInteractionSignal(params: {
  userId: string;
  searchId: string;
  interaction: InteractionKind;
  ref: string;
  product: ProductCard;
  occasionContext: string;
  demoted?: ProductCard;
  traceId?: string | null;
}): Promise<void> {
  const attrs = attributesFromProductCard(params.product);
  const ctx = params.occasionContext || "general";
  const traceId = params.traceId;

  switch (params.interaction) {
    case "tier1_expand":
      await writeSignals({
        userId: params.userId,
        searchId: params.searchId,
        interaction: params.interaction,
        ref: params.ref,
        attributes: attrs.filter((a) =>
          ["color", "style"].includes(a.signalType),
        ),
        polarity: 1,
        source: "inferred",
        confidence: 0.2,
        context: ctx,
        traceId,
      });
      break;

    case "tier2_promote":
      await writeSignals({
        userId: params.userId,
        searchId: params.searchId,
        interaction: params.interaction,
        ref: params.ref,
        attributes: attrs,
        polarity: 1,
        source: "inferred",
        confidence: 0.4,
        context: ctx,
        traceId,
      });
      if (params.demoted) {
        await writeSignals({
          userId: params.userId,
          searchId: params.searchId,
          interaction: params.interaction,
          ref: params.demoted.id,
          attributes: attributesFromProductCard(params.demoted),
          polarity: -1,
          source: "inferred",
          confidence: 0.2,
          context: ctx,
          traceId,
        });
      }
      break;

    case "tier1_reject":
      await writeSignals({
        userId: params.userId,
        searchId: params.searchId,
        interaction: params.interaction,
        ref: params.ref,
        attributes: attrs,
        polarity: -1,
        source: "rejection",
        confidence: 0.5,
        context: ctx,
        traceId,
      });
      break;

    case "look_swap":
      await writeSignals({
        userId: params.userId,
        searchId: params.searchId,
        interaction: params.interaction,
        ref: params.ref,
        attributes: attrs,
        polarity: 1,
        source: "inferred",
        confidence: 0.3,
        context: ctx,
        traceId,
      });
      break;

    case "tier3_verify":
      await writeSignals({
        userId: params.userId,
        searchId: params.searchId,
        interaction: params.interaction,
        ref: params.ref,
        attributes: attrs.filter((a) =>
          ["color", "style"].includes(a.signalType),
        ),
        polarity: 1,
        source: "inferred",
        confidence: 0.2,
        context: ctx,
        traceId,
      });
      break;

    case "outbound_click":
      await writeSignals({
        userId: params.userId,
        searchId: params.searchId,
        interaction: params.interaction,
        ref: params.ref,
        attributes: attrs,
        polarity: 1,
        source: "inferred",
        confidence: 0.7,
        context: ctx,
        traceId,
      });
      break;

    case "tryon_tap":
      await writeSignals({
        userId: params.userId,
        searchId: params.searchId,
        interaction: params.interaction,
        ref: params.ref,
        attributes: attrs,
        polarity: 1,
        source: "inferred",
        confidence: 0.3,
        context: ctx,
        traceId,
      });
      break;

    case "recurate":
      if (isGuestUserId(params.userId)) return;
      if (!isSupabaseAuthUserId(params.userId)) return;
      if (await alreadyWritten(params.searchId, params.interaction, params.ref)) {
        return;
      }
      await logRequestEvent({
        userId: params.userId,
        personId: (await ensureSelfPerson(params.userId)).id,
        attributes: {
          kind: "recurate",
          search_id: params.searchId,
        },
      });
      await markWritten(params.searchId, params.interaction, params.ref);
      break;

    case "show_more":
      break;
  }
}

/** Look swap writes rejection on swapped-out item separately. */
export async function writeLookSwapSignals(params: {
  userId: string;
  searchId: string;
  swappedOut: ProductCard;
  chosen: ProductCard;
  occasionContext: string;
}): Promise<void> {
  const ctx = params.occasionContext || "general";
  await writeSignals({
    userId: params.userId,
    searchId: params.searchId,
    interaction: "look_swap",
    ref: params.swappedOut.id,
    attributes: attributesFromProductCard(params.swappedOut),
    polarity: -1,
    source: "rejection",
    confidence: 0.3,
    context: ctx,
  });
  await writeInteractionSignal({
    userId: params.userId,
    searchId: params.searchId,
    interaction: "look_swap",
    ref: params.chosen.id,
    product: params.chosen,
    occasionContext: ctx,
  });
}
