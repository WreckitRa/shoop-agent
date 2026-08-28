import { hydratedCandidateToProductCard } from "../catalog-search/product-card";
import {
  promotePick,
  rejectPick,
  collectExcludedRefs,
} from "./picks-actions";
import type {
  FashionVerifiedTierItem,
  MessageFashionCurationMetaV1,
} from "./types";
import type { CurationRefRegistry } from "./types";
import {
  loadSearchState,
  persistCuration,
  loadPoolForSlot,
  pickBelongsToLook,
  recomputeLookTotalFromPresentation,
  validateLookBudget,
} from "./search-context";
import { rankBenchForLook } from "./coherence-rank";
import { filterCapsuleSafeReplacements } from "./capsule-pairwise";
import {
  isHydrationStale,
  reverifyCandidate,
  STALE_SOLD_OUT_LINE,
} from "../hydration/verify-staleness";
import type { RehydratedSlotPool } from "../hydration/pool-persistence";
import type { HydratedCandidate } from "../hydration/types";
import { writeInteractionSignal, writeLookSwapSignals } from "./interaction-signals";
import { buildRenderContractWithTryon } from "@/lib/tryon/attach-render";
import { runFashionCuration } from "./run-curation";
import { recordPipelineEvent } from "../observability/trace";
import { trackProductEvent } from "@/lib/analytics/track";

async function persistCurationWithRender(params: {
  messageId: string;
  metadata: import("@/lib/ai-chat/types").MessageMetadata;
  curation: MessageFashionCurationMetaV1;
  plan: import("../search-planner/types").FashionSearchPlan;
  userId: string;
  recurateUsed?: boolean;
}) {
  const render = await buildRenderContractWithTryon({
    presentation: params.curation,
    plan: params.plan,
    userId: params.userId,
    recurateUsed: params.recurateUsed,
  });
  await persistCuration(
    params.messageId,
    params.metadata,
    params.curation,
    render,
  );
  return render;
}

export type PickActionBody = {
  messageId: string;
  ref: string;
  demotedRef?: string;
};

async function ensureFreshCandidate(params: {
  pool: RehydratedSlotPool;
  productId: string;
  registry: CurationRefRegistry;
  hydrateFn?: Parameters<typeof reverifyCandidate>[0]["hydrateFn"];
}): Promise<{
  ok: boolean;
  candidate?: HydratedCandidate;
  soldOut?: boolean;
}> {
  const entry = [...params.registry.values()].find(
    (e) => e.product_id === params.productId,
  );
  const candidate =
    params.pool.verified.find((c) => c.id === params.productId) ??
    entry?.candidate;
  if (!candidate) return { ok: false };

  if (!isHydrationStale(candidate)) {
    return { ok: true, candidate };
  }

  const result = await reverifyCandidate({
    candidate,
    hydrateParams: {
      slot: params.pool.context.slot,
      brief: params.pool.context.brief,
      recipientFacts: params.pool.context.recipientFacts,
      accessToken: params.pool.context.accessToken,
      context: params.pool.context.catalogContext,
      traceId: params.pool.context.traceId,
    },
    hydrateFn: params.hydrateFn,
  });

  if (result.ok) {
    const idx = params.pool.verified.findIndex((c) => c.id === params.productId);
    if (idx >= 0) params.pool.verified[idx] = result.candidate;
    await params.pool.persist();
    return { ok: true, candidate: result.candidate };
  }

  await params.pool.reportDeath(params.productId, "size_out_of_stock", "stale_reverify");
  await params.pool.persist();
  return { ok: false, soldOut: result.soldOut };
}

