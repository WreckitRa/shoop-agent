import type { StageExpectations, TurnArtifacts } from "../types";
import { buildRenderContract } from "@/lib/fashion-memory/curation/build-render-contract";

function countDropsByRule(
  artifacts: TurnArtifacts,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of artifacts.catalog?.slots ?? []) {
    for (const d of slot.dropped ?? []) {
      const rule = String(d.rule ?? "unknown");
      counts[rule] = (counts[rule] ?? 0) + 1;
    }
  }
  return counts;
}

export function buildPayloadFingerprint(
  artifacts: TurnArtifacts,
): Record<string, unknown> {
  return {
    route: artifacts.routerResult?.move,
    mode: artifacts.plan?.mode,
    drop_by_rule: countDropsByRule(artifacts),
    tension: artifacts.catalog?.budget_tension?.severity,
    brand_translate_calls: artifacts.llmCounter?.byStage.brand_translate ?? 0,
    picks:
      (artifacts.catalog?.curation?.tiers?.picks?.length ?? 0) +
      (artifacts.catalog?.curation?.tiers?.verified?.length ?? 0),
    has_market_prices: (artifacts.catalog?.slots ?? []).some(
      (s) => (s.market_prices?.sample_size ?? 0) > 0,
    ),
    budget_lift_events: (artifacts.pipelineEvents ?? []).filter((e) =>
      e.stage.includes("budget_lift"),
    ).length,
  };
}

