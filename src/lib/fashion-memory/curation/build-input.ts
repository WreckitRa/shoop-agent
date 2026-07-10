import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { formatMoney } from "@/lib/money";
import type { BudgetAssembly } from "../budget/budgetAllocation";
import type { BudgetTension } from "../budget/budgetTension";
import type { BudgetInterpretation } from "../budget/budgetAllocation";
import type { FashionSearchPlan } from "../search-planner/types";
import type { CurationRefRegistry, RunFashionCurationParams } from "./types";
import { buildRefRegistry } from "./refs";
import {
  prepareCurationImages,
  type CurationImageBlock,
} from "./curation-images";

function formatPrice(amount?: number, currency?: string): string {
  if (amount == null) return "price unknown";
  return formatMoney(amount, currency ?? "USD");
}

function formatColors(candidate: import("../hydration/types").HydratedCandidate): string {
  const buckets = candidate.normalized?.colors?.buckets ?? [];
  if (buckets.length) return buckets.join(", ");
  return "unknown";
}

function formatSizeStatus(
  candidate: import("../hydration/types").HydratedCandidate,
): string {
  if (candidate.size_status === "confirmed") return "confirmed";
  if (candidate.size_status === "converted" && candidate.size_selection) {
    const from = candidate.size_selection.converted_from;
    const label = candidate.size_selection.merchant_label;
    return from
      ? `converted {from: ${from}, merchant_label: ${label}}`
      : `converted {merchant_label: ${label}}`;
  }
  return "unknown";
}

function formatSuspicions(
  candidate: import("../hydration/types").HydratedCandidate,
): string {
  if (!candidate.suspicions?.length) return "none";
  return candidate.suspicions
    .map((s) => `${s.rule}: ${s.evidence}`)
    .join("; ");
}

export type CurationInputBundle = {
  registry: CurationRefRegistry;
  textBlock: string;
  imageBlocks: CurationImageBlock[];
  userMessages: MessageCreateParamsNonStreaming["messages"];
  /** Photos requested but fetch/resize failed. */
  images_failed: number;
};