export async function handleFashionPickAction(
  action: "promote" | "verify" | "reject",
  body: PickActionBody,
  userId: string,
): Promise<Response> {
  const loaded = await loadSearchState(body.messageId, userId);
  if (!loaded) {
    return Response.json({ error: "Curation not found." }, { status: 404 });
  }

  const { metadata, curation, plan, occasionContext, registry } = loaded;

  if (action === "promote") {
    const verifiedItem = curation.tiers.verified.find((v) => v.ref === body.ref);
    if (!verifiedItem) {
      return Response.json({ error: "Verified item not found." }, { status: 404 });
    }

    const pool = await loadPoolForSlot({
      searchId: body.messageId,
      slotId: verifiedItem.slot_id,
      userId,
    });
    if (!pool) {
      return Response.json({ error: "Pool not found." }, { status: 404 });
    }

    const fresh = await ensureFreshCandidate({
      pool,
      productId: verifiedItem.id,
      registry,
    });

    if (!fresh.ok) {
      const next = curation.tiers.verified
        .filter((v) => v.slot_id === verifiedItem.slot_id && v.ref !== body.ref)
        .sort((a, b) => a.score_rank - b.score_rank)[0];
      return Response.json({
        ok: false,
        sold_out: fresh.soldOut ?? true,
        user_line: STALE_SOLD_OUT_LINE,
        next_ref: next?.ref,
      });
    }

    const next = promotePick({
      state: curation,
      ref: body.ref,
      demotedRef: body.demotedRef,
    });
    const promoted = next.tiers.picks.find((p) => p.ref === body.ref);
    const demoted = body.demotedRef
      ? curation.tiers.picks.find((p) => p.ref === body.demotedRef)
      : undefined;
    if (promoted) {
      await writeInteractionSignal({
        userId,
        searchId: body.messageId,
        interaction: "tier2_promote",
        ref: body.ref,
        product: promoted,
        demoted,
        occasionContext,
        traceId: curation.trace_id,
      });
      trackProductEvent({
        name: "item_reacted",
        userId,
        props: {
          item_id: promoted.id,
          reaction: "promote",
          ref: body.ref,
          search_id: body.messageId,
        },
      });
      pool.recordShownRef(body.ref);
      await pool.persist();
    }
    const updated: MessageFashionCurationMetaV1 = {
      ...next,
      version: 1,
      trace_id: curation.trace_id,
    };
    const render = await persistCurationWithRender({
      messageId: body.messageId,
      metadata,
      curation: updated,
      plan,
      userId,
    });
    return Response.json({
      ok: true,
      curation: updated,
      render,
    });
  }

  if (action === "reject") {
    const lookName = pickBelongsToLook(curation, body.ref);
    if (lookName) {
      const pick = curation.tiers.picks.find((p) => p.ref === body.ref);
      return handleLookSwap(
        {
          messageId: body.messageId,
          lookId: lookName,
          slot_id: pick?.slot_id ?? "",
          chosen_ref: undefined,
        },
        userId,
        body.ref,
      );
    }

    const pick = curation.tiers.picks.find((p) => p.ref === body.ref);
    const pool = pick
      ? await loadPoolForSlot({
          searchId: body.messageId,
          slotId: pick.slot_id,
          userId,
        })
      : null;

    if (pick && pool) {
      await pool.reportDeath(pick.id, "user_reject", "reject");
      await pool.persist();
    }

    const { state: next, replacement } = rejectPick({
      state: curation,
      ref: body.ref,
    });

    if (replacement && pool) {
      const replFresh = await ensureFreshCandidate({
        pool,
        productId: replacement.id,
        registry,
      });
      if (!replFresh.ok) {
        return Response.json({
          ok: false,
          sold_out: true,
          user_line: STALE_SOLD_OUT_LINE,
        });
      }
      pool.recordShownRef(replacement.ref);
      await pool.persist();
    }

    const rejected = curation.tiers.picks.find((p) => p.ref === body.ref);
    if (rejected) {
      await writeInteractionSignal({
        userId,
        searchId: body.messageId,
        interaction: "tier1_reject",
        ref: body.ref,
        product: rejected,
        occasionContext,
        traceId: curation.trace_id,
      });
      trackProductEvent({
        name: "item_reacted",
        userId,
        props: {
          item_id: rejected.id,
          reaction: "reject",
          ref: body.ref,
          search_id: body.messageId,
        },
      });
    }
    const updated: MessageFashionCurationMetaV1 = {
      ...next,
      version: 1,
      trace_id: curation.trace_id,
    };
    const render = await persistCurationWithRender({
      messageId: body.messageId,
      metadata,
      curation: updated,
      plan,
      userId,
    });
    return Response.json({
      ok: true,
      curation: updated,
      replacement,
      render,
    });
  }

  const item = curation.tiers.unverified.find((u) => u.product_id === body.ref);
  if (!item) {
    return Response.json({ error: "Unverified item not found." }, { status: 404 });
  }

  const pool = await loadPoolForSlot({
    searchId: body.messageId,
    slotId: item.slot_id,
    userId,
  });
  if (!pool) {
    return Response.json({ error: "Pool not found." }, { status: 404 });
  }

  const reserveProduct = pool.reserve.find((p) => p.id === body.ref);
  if (!reserveProduct) {
    return Response.json({ error: "Product not in pool." }, { status: 404 });
  }

  const hydrateResult = await import("../hydration/hydrate-candidate").then((m) =>
    m.hydrateCandidate({
      slot: pool.context.slot,
      product: reserveProduct,
      brief: pool.context.brief,
      recipientFacts: pool.context.recipientFacts,
      accessToken: pool.context.accessToken,
      context: pool.context.catalogContext,
      traceId: pool.context.traceId,
    }),
  );

  if (hydrateResult.outcome !== "verified") {
    await pool.reportDeath(body.ref, hydrateResult.death.cause, "tier3_verify");
    await pool.persist();
    return Response.json({
      ok: false,
      sold_out: true,
      user_line: STALE_SOLD_OUT_LINE,
    });
  }

  const card = hydratedCandidateToProductCard(hydrateResult.candidate);
  const verifiedItem: FashionVerifiedTierItem = {
    ...card,
    ref: body.ref,
    slot_id: item.slot_id,
    garment: item.garment,
    score_rank: item.score_rank,
    size_status: hydrateResult.candidate.size_status,
  };

  const updated: MessageFashionCurationMetaV1 = {
    ...curation,
    tiers: {
      ...curation.tiers,
      verified: [...curation.tiers.verified, verifiedItem],
      unverified: curation.tiers.unverified.filter(
        (u) => u.product_id !== item.product_id,
      ),
    },
  };

  await writeInteractionSignal({
    userId,
    searchId: body.messageId,
    interaction: "tier3_verify",
    ref: body.ref,
    product: verifiedItem,
    occasionContext,
        traceId: curation.trace_id,
  });

  await pool.persist();
  const render = await persistCurationWithRender({
    messageId: body.messageId,
    metadata,
    curation: updated,
    plan,
    userId,
  });
  return Response.json({
    ok: true,
    curation: updated,
    verified: verifiedItem,
    render,
  });
}

