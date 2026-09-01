import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { formatMoney } from "@/lib/money";
import type { BudgetAssembly } from "../budget/budgetAllocation";
import type { BudgetTension } from "../budget/budgetTension";
import type { BudgetInterpretation } from "../budget/budgetAllocation";
import type { FashionSearchPlan } from "../search-planner/types";
import type { FashionSearchBrief } from "../router/types";
import type { CurationRefRegistry, RunFashionCurationParams } from "./types";
import { buildRefRegistry } from "./refs";
import { isDegradedOutfitPlan } from "./validate";
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

/** Dump every brief field the curator needs — never drop user constraints. */
function appendFullBrief(lines: string[], brief: FashionSearchBrief): void {
  lines.push("\n=== BRIEF (complete — do not invent; do not ignore) ===");
  lines.push(`request_type: ${brief.request_type}`);
  lines.push(`recipient_person_id: ${brief.recipient_person_id}`);
  lines.push(`garments: ${JSON.stringify(brief.garments)}`);
  lines.push(`occasion_context: ${brief.occasion_context}`);
  lines.push(`quantity_hint: ${brief.quantity_hint}`);
  lines.push(`style_direction: ${brief.style_direction}`);
  lines.push(`must_haves: ${JSON.stringify(brief.must_haves)}`);
  lines.push(`nice_to_haves: ${JSON.stringify(brief.nice_to_haves)}`);

  const budget = brief.budget_context;
  lines.push(
    `budget_context: stated=${budget.stated}` +
      `${budget.max != null ? ` max=${budget.max}` : ""}` +
      `${budget.min != null ? ` min=${budget.min}` : ""}` +
      `${budget.currency ? ` currency=${budget.currency}` : ""}` +
      `${budget.scope ? ` scope=${budget.scope}` : ""}`,
  );

  if (brief.department_scope) {
    lines.push(`department_scope: ${brief.department_scope}`);
  }
  if (brief.knowledge_state) {
    lines.push(
      `knowledge_state: department=${brief.knowledge_state.department}` +
        ` sizes_confirmed=${JSON.stringify(brief.knowledge_state.sizes_confirmed)}` +
        ` sizes_unconfirmed=${JSON.stringify(brief.knowledge_state.sizes_unconfirmed)}`,
    );
  }
  if (brief.color_direction) {
    lines.push(
      `color_direction: source=${brief.color_direction.source}` +
        (brief.color_direction.stated_colors?.length
          ? ` stated_colors=${JSON.stringify(brief.color_direction.stated_colors)}`
          : ""),
    );
  }
  if (brief.brand_direction) {
    lines.push(
      `brand_direction: source=${brief.brand_direction.source}` +
        (brief.brand_direction.brands?.length
          ? ` brands=${JSON.stringify(brief.brand_direction.brands)}`
          : ""),
    );
  }
  if (brief.stated_facts) {
    lines.push(`stated_facts: ${JSON.stringify(brief.stated_facts)}`);
  }
  // Belt-and-suspenders: raw brief JSON so no field is silently omitted above.
  lines.push(`brief_json: ${JSON.stringify(brief)}`);
}