export function evaluateExpectations(
  expect: StageExpectations | undefined,
  artifacts: TurnArtifacts,
): string[] {
  if (!expect) return [];
  const failures: string[] = [];

  if (expect.route) {
    const move = artifacts.routerResult?.move;
    if (expect.route.move && move !== expect.route.move) {
      failures.push(`route.move: expected ${expect.route.move}, got ${move}`);
    }
    if (expect.route.questionsGapOrder?.length) {
      const gaps =
        artifacts.routerResult?.move === "ask_clarification"
          ? artifacts.routerResult.questions.map((q) => q.gap)
          : [];
      if (JSON.stringify(gaps) !== JSON.stringify(expect.route.questionsGapOrder)) {
        failures.push(
          `route.questionsGapOrder: expected ${expect.route.questionsGapOrder.join(",")}, got ${gaps.join(",")}`,
        );
      }
    }
    if (expect.route.brandTranslateCalls != null) {
      const n = artifacts.llmCounter?.byStage.brand_translate ?? 0;
      if (n !== expect.route.brandTranslateCalls) {
        failures.push(
          `route.brandTranslateCalls: expected ${expect.route.brandTranslateCalls}, got ${n}`,
        );
      }
    }
  }

  if (expect.plan) {
    const plan = artifacts.plan;
    if (!plan) {
      failures.push("plan: missing");
    } else {
      if (expect.plan.mode && plan.mode !== expect.plan.mode) {
        failures.push(`plan.mode: expected ${expect.plan.mode}, got ${plan.mode}`);
      }
      if (expect.plan.slotCountMin != null && plan.slots.length < expect.plan.slotCountMin) {
        failures.push(`plan.slotCountMin: expected >=${expect.plan.slotCountMin}, got ${plan.slots.length}`);
      }
      if (expect.plan.paletteSource) {
        const src = plan.slots[0]?.palette_source;
        if (src !== expect.plan.paletteSource) {
          failures.push(`plan.paletteSource: expected ${expect.plan.paletteSource}, got ${src}`);
        }
      }
      if (expect.plan.perPieceMax != null && plan.budget_allocation?.per_slot) {
        for (const [slot, alloc] of Object.entries(plan.budget_allocation.per_slot)) {
          const cap = alloc.per_item_enforced ?? alloc.padded_max;
          if (cap > expect.plan.perPieceMax) {
            failures.push(`plan.perPieceMax: slot ${slot} cap ${cap} exceeds ${expect.plan.perPieceMax}`);
          }
        }
      }
      if (expect.plan.setTotal != null) {
        const total = plan.budget_allocation?.budget_assembly?.total_max;
        if (total !== expect.plan.setTotal) {
          failures.push(`plan.setTotal: expected ${expect.plan.setTotal}, got ${total}`);
        }
      }
      if (expect.plan.plannerProfileContains) {
        const signals = artifacts.guestSnapshot.style_signals.map(
          (s) => s.attribute_value,
        );
        const hit = signals.some((v) =>
          v.toLowerCase().includes(expect.plan!.plannerProfileContains!.toLowerCase()),
        );
        if (!hit) {
          failures.push(
            `plan.plannerProfileContains: "${expect.plan.plannerProfileContains}" not in signals`,
          );
        }
      }
    }
  }

  if (expect.queries?.length && artifacts.plan) {
    for (const slot of artifacts.plan.slots) {
      for (const q of slot.query_variants) {
        for (const pred of expect.queries) {
          if (!pred(q)) {
            failures.push(`queries: variant failed predicate for "${q}"`);
          }
        }
      }
    }
  }

  if (expect.funnel && artifacts.catalog) {
    const survivors = artifacts.catalog.slots.reduce(
      (n, s) => n + (s.verified_pool?.length ?? s.products?.length ?? 0),
      0,
    );
    if (expect.funnel.survivorsMin != null && survivors < expect.funnel.survivorsMin) {
      failures.push(`funnel.survivorsMin: expected >=${expect.funnel.survivorsMin}, got ${survivors}`);
    }
    if (expect.funnel.survivorsMax != null && survivors > expect.funnel.survivorsMax) {
      failures.push(`funnel.survivorsMax: expected <=${expect.funnel.survivorsMax}, got ${survivors}`);
    }
    if (expect.funnel.tension) {
      const t = artifacts.catalog.budget_tension?.severity;
      if (t !== expect.funnel.tension) {
        failures.push(`funnel.tension: expected ${expect.funnel.tension}, got ${t}`);
      }
    }
    if (expect.funnel.dropRules?.length) {
      const byRule = countDropsByRule(artifacts);
      for (const rule of expect.funnel.dropRules) {
        const n = byRule[rule.rule] ?? 0;
        if (rule.min != null && n < rule.min) {
          failures.push(`funnel.dropRules.${rule.rule}: expected >=${rule.min}, got ${n}`);
        }
        if (rule.max != null && n > rule.max) {
          failures.push(`funnel.dropRules.${rule.rule}: expected <=${rule.max}, got ${n}`);
        }
      }
    }
    if (expect.funnel.hasMarketPrices) {
      const has = artifacts.catalog.slots.some((s) => (s.market_prices?.length ?? 0) > 0);
      if (!has) failures.push("funnel.hasMarketPrices: none present");
    }
    if (expect.funnel.noBudgetLiftRetry) {
      const lifts = artifacts.pipelineEvents.filter((e) =>
        e.stage.includes("budget_lift"),
      );
      if (lifts.length > 0) {
        failures.push(`funnel.noBudgetLiftRetry: got ${lifts.length} lift events`);
      }
    }
  }

  if (expect.curation && artifacts.catalog?.curation) {
    const c = artifacts.catalog.curation;
    const pickCount =
      (c.tiers?.picks?.length ?? 0) + (c.tiers?.verified?.length ?? 0);
    if (expect.curation.picksMin != null && pickCount < expect.curation.picksMin) {
      failures.push(`curation.picksMin: expected >=${expect.curation.picksMin}, got ${pickCount}`);
    }
    if (expect.curation.brandNotePresent && !c.narration?.brand_note?.trim()) {
      failures.push("curation.brandNotePresent: brand_note missing");
    }
    if (expect.curation.brandMentioned) {
      const text = [c.narration?.opening, c.narration?.brand_note, c.narration?.budget_note]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!text.includes(expect.curation.brandMentioned.toLowerCase())) {
        failures.push(`curation.brandMentioned: "${expect.curation.brandMentioned}" not in narration`);
      }
    }
    if (expect.curation.hasCapsuleGrid && !c.capsule_outfits?.length) {
      failures.push("curation.hasCapsuleGrid: capsule_outfits missing");
    }
  }

  if (expect.render && artifacts.catalog?.curation && artifacts.plan) {
    const render = buildRenderContract({
      presentation: artifacts.catalog.curation,
      plan: artifacts.plan,
    });
    artifacts.render = render;
    if (expect.render.hasCapsuleGrid && !render.capsule_outfits?.length) {
      failures.push("render.hasCapsuleGrid: capsule_outfits missing");
    }
  }

  if (expect.signals?.signalCountMin != null) {
    if (artifacts.signals.length < expect.signals.signalCountMin) {
      failures.push(
        `signals.signalCountMin: expected >=${expect.signals.signalCountMin}, got ${artifacts.signals.length}`,
      );
    }
  }

  if (expect.memory?.factCountMin != null) {
    const facts = artifacts.guestSnapshot.fashion_facts.filter((f) => f.status === "active");
    if (facts.length < expect.memory.factCountMin) {
      failures.push(
        `memory.factCountMin: expected >=${expect.memory.factCountMin}, got ${facts.length}`,
      );
    }
  }

  if (expect.events?.invariantWarningsEmpty) {
    const warnings = artifacts.pipelineEvents.filter((e) => e.stage === "invariant_warning");
    if (warnings.length > 0) {
      failures.push(`events.invariantWarningsEmpty: got ${warnings.length} warnings`);
    }
  }

  if (expect.events?.pipelineStages?.length) {
    const stages = artifacts.pipelineEvents.map((e) => e.stage);
    for (const wanted of expect.events.pipelineStages) {
      if (!stages.includes(wanted)) {
        failures.push(`events.pipelineStages: missing stage "${wanted}"`);
      }
    }
  }

  if (expect.sse?.sseEvents?.length) {
    const names = (artifacts.sseEvents ?? []).map((e) => e.event);
    for (const wanted of expect.sse.sseEvents) {
      if (!names.includes(wanted)) {
        failures.push(`sse.sseEvents: missing event "${wanted}"`);
      }
    }
  }

  if (expect.events?.routerCacheReadOnTurn2) {
    const reads = artifacts.llmCounter?.routerCacheReads ?? [];
    if (reads.length < 2) {
      failures.push(
        `events.routerCacheReadOnTurn2: need ≥2 router calls, got ${reads.length}`,
      );
    } else if (!(reads[1]! > 0)) {
      failures.push(
        `events.routerCacheReadOnTurn2: second router cache_read_input_tokens expected >0, got ${reads[1]}`,
      );
    }
  }

  return failures;
}

export function compactTraceDump(artifacts: TurnArtifacts): Record<string, unknown> {
  const catalog = artifacts.catalog;
  return {
    trace_id: artifacts.traceId,
    route: artifacts.routerResult?.move,
    mode: artifacts.plan?.mode,
    funnel: catalog?.slots.map((s) => ({
      slot: s.slot_id,
      raw: s.counts?.unique_products,
      dropped: s.dropped?.length ?? 0,
      verified: s.verified_pool?.length ?? 0,
      drop_rules: countDropsByRule({ ...artifacts, catalog }),
    })),
    tension: catalog?.budget_tension?.severity,
    picks:
      (catalog?.curation?.tiers?.picks?.length ?? 0) +
      (catalog?.curation?.tiers?.verified?.length ?? 0),
    signals: artifacts.signals.length,
    facts: artifacts.guestSnapshot.fashion_facts.length,
    brand_translate_calls: artifacts.llmCounter?.byStage.brand_translate ?? 0,
  };
}