export async function handleLookSwap(
  body: {
    messageId: string;
    lookId: string;
    slot_id: string;
    chosen_ref?: string;
  },
  userId: string,
  rejectRef?: string,
): Promise<Response> {
  const loaded = await loadSearchState(body.messageId, userId);
  if (!loaded) {
    return Response.json({ error: "Curation not found." }, { status: 404 });
  }

  const { metadata, curation, plan, occasionContext, registry } = loaded;
  const look = curation.looks?.find((l) => l.name === body.lookId);
  if (!look) {
    return Response.json({ error: "Look not found." }, { status: 404 });
  }

  const swappingRef =
    rejectRef ??
    look.item_refs.find((r) => {
      const pick = curation.tiers.picks.find((p) => p.ref === r);
      return pick?.slot_id === body.slot_id;
    });
  if (!swappingRef) {
    return Response.json({ error: "Slot item not in look." }, { status: 404 });
  }

  const anchorRef = look.item_refs.find((r) => r !== swappingRef) ?? look.item_refs[0]!;
  const ranked = rankBenchForLook({
    registry,
    slotId: body.slot_id,
    anchorRef,
    excludeRefs: new Set(collectExcludedRefs(curation)),
  });

  if (!body.chosen_ref) {
    return Response.json({
      ok: true,
      alternatives: ranked.slice(0, 5).map((e) => ({
        ref: e.ref,
        title: e.candidate.title,
        imageUrl: e.candidate.media_urls[0] ?? e.candidate.image_urls[0],
      })),
    });
  }

  const chosen = ranked.find((e) => e.ref === body.chosen_ref);
  if (!chosen) {
    return Response.json({ error: "Replacement not offered." }, { status: 400 });
  }

  const pool = await loadPoolForSlot({
    searchId: body.messageId,
    slotId: body.slot_id,
    userId,
  });
  if (!pool) {
    return Response.json({ error: "Pool not found." }, { status: 404 });
  }

  const fresh = await ensureFreshCandidate({
    pool,
    productId: chosen.product_id,
    registry,
  });
  if (!fresh.ok) {
    return Response.json({
      ok: false,
      sold_out: true,
      user_line: STALE_SOLD_OUT_LINE,
    });
  }

  const swappedOut = curation.tiers.picks.find((p) => p.ref === swappingRef);
  const newPicks = curation.tiers.picks.map((p) => {
    if (p.ref !== swappingRef) return p;
    const card = hydratedCandidateToProductCard(chosen.candidate);
    return {
      ...card,
      ref: chosen.ref,
      slot_id: body.slot_id,
      garment: p.garment,
      role: p.role,
      stylist_line: "Swapped for a better match with this look.",
      badges: [],
      score_rank: chosen.score_rank,
    };
  });

  const newLooks = (curation.looks ?? []).map((l) => {
    if (l.name !== body.lookId) return l;
    const item_refs = l.item_refs.map((r) =>
      r === swappingRef ? chosen.ref : r,
    );
    const draft = {
      ...curation,
      tiers: { ...curation.tiers, picks: newPicks },
    };
    return {
      ...l,
      item_refs,
      total: recomputeLookTotalFromPresentation({ item_refs }, draft),
    };
  });

  const updated: MessageFashionCurationMetaV1 = {
    ...curation,
    tiers: { ...curation.tiers, picks: newPicks },
    looks: newLooks,
  };

  const lookTotal = newLooks.find((l) => l.name === body.lookId)?.total ?? 0;
  if (!validateLookBudget({ lookTotal, curation: updated, metadata })) {
    return Response.json({ error: "Look exceeds budget." }, { status: 400 });
  }

  if (swappedOut) {
    await writeLookSwapSignals({
      userId,
      searchId: body.messageId,
      swappedOut,
      chosen: hydratedCandidateToProductCard(chosen.candidate),
      occasionContext,
    });
  }

  const render = await persistCurationWithRender({
    messageId: body.messageId,
    metadata,
    curation: updated,
    plan,
    userId,
  });
  return Response.json({
    ok: true,
    curation: updated,
    render,
  });
}