export type CurationInputBundle = {
  registry: CurationRefRegistry;
  textBlock: string;
  imageBlocks: CurationImageBlock[];
  userMessages: MessageCreateParamsNonStreaming["messages"];
  /** Photos requested but fetch/resize failed. */
  images_failed: number;
  image_prep_ms: number;
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
  /** Full recipient profile block (facts + signals) — same as planner. */
  recipientProfile?: string;
  excludedRefs?: string[];
  /** When true, omit all image blocks (retry after Anthropic image 400). */
  omitImages?: boolean;
  /** Scale image budget (0.5 = shrink-retry with half the photos). */
  imageBudgetScale?: number;
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
    brief: params.plan.brief,
    imageBudgetScale: params.imageBudgetScale,
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

  const preparedStarted = Date.now();
  const prepared = params.omitImages
    ? { byRef: new Map<string, CurationImageBlock>(), prepared: 0, failed: 0 }
    : await prepareCurationImages({
        urls: pendingImages,
        signal: params.signal,
      });
  const image_prep_ms = Date.now() - preparedStarted;

  const lines: string[] = [];
  const department =
    params.department ??
    brief.knowledge_state?.department ??
    brief.department_scope ??
    "mixed";

  lines.push("=== WHO / WHAT (read first — decide your stylist persona) ===");
  lines.push(
    `Recipient: ${params.recipientRelation ?? "client"} · department=${department}`,
  );
  lines.push(`Mode: ${params.plan.mode}`);
  lines.push(`Plan source: ${params.plan.plan_source ?? "planner"}`);
  lines.push(`Planner reasoning: ${params.plan.reasoning}`);
  lines.push(
    `Slots planned: ${params.plan.slots.length} / brief garments: ${brief.garments.length}`,
  );

  if (params.recipientProfile?.trim()) {
    lines.push("\n=== RECIPIENT PROFILE (full) ===");
    lines.push(params.recipientProfile.trim());
  }

  appendFullBrief(lines, brief);

  if (isDegradedOutfitPlan(params.plan)) {
    lines.push(
      `\nDEGRADED PLAN: plan misses a brief garment or has fewer slots — thin_note REQUIRED and must name the missing piece; do NOT present as a full fitting-room success.`,
    );
  }

  if (params.tasteSignals?.length) {
    lines.push("\n=== TASTE SIGNALS (all) ===");
    for (const sig of params.tasteSignals) {
      const sign = sig.polarity >= 0 ? "+" : "-";
      lines.push(`  ${sign} ${sig.attribute_type}: ${sig.attribute_value}`);
    }
  }

  const allExclusions = [
    ...new Set(params.slots.flatMap((s) => s.curator_exclusions ?? [])),
  ];
  if (allExclusions.length) {
    lines.push("\n=== CURATOR EXCLUSIONS (visual no-gos) ===");
    for (const ex of allExclusions) lines.push(`  - ${ex}`);
  }

  lines.push("\n=== PLAN SLOTS (complete — honor every field) ===");
  for (const planSlot of params.plan.slots) {
    const slotMeta = params.slots.find((s) => s.slot_id === planSlot.slot_id);
    lines.push(
      `- ${planSlot.slot_id} (${planSlot.garment}) role=${planSlot.role}` +
        ` options_wanted=${planSlot.options_wanted}` +
        ` palette=${planSlot.palette_constraint ?? "spread"}` +
        ` source=${planSlot.palette_source}` +
        `${planSlot.unknown_family ? " [UNKNOWN_FAMILY]" : ""}` +
        `${slotMeta?.thin_slot ? " [THIN]" : ""}` +
        `${slotMeta?.coverage_gap ? " [COVERAGE_GAP — do not invent off-family fills; leave empty and name the gap in thin_note]" : ""}`,
    );
    lines.push(`  style_direction: ${planSlot.style_direction}`);
    if (planSlot.budget_fraction != null) {
      lines.push(`  budget_fraction: ${planSlot.budget_fraction}`);
    }
    if (planSlot.query_variants?.length) {
      lines.push(
        `  query_variants: ${JSON.stringify(planSlot.query_variants)}`,
      );
    }
    if (planSlot.brand_style_descriptors?.length) {
      lines.push(
        `  brand_style_descriptors: ${JSON.stringify(planSlot.brand_style_descriptors)}`,
      );
    }
    const brandStatus =
      slotMeta?.brand_status ?? planSlot.brand_status;
    const brandNote =
      slotMeta?.brand_sanity_note ?? planSlot.brand_sanity_note;
    const brandCount =
      slotMeta?.brand_confirmed_count ?? planSlot.brand_confirmed_count;
    if (brandStatus) {
      lines.push(
        `  brand_status=${brandStatus}` +
          `${brandNote ? ` note="${brandNote}"` : ""}` +
          `${brandCount != null ? ` confirmed_count=${brandCount}` : ""}`,
      );
    }
  }

  if (params.plan.budget_allocation) {
    lines.push(
      `\nBudget allocation: ${JSON.stringify({
        interpretation: params.plan.budget_allocation.budget_interpretation,
        assembly: params.plan.budget_allocation.budget_assembly,
        per_slot: Object.fromEntries(
          Object.entries(params.plan.budget_allocation.per_slot).map(
            ([id, a]) => [
              id,
              {
                fraction: a.fraction,
                allocated_max: a.allocated_max,
                padded_max: a.padded_max,
              },
            ],
          ),
        ),
      })}`,
    );
  }

  if (params.budget_assembly) {
    const constraint = params.budget_assembly.constraint_type ?? "per_look";
    lines.push(
      `\nBudget assembly: total_max=${params.budget_assembly.total_max} ${params.budget_assembly.currency} tolerance=${params.budget_assembly.tolerance} constraint=${constraint}`,
    );
    if (constraint === "set_total") {
      lines.push(
        "Capsule budget covers ALL pieces in the set — validate the SUM of every pick, not individual outfit combinations.",
      );
    }
  }
  if (params.budget_tension && params.budget_tension.severity !== "none") {
    lines.push(
      `Budget tension: ${params.budget_tension.severity} — ${JSON.stringify(params.budget_tension.slots)}`,
    );
    lines.push(
      "When tension is tight/infeasible: acknowledge honestly in budget_note. Lift-readmitted items (flagged below) are slightly over the per-slot allocation — closest real options.",
    );
  }
  if (params.budget_interpretation === "per_item_stated") {
    lines.push(
      "Budget interpretation: per_item_stated — the user stated a per-item ceiling. Echo as fact (e.g. \"keeping each piece under $50\"). NEVER say \"I read it as\" or treat it as an assumption.",
    );
  }
  if (params.budget_interpretation === "per_item_assumed") {
    lines.push("Budget interpretation: per_item_assumed");
  }
  if (params.budget_interpretation === "total_stated") {
    lines.push(
      "Budget interpretation: total_stated — echo the total as a stated set/outfit budget.",
    );
  }
  if (params.budget_interpretation === "set_total_assumed") {
    lines.push(
      "Budget interpretation: set_total_assumed — state in one clause that the budget covers all pieces (e.g. \"$300 across all six pieces\"). Do not ask for clarification.",
    );
  }

  if (excluded.size) {
    lines.push(`\nExcluded refs (prior rounds): ${[...excluded].join(", ")}`);
  }

  lines.push("\n=== CANDIDATES (verified bench — images shown where noted) ===");

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
    if (c.taste_rating) {
      lines.push(
        `  taste_fit: ${c.taste_rating.taste_fit.toFixed(2)} lane=${c.taste_rating.lane}`,
      );
    }
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
    image_prep_ms,
  };
}