export async function buildCurationInput(params: {
  plan: FashionSearchPlan;
  slots: RunFashionCurationParams["slots"];
  tasteSignals?: RunFashionCurationParams["tasteSignals"];
  budget_assembly?: BudgetAssembly;
  budget_tension?: BudgetTension;
  budget_interpretation?: BudgetInterpretation;
  recipientRelation?: string;
  department?: string;
  excludedRefs?: string[];
  /** When true, omit all image blocks (retry after Anthropic image 400). */
  omitImages?: boolean;
  signal?: AbortSignal;
}): Promise<CurationInputBundle> {
  const brief = params.plan.brief;
  const planSlotById = new Map(params.plan.slots.map((s) => [s.slot_id, s]));

  const slotData = params.slots.map((slot) => ({
    slot_id: slot.slot_id,
    planSlot: planSlotById.get(slot.slot_id)!,
    verified: slot.verified_pool ?? [],
  }));

  const registry = buildRefRegistry({
    slots: slotData.filter((s) => s.planSlot),
    mode: params.plan.mode,
  });

  const excluded = new Set(params.excludedRefs ?? []);

  const pendingImages: Array<{ ref: string; url: string }> = [];
  if (!params.omitImages) {
    for (const entry of registry.values()) {
      if (excluded.has(entry.ref) || !entry.image_shown) continue;
      const url =
        entry.candidate.media_urls[0] ?? entry.candidate.image_urls[0];
      if (url?.trim()) pendingImages.push({ ref: entry.ref, url: url.trim() });
    }
  }

  const prepared = params.omitImages
    ? { byRef: new Map<string, CurationImageBlock>(), prepared: 0, failed: 0 }
    : await prepareCurationImages({
        urls: pendingImages,
        signal: params.signal,
      });

  const lines: string[] = [];

  lines.push("=== CONTEXT ===");
  lines.push(
    `Recipient: ${params.recipientRelation ?? "client"} (${params.department ?? brief.knowledge_state?.department ?? "mixed"})`,
  );
  lines.push(`Occasion: ${brief.occasion_context}`);
  lines.push(`Style direction: ${brief.style_direction}`);
  lines.push(`Quantity: ${brief.quantity_hint}`);
  lines.push(`Mode: ${params.plan.mode}`);
  lines.push(`Plan source: ${params.plan.plan_source ?? "planner"}`);
  lines.push(
    `Slots: ${params.plan.slots.length} planned / ${brief.garments.length} brief garments`,
  );
  if (
    (params.plan.mode === "outfit" || params.plan.mode === "capsule") &&
    params.plan.slots.length < Math.min(brief.garments.length, 5)
  ) {
    lines.push(
      `DEGRADED PLAN: fewer slots than the brief — thin_note REQUIRED; do NOT present as a full fitting-room success.`,
    );
  }

  if (params.tasteSignals?.length) {
    lines.push("\nTaste signals (top):");
    for (const sig of params.tasteSignals.slice(0, 8)) {
      const sign = sig.polarity >= 0 ? "+" : "-";
      lines.push(`  ${sign} ${sig.attribute_type}: ${sig.attribute_value}`);
    }
  }

  const allExclusions = [
    ...new Set(params.slots.flatMap((s) => s.curator_exclusions ?? [])),
  ];
  if (allExclusions.length) {
    lines.push("\nCurator exclusions (visual no-gos):");
    for (const ex of allExclusions) lines.push(`  - ${ex}`);
  }

  lines.push("\n=== PLAN SLOTS ===");
  for (const planSlot of params.plan.slots) {
    const slotMeta = params.slots.find((s) => s.slot_id === planSlot.slot_id);
    lines.push(
      `- ${planSlot.slot_id} (${planSlot.garment}) role=${planSlot.role} options_wanted=${planSlot.options_wanted} palette=${planSlot.palette_constraint ?? "spread"} source=${planSlot.palette_source}${slotMeta?.thin_slot ? " [THIN]" : ""}`,
    );
    if (slotMeta?.brand_status) {
      lines.push(
        `  brand_status=${slotMeta.brand_status}${slotMeta.brand_sanity_note ? ` note="${slotMeta.brand_sanity_note}"` : ""}`,
      );
    }
  }

  if (params.budget_assembly) {
    lines.push(
      `\nBudget assembly: total_max=${params.budget_assembly.total_max} ${params.budget_assembly.currency} tolerance=${params.budget_assembly.tolerance}`,
    );
  }
  if (params.budget_tension && params.budget_tension.severity !== "none") {
    lines.push(
      `Budget tension: ${params.budget_tension.severity} — ${JSON.stringify(params.budget_tension.slots)}`,
    );
    lines.push(
      "When tension is tight/infeasible: acknowledge honestly in budget_note. Lift-readmitted items (flagged below) are slightly over the per-slot allocation — closest real options.",
    );
  }
  if (params.budget_interpretation === "per_item_assumed") {
    lines.push("Budget interpretation: per_item_assumed");
  }

  if (excluded.size) {
    lines.push(`\nExcluded refs (prior rounds): ${[...excluded].join(", ")}`);
  }

  lines.push("\n=== CANDIDATES ===");

  const imageBlocks: CurationImageBlock[] = [];

  for (const entry of registry.values()) {
    if (excluded.has(entry.ref)) continue;

    const c = entry.candidate;
    const price = c.final_price ?? c.price;
    const imageBlock = prepared.byRef.get(entry.ref) ?? null;
    entry.image_shown = Boolean(imageBlock);

    lines.push(
      `\n[${entry.ref}] slot=${entry.slot_id} rank=${entry.score_rank}`,
    );
    lines.push(`  title: ${c.title}`);
    lines.push(`  brand_confirmed: ${c.brand_confirmed ?? false}`);
    lines.push(`  merchant: ${c.shop_domain ?? c.merchant_id ?? "unknown"}`);
    lines.push(`  price: ${formatPrice(price?.amount, price?.currency)}`);
    if (c.budget_lift_readmitted) {
      lines.push(
        `  budget_lift_readmitted: true — slightly over slot allocation; closest real option after lift`,
      );
    }
    lines.push(`  colors: ${formatColors(c)}`);
    lines.push(`  size_status: ${formatSizeStatus(c)}`);
    lines.push(`  suspicions: ${formatSuspicions(c)}`);
    lines.push(`  score: ${c.score?.final?.toFixed(3) ?? "n/a"}`);
    lines.push(`  image: ${imageBlock ? "shown below" : "not shown"}`);

    if (imageBlock) imageBlocks.push(imageBlock);
  }

  const textBlock = lines.join("\n");

  const userMessages: MessageCreateParamsNonStreaming["messages"] = [
    {
      role: "user",
      content: [
        { type: "text", text: textBlock },
        ...imageBlocks,
      ],
    },
  ];

  return {
    registry,
    textBlock,
    imageBlocks,
    userMessages,
    images_failed: prepared.failed,
  };
}