export async function handleShowMore(
  body: { messageId: string; slotId: string },
  userId: string,
  hydrateFn?: Parameters<typeof reverifyCandidate>[0]["hydrateFn"],
): Promise<Response> {
  const loaded = await loadSearchState(body.messageId, userId);
  if (!loaded) {
    return Response.json({ error: "Curation not found." }, { status: 404 });
  }

  const { metadata, curation, plan, registry } = loaded;
  const pool = await loadPoolForSlot({
    searchId: body.messageId,
    slotId: body.slotId,
    userId,
    hydrateFn,
  });
  if (!pool) {
    return Response.json({ error: "Pool not found." }, { status: 404 });
  }

  const excluded = new Set([
    ...collectExcludedRefs(curation),
    ...pool.shown_refs,
  ]);

  const bench = curation.tiers.verified
    .filter((v) => v.slot_id === body.slotId && !excluded.has(v.ref))
    .sort((a, b) => a.score_rank - b.score_rank);

  const overflow = pool.getOverflow().filter(
    (o) => !excluded.has(o.product_id),
  );

  const items: FashionVerifiedTierItem[] = [];

  for (const v of bench) {
    const fresh = await ensureFreshCandidate({
      pool,
      productId: v.id,
      registry,
      hydrateFn,
    });
    if (fresh.ok) {
      items.push(v);
      pool.recordShownRef(v.ref);
    }
  }

  for (const o of overflow.slice(0, 5)) {
    const reserveProduct = pool.reserve.find((p) => p.id === o.product_id);
    if (!reserveProduct) continue;
    const hydrateResult = await import("../hydration/hydrate-candidate").then((m) =>
      m.hydrateCandidate({
        slot: pool.context.slot,
        product: reserveProduct,
        brief: pool.context.brief,
        recipientFacts: pool.context.recipientFacts,
        accessToken: pool.context.accessToken,
        context: pool.context.catalogContext,
        traceId: pool.context.traceId,
      }),
    );
    if (hydrateResult.outcome === "verified") {
      const card = hydratedCandidateToProductCard(hydrateResult.candidate);
      items.push({
        ...card,
        ref: o.product_id,
        slot_id: body.slotId,
        garment: o.title,
        score_rank: o.score_rank,
        size_status: hydrateResult.candidate.size_status,
      });
      pool.recordShownRef(o.product_id);
    }
  }

  await pool.persist();

  const exhausted = items.length === 0 && bench.length === 0 && overflow.length === 0;
  const render = await buildRenderContractWithTryon({
    presentation: curation,
    plan,
    userId,
    exhausted,
  });

  if (exhausted) {
    return Response.json({
      ok: true,
      items: [],
      exhausted: true,
      user_line:
        "That's everything solid I found — want me to search fresh with looser criteria?",
      suggest_new_search: true,
      render,
    });
  }

  return Response.json({ ok: true, items, render });
}

export async function handleRecurate(
  body: { messageId: string },
  userId: string,
): Promise<Response> {
  const loaded = await loadSearchState(body.messageId, userId);
  if (!loaded) {
    return Response.json({ error: "Curation not found." }, { status: 404 });
  }

  const { metadata, curation, plan } = loaded;

  if (!curation.meta.fallback) {
    return Response.json(
      { error: "Re-curate only available for fallback curation." },
      { status: 400 },
    );
  }

  const slotIds = plan.slots.map((s) => s.slot_id);
  const pools = new Map<string, RehydratedSlotPool>();
  for (const slotId of slotIds) {
    const pool = await loadPoolForSlot({
      searchId: body.messageId,
      slotId,
      userId,
    });
    if (pool) {
      if (pool.recurate_count >= 1) {
        return Response.json(
          { error: "Re-curate already used for this search." },
          { status: 429 },
        );
      }
      pools.set(slotId, pool);
    }
  }

  const catalog = metadata.fashionCatalogSearch!;
  const before = curation;

  const duckPools = new Map<
    string,
    {
      reportDeath: RehydratedSlotPool["reportDeath"];
      verified: RehydratedSlotPool["verified"];
      getOverflow: RehydratedSlotPool["getOverflow"];
    }
  >();
  for (const [id, pool] of pools) {
    duckPools.set(id, pool);
  }

  const curationResult = await runFashionCuration({
    traceId: curation.trace_id,
    plan,
    slots: catalog.slots.map((s) => ({
      slot_id: s.slot_id,
      garment: s.garment,
      verified_pool: pools.get(s.slot_id)?.verified ?? s.verified_pool,
      overflow_items: pools.get(s.slot_id)?.getOverflow() ?? s.overflow_items,
      thin_slot: pools.get(s.slot_id)?.thin ?? s.thin_slot,
      curator_exclusions: s.curator_exclusions,
      brand_status: s.brand_status,
    })),
    pools: duckPools,
    budget_assembly: plan.budget_allocation?.budget_assembly,
    budget_interpretation: plan.budget_allocation?.budget_interpretation,
    department:
      plan.brief.knowledge_state?.department ?? plan.brief.department_scope,
    recipientProfile: await (async () => {
      try {
        const { buildRecipientProfileBlockForPlanner } = await import(
          "../search-planner/recipient-profile"
        );
        return await buildRecipientProfileBlockForPlanner({
          userId,
          recipientPersonId: plan.brief.recipient_person_id,
        });
      } catch {
        return undefined;
      }
    })(),
  });

  const updated: MessageFashionCurationMetaV1 = {
    ...curationResult.presentation,
    version: 1,
    trace_id: curation.trace_id,
    meta: { ...curationResult.presentation.meta, fallback: false },
  };

  for (const pool of pools.values()) {
    pool.incrementRecurate();
    await pool.persist();
  }

  await writeInteractionSignal({
    userId,
    searchId: body.messageId,
    interaction: "recurate",
    ref: "recurate",
    product: { id: "recurate", title: "" },
    occasionContext: plan.brief.occasion_context ?? "general",
    traceId: curation.trace_id,
  });

  recordPipelineEvent({
    traceId: curation.trace_id,
    stage: "recurate",
    payload: {
      before_picks: before.tiers.picks.length,
      after_picks: updated.tiers.picks.length,
    },
  });

  const render = await persistCurationWithRender({
    messageId: body.messageId,
    metadata,
    curation: updated,
    plan,
    userId,
    recurateUsed: true,
  });
  return Response.json({
    ok: true,
    curation: updated,
    render,
  });
}

export async function handleCapsuleSwap(
  body: {
    messageId: string;
    slot_id: string;
    chosen_ref?: string;
    swapped_ref: string;
  },
  userId: string,
): Promise<Response> {
  const loaded = await loadSearchState(body.messageId, userId);
  if (!loaded) {
    return Response.json({ error: "Curation not found." }, { status: 404 });
  }

  const { curation, plan, registry } = loaded;
  const remainingRefs = curation.tiers.picks
    .map((p) => p.ref)
    .filter((r) => r !== body.swapped_ref);

  const bench = [...registry.values()].filter(
    (e) =>
      e.slot_id === body.slot_id &&
      e.ref !== body.swapped_ref &&
      !curation.tiers.picks.some((p) => p.ref === e.ref),
  );

  const safe = filterCapsuleSafeReplacements({
    candidates: bench,
    remainingRefs,
    capsuleOutfits: curation.capsule_outfits ?? [],
    registry,
    plan,
  });

  if (!body.chosen_ref) {
    return Response.json({
      ok: true,
      alternatives: safe.slice(0, 5).map((e) => ({
        ref: e.ref,
        title: e.candidate.title,
      })),
    });
  }

  const chosen = safe.find((e) => e.ref === body.chosen_ref);
  if (!chosen) {
    return Response.json({ error: "Replacement fails pairwise check." }, { status: 400 });
  }

  const lookId = curation.capsule_outfits?.[0]?.label ?? "capsule";
  return handleLookSwap(
    {
      messageId: body.messageId,
      lookId,
      slot_id: body.slot_id,
      chosen_ref: body.chosen_ref,
    },
    userId,
    body.swapped_ref,
  );
}
