import { loadSearchState } from "@/lib/fashion-memory/curation/search-context";
import { getStoredAvatar } from "./avatar/service";
import { aggregateCompareStatus } from "./compare-variants";
import { isTryonOutfitsEnabledForUser } from "./feature-flags";
import { sortRefsForOutfitChain } from "./garment-type";
import {
  createGeneration,
  findCachedOutfitCompareTryon,
  findCachedOutfitTryon,
  getGeneration,
  listChildGenerations,
  updateGeneration,
} from "./generations";
import {
  dressCostEstimateForProvider,
  dressProviderLabel,
  getDressProvider,
  isDressCompareMode,
  resolveDressProviderKeys,
  type DressProviderKey,
} from "./providers";
import { resolvePickFromSearch } from "./run-single";
import { persistProviderImage } from "./storage";
import { logTryonDress } from "./dress-log";
import { TRYON_DISCLAIMER } from "./types";
import type {
  GarmentType,
  TryonCompareVariant,
  TryonLookContract,
  TryonLookStepContract,
} from "./types";
import { parseCapsuleLookId } from "./outfit-ids";
import {
  buildOutfitGarmentCollage,
} from "./dress/outfit-collage";
import {
  resolveTryonProductDetail,
  tryonProductContextFromCandidate,
} from "./dress/product-context";
import { fetchImageBytes } from "./providers/image-utils";

export { capsuleLookId } from "./outfit-ids";

function resolveOutfitItemRefs(
  state: NonNullable<Awaited<ReturnType<typeof loadSearchState>>>,
  lookId: string,
): string[] | null {
  const parsed = parseCapsuleLookId(lookId);
  if (parsed.kind === "capsule") {
    const outfits = state.curation.capsule_outfits ?? [];
    const byLabel = outfits.find((o) => o.label === parsed.key);
    if (byLabel) return byLabel.item_refs;
    const idx = Number(parsed.key);
    if (!Number.isNaN(idx) && outfits[idx]) return outfits[idx].item_refs;
    return null;
  }
  const look = state.curation.looks?.find(
    (l) => l.name === lookId || l.name === decodeURIComponent(lookId),
  );
  return look?.item_refs ?? null;
}

const outfitProgress = new Map<
  string,
  { steps: TryonLookStepContract[]; partial_note?: string }
>();

export function getOutfitProgress(jobId: string) {
  return outfitProgress.get(jobId);
}

export function clearOutfitProgress(): void {
  outfitProgress.clear();
}

type OutfitItem = {
  ref: string;
  garment: string;
  imageUrl?: string;
  title?: string;
  displayPrice?: { amount: number; currency: string };
};

type OutfitChainContext = {
  userId: string;
  personId: string;
  avatarUrl: string;
  avatarContentType?: string;
  avatarVersion: string;
  searchId: string;
  lookId: string;
  chain: Array<{
    ref: string;
    garment: string;
    type: GarmentType;
    accessory?: boolean;
  }>;
  items: OutfitItem[];
  cacheKey: string;
  state: NonNullable<Awaited<ReturnType<typeof loadSearchState>>>;
};

function outfitPlaceholderVariant(
  providerKey: DressProviderKey,
): TryonCompareVariant {
  return {
    provider_key: providerKey,
    provider: "fashn",
    label: dressProviderLabel(providerKey),
    job_id: `pending-${providerKey}`,
    status: "processing",
  };
}

function mergeOutfitCompareVariants(
  providerKeys: DressProviderKey[],
  children: Awaited<ReturnType<typeof listChildGenerations>>,
): TryonCompareVariant[] {
  return providerKeys.map((providerKey) => {
    const child = children.find(
      (c) =>
        (c.inputRefs.provider_key as DressProviderKey | undefined) ===
        providerKey,
    );
    if (child) {
      return {
        provider_key: providerKey,
        provider: child.provider,
        label: dressProviderLabel(providerKey),
        job_id: child.id,
        status: child.status,
        image_url: child.outputUrl ?? undefined,
        ms: child.ms ?? undefined,
        error: child.error
          ? formatOutfitFailureMessage(child.error)
          : undefined,
      };
    }
    return outfitPlaceholderVariant(providerKey);
  });
}

function variantsFromOutfitChildren(
  children: Awaited<ReturnType<typeof listChildGenerations>>,
): TryonCompareVariant[] {
  return children.map((child) => {
    const providerKey = (child.inputRefs.provider_key ??
      "fashn") as DressProviderKey;
    return {
      provider_key: providerKey,
      provider: child.provider,
      label: dressProviderLabel(providerKey),
      job_id: child.id,
      status: child.status,
      image_url: child.outputUrl ?? undefined,
      ms: child.ms ?? undefined,
      error: child.error
        ? formatOutfitFailureMessage(child.error)
        : undefined,
    };
  });
}

function firstCompletedImage(
  variants: TryonCompareVariant[],
): string | undefined {
  return variants.find((v) => v.status === "completed" && v.image_url)
    ?.image_url;
}

function buildOutfitProgressSteps(
  chain: OutfitChainContext["chain"],
  items: OutfitItem[],
): TryonLookStepContract[] {
  return chain.map((c) => ({
    ref: c.ref,
    title: items.find((i) => i.ref === c.ref)?.title,
    price: items.find((i) => i.ref === c.ref)?.displayPrice,
    status: "pending",
  }));
}

export async function startOutfitTryon(params: {
  userId: string;
  searchId: string;
  lookId: string;
}): Promise<{
  jobId: string;
  compare?: boolean;
  variants?: TryonCompareVariant[];
  disclaimer: typeof TRYON_DISCLAIMER;
}> {
  if (!(await isTryonOutfitsEnabledForUser(params.userId))) {
    throw new Error("Outfit try-on not enabled");
  }
  const state = await loadSearchState(params.searchId, params.userId);
  if (!state) throw new Error("Search not found");

  const itemRefs = resolveOutfitItemRefs(state, params.lookId);
  if (!itemRefs?.length) throw new Error("Look not found");

  const personId = state.plan.brief.recipient_person_id;
  const avatar = await getStoredAvatar(params.userId, personId);
  if (!avatar) throw new Error("Avatar required");

  const items = itemRefs
    .map((ref) => {
      const resolved = resolvePickFromSearch(state, ref);
      if (!resolved) return null;
      return {
        ref,
        garment: resolved.garment,
        imageUrl: resolved.imageUrl,
        title: resolved.title,
        displayPrice: resolved.displayPrice,
      };
    })
    .filter(Boolean) as OutfitItem[];

  const chain = sortRefsForOutfitChain(items);
  if (!chain.length) throw new Error("No supported garments in look");

  const dropped = items.filter(
    (it) => !chain.some((c) => c.ref === it.ref),
  );
  if (dropped.length) {
    logTryonDress("warn", "outfit_chain_dropped_unsupported", {
      look_id: params.lookId,
      dropped: dropped.map((d) => ({ ref: d.ref, garment: d.garment })),
      kept: chain.map((c) => ({ ref: c.ref, garment: c.garment, type: c.type })),
    });
  }

  const cacheKey = chain.map((c) => c.ref).join("|");
  const providerKeys = resolveDressProviderKeys();
  if (!providerKeys.length) throw new Error("No try-on provider configured");

  const chainCtx: OutfitChainContext = {
    userId: params.userId,
    personId,
    avatarUrl: avatar.url,
    avatarContentType: avatar.content_type,
    avatarVersion: avatar.version,
    searchId: params.searchId,
    lookId: params.lookId,
    chain,
    items,
    cacheKey,
    state,
  };

  if (isDressCompareMode()) {
    const cached = await findCachedOutfitCompareTryon({
      avatarVersion: avatar.version,
      cacheKey,
      userId: params.userId,
    });
    if (cached) {
      const variants = variantsFromOutfitChildren(cached.children);
      logTryonDress("info", "outfit_compare_cache_hit", {
        parent_job_id: cached.parent.id,
        look_id: params.lookId,
        search_id: params.searchId,
        providers: variants.map((v) => ({
          key: v.provider_key,
          status: v.status,
          ms: v.ms,
        })),
      });
      return {
        jobId: cached.parent.id,
        compare: true,
        variants,
        disclaimer: TRYON_DISCLAIMER,
      };
    }

    const parent = await createGeneration({
      personId,
      userId: params.userId,
      kind: "outfit",
      provider: "compare",
      inputRefs: {
        refs: chain.map((c) => c.ref),
        look_id: params.lookId,
        provider_keys: providerKeys,
      },
      searchId: params.searchId,
      productRef: cacheKey,
      avatarVersion: avatar.version,
      lookId: params.lookId,
      skipCapCheck: true,
    });

    logTryonDress("info", "outfit_compare_started", {
      parent_job_id: parent.id,
      look_id: params.lookId,
      search_id: params.searchId,
      avatar_version: avatar.version,
      providers: providerKeys,
      garment_count: chain.length,
    });

    void processCompareOutfitJob({
      compareParentId: parent.id,
      providerKeys,
      ...chainCtx,
    });

    return {
      jobId: parent.id,
      compare: true,
      variants: providerKeys.map((key) => outfitPlaceholderVariant(key)),
      disclaimer: TRYON_DISCLAIMER,
    };
  }

  const cached = await findCachedOutfitTryon({
    avatarVersion: avatar.version,
    cacheKey,
  });
  if (cached?.outputUrl) {
    logTryonDress("info", "outfit_cache_hit", {
      job_id: cached.id,
      look_id: params.lookId,
      provider: cached.provider,
      ms: cached.ms,
    });
    return { jobId: cached.id, disclaimer: TRYON_DISCLAIMER };
  }

  const providerKey = providerKeys[0]!;
  const provider = getDressProvider(providerKey);
  const parent = await createGeneration({
    personId,
    userId: params.userId,
    kind: "outfit",
    provider: provider.name,
    inputRefs: {
      refs: chain.map((c) => c.ref),
      look_id: params.lookId,
      provider_key: providerKey,
    },
    searchId: params.searchId,
    productRef: cacheKey,
    avatarVersion: avatar.version,
    lookId: params.lookId,
  });

  outfitProgress.set(parent.id, {
    steps: buildOutfitProgressSteps(chain, items),
  });

  logTryonDress("info", "outfit_started", {
    job_id: parent.id,
    look_id: params.lookId,
    search_id: params.searchId,
    provider_key: providerKey,
    provider: provider.name,
    garment_count: chain.length,
  });

  void processOutfitChain({
    parentJobId: parent.id,
    providerKey,
    ...chainCtx,
  });

  return { jobId: parent.id, disclaimer: TRYON_DISCLAIMER };
}

async function processCompareOutfitJob(
  params: OutfitChainContext & {
    compareParentId: string;
    providerKeys: DressProviderKey[];
  },
): Promise<void> {
  await updateGeneration(params.compareParentId, { status: "processing" });

  logTryonDress("info", "outfit_compare_processing", {
    parent_job_id: params.compareParentId,
    look_id: params.lookId,
    providers: params.providerKeys,
  });

  await Promise.all(
    params.providerKeys.map(async (providerKey) => {
      const provider = getDressProvider(providerKey);
      const childOutfit = await createGeneration({
        personId: params.personId,
        userId: params.userId,
        kind: "outfit",
        provider: provider.name,
        inputRefs: {
          refs: params.chain.map((c) => c.ref),
          look_id: params.lookId,
          provider_key: providerKey,
        },
        searchId: params.searchId,
        productRef: params.cacheKey,
        avatarVersion: params.avatarVersion,
        lookId: params.lookId,
        parentJobId: params.compareParentId,
      });

      outfitProgress.set(childOutfit.id, {
        steps: buildOutfitProgressSteps(params.chain, params.items),
      });

      await processOutfitChain({
        parentJobId: childOutfit.id,
        providerKey,
        ...params,
      });
    }),
  );

  const children = await listChildGenerations(
    params.compareParentId,
    params.userId,
  );
  const anySuccess = children.some(
    (c) => c.status === "completed" && c.outputUrl,
  );
  const parentMs = children.reduce((max, c) => Math.max(max, c.ms ?? 0), 0);
  await updateGeneration(params.compareParentId, {
    status: anySuccess ? "completed" : "failed",
    ms: parentMs,
  });

  logTryonDress(anySuccess ? "info" : "error", "outfit_compare_finished", {
    parent_job_id: params.compareParentId,
    look_id: params.lookId,
    status: anySuccess ? "completed" : "failed",
    ms: parentMs,
    providers: children.map((c) => ({
      key: (c.inputRefs.provider_key as DressProviderKey | undefined) ?? "unknown",
      provider: c.provider,
      job_id: c.id,
      status: c.status,
      ms: c.ms,
      error: c.error ? String(c.error).slice(0, 120) : undefined,
    })),
  });
}

async function processOutfitChain(
  params: OutfitChainContext & {
    parentJobId: string;
    providerKey: DressProviderKey;
  },
): Promise<void> {
  const provider = getDressProvider(params.providerKey);
  await updateGeneration(params.parentJobId, { status: "processing" });

  const progress = outfitProgress.get(params.parentJobId);
  const totalStarted = Date.now();

  const dressable = params.chain
    .map((step) => {
      const item = params.items.find((it) => it.ref === step.ref);
      if (!item?.imageUrl) return null;
      return {
        step,
        imageUrl: item.imageUrl,
        title: item.title ?? step.garment,
      };
    })
    .filter(Boolean) as Array<{
    step: (typeof params.chain)[number];
    imageUrl: string;
    title: string;
  }>;

  logTryonDress("info", "outfit_chain_processing", {
    job_id: params.parentJobId,
    look_id: params.lookId,
    provider_key: params.providerKey,
    provider: provider.name,
    step_count: params.chain.length,
    dressable_count: dressable.length,
  });

  // FASHN: one product image per call — collage all pieces into a single
  // product_image / garment_image (docs: "include multiple products in the same image").
  if (dressable.length >= 2) {
    const collageOk = await processOutfitCollage({
      ...params,
      dressable,
      provider,
      progress,
      totalStarted,
    });
    if (collageOk) return;
    logTryonDress("warn", "outfit_collage_fallback_to_chain", {
      job_id: params.parentJobId,
      look_id: params.lookId,
    });
  }

  await processOutfitSequentialChain({
    ...params,
    provider,
    progress,
    totalStarted,
  });
}

async function processOutfitCollage(
  params: OutfitChainContext & {
    parentJobId: string;
    providerKey: DressProviderKey;
    dressable: Array<{
      step: { ref: string; garment: string; type: GarmentType };
      imageUrl: string;
      title: string;
    }>;
    provider: ReturnType<typeof getDressProvider>;
    progress:
      | { steps: TryonLookStepContract[]; partial_note?: string }
      | undefined;
    totalStarted: number;
  },
): Promise<boolean> {
  const { dressable, provider, progress, parentJobId } = params;
  for (const row of progress?.steps ?? []) {
    row.status = "processing";
  }

  const stepGen = await createGeneration({
    personId: params.personId,
    userId: params.userId,
    kind: "outfit_step",
    provider: provider.name,
    inputRefs: {
      mode: "collage",
      refs: dressable.map((d) => d.step.ref),
      garment_types: dressable.map((d) => d.step.type),
      provider_key: params.providerKey,
    },
    searchId: params.searchId,
    productRef: dressable.map((d) => d.step.ref).join("|"),
    avatarVersion: params.avatarVersion,
    lookId: params.lookId,
    stepIndex: 0,
    parentJobId,
  });

  const started = Date.now();
  try {
    const collage = await buildOutfitGarmentCollage({
      imageUrls: dressable.map((d) => d.imageUrl),
    });

    let avatarBytes: Uint8Array | undefined;
    try {
      avatarBytes = await fetchImageBytes(params.avatarUrl);
    } catch {
      avatarBytes = undefined;
    }

    // Product context from the first piece — collage prompt carries the full look.
    const first = dressable[0]!;
    const resolved = resolvePickFromSearch(params.state, first.step.ref);
    const detail = resolved
      ? await resolveTryonProductDetail(resolved.candidate)
      : undefined;
    const product = resolved
      ? tryonProductContextFromCandidate({
          candidate: resolved.candidate,
          garmentType: first.step.type,
          garmentImageUrl: collage.dataUrl,
          detail,
          pick: resolved.pick,
          occasionContext: params.state.occasionContext,
        })
      : undefined;

    logTryonDress("info", "outfit_collage_processing", {
      job_id: stepGen.id,
      parent_job_id: parentJobId,
      provider_key: params.providerKey,
      piece_count: dressable.length,
      collage_w: collage.width,
      collage_h: collage.height,
    });

    const result = await provider.dress({
      avatarUrl: params.avatarUrl,
      avatarBytes,
      avatarContentType: params.avatarContentType,
      garmentImageUrl: collage.dataUrl,
      garmentType: "dress",
      product,
      outfitCollage: {
        titles: dressable.map((d) => d.title),
        types: dressable.map((d) => d.step.type),
      },
    });

    const persisted = await persistProviderImage({
      userId: params.userId,
      personId: params.personId,
      kind: "tryon",
      filename: `outfit-collage-${params.providerKey}-${Date.now()}.jpg`,
      imageUrl: result.imageUrl,
      imageBytes: result.imageBytes,
      contentType: result.contentType,
    });

    const ms = Date.now() - started;
    await updateGeneration(stepGen.id, {
      status: "completed",
      outputUrl: persisted.signedUrl,
      outputPath: persisted.path,
      ms,
      costEstimate: dressCostEstimateForProvider(provider.name),
    });
    for (const row of progress?.steps ?? []) {
      row.status = "completed";
      row.image_url = persisted.signedUrl;
    }

    const totalMs = Date.now() - params.totalStarted;
    await updateGeneration(parentJobId, {
      status: "completed",
      outputUrl: persisted.signedUrl,
      ms: totalMs,
      costEstimate: dressCostEstimateForProvider(provider.name),
    });

    logTryonDress("info", "outfit_collage_completed", {
      job_id: parentJobId,
      step_job_id: stepGen.id,
      provider_key: params.providerKey,
      look_id: params.lookId,
      ms: totalMs,
      piece_count: dressable.length,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateGeneration(stepGen.id, {
      status: "failed",
      error: message,
      ms: Date.now() - started,
    });
    logTryonDress("error", "outfit_collage_failed", {
      job_id: stepGen.id,
      parent_job_id: parentJobId,
      error: message.slice(0, 300),
    });
    for (const row of progress?.steps ?? []) {
      row.status = "pending";
      row.image_url = undefined;
    }
    return false;
  }
}

async function processOutfitSequentialChain(
  params: OutfitChainContext & {
    parentJobId: string;
    providerKey: DressProviderKey;
    provider: ReturnType<typeof getDressProvider>;
    progress:
      | { steps: TryonLookStepContract[]; partial_note?: string }
      | undefined;
    totalStarted: number;
  },
): Promise<void> {
  const provider = params.provider;
  let currentModelUrl = params.avatarUrl;
  let currentModelContentType = params.avatarContentType ?? "image/jpeg";
  let lastGoodUrl: string | undefined;
  let partialNote: string | undefined;
  const progress = params.progress;

  for (let i = 0; i < params.chain.length; i++) {
    const step = params.chain[i];
    if (step.accessory) {
      logTryonDress("info", "outfit_step_skip_accessory_sequential", {
        parent_job_id: params.parentJobId,
        ref: step.ref,
        garment: step.garment,
      });
      if (progress?.steps[i]) {
        progress.steps[i].status = "completed";
        progress.steps[i].note = "Included in full-look collage when available.";
      }
      continue;
    }
    const item = params.items.find((it) => it.ref === step.ref);
    const garmentImageUrl = item?.imageUrl;
    if (!garmentImageUrl) {
      logTryonDress("warn", "outfit_step_skipped_no_image", {
        parent_job_id: params.parentJobId,
        ref: step.ref,
        garment: step.garment,
        step_index: i,
      });
      if (progress?.steps[i]) {
        progress.steps[i].status = "failed";
      }
      continue;
    }

    const stepGen = await createGeneration({
      personId: params.personId,
      userId: params.userId,
      kind: "outfit_step",
      provider: provider.name,
      inputRefs: {
        ref: step.ref,
        garment_type: step.type,
        chained_from: currentModelUrl.startsWith("http") ? "url" : "storage",
        provider_key: params.providerKey,
        mode: "sequential",
      },
      searchId: params.searchId,
      productRef: step.ref,
      avatarVersion: params.avatarVersion,
      lookId: params.lookId,
      stepIndex: i,
      parentJobId: params.parentJobId,
    });

    if (progress?.steps[i]) progress.steps[i].status = "processing";

    const started = Date.now();
    try {
      const resolved = resolvePickFromSearch(params.state, step.ref);
      if (!resolved) throw new Error("Pick not found for outfit step");
      const detail = await resolveTryonProductDetail(resolved.candidate);
      const product = tryonProductContextFromCandidate({
        candidate: resolved.candidate,
        garmentType: step.type,
        garmentImageUrl,
        detail,
        pick: resolved.pick,
        occasionContext: params.state.occasionContext,
      });
      const priorGarmentTitles = params.chain
        .slice(0, i)
        .map((s) => params.items.find((it) => it.ref === s.ref)?.title)
        .filter(Boolean) as string[];

      let avatarBytes: Uint8Array | undefined;
      try {
        avatarBytes = await fetchImageBytes(currentModelUrl);
      } catch {
        avatarBytes = undefined;
      }

      logTryonDress("info", "outfit_step_processing", {
        job_id: stepGen.id,
        parent_job_id: params.parentJobId,
        provider_key: params.providerKey,
        ref: step.ref,
        step_index: i,
        step_total: params.chain.length,
      });

      const result = await provider.dress({
        avatarUrl: currentModelUrl,
        avatarBytes,
        avatarContentType: currentModelContentType,
        garmentImageUrl,
        garmentType: step.type,
        product,
        chain: {
          stepIndex: i,
          stepTotal: params.chain.length,
          priorGarmentTitles,
        },
      });
      const persisted = await persistProviderImage({
        userId: params.userId,
        personId: params.personId,
        kind: "tryon",
        filename: `outfit-${params.providerKey}-${step.ref}-${Date.now()}.jpg`,
        imageUrl: result.imageUrl,
        imageBytes: result.imageBytes,
        contentType: result.contentType,
      });
      currentModelUrl = persisted.signedUrl;
      currentModelContentType = persisted.contentType;
      lastGoodUrl = persisted.signedUrl;
      const ms = Date.now() - started;
      await updateGeneration(stepGen.id, {
        status: "completed",
        outputUrl: persisted.signedUrl,
        outputPath: persisted.path,
        ms,
        costEstimate: dressCostEstimateForProvider(provider.name),
      });
      if (progress?.steps[i]) {
        progress.steps[i].status = "completed";
        progress.steps[i].image_url = persisted.signedUrl;
      }
      logTryonDress("info", "outfit_step_completed", {
        job_id: stepGen.id,
        parent_job_id: params.parentJobId,
        provider_key: params.providerKey,
        ref: step.ref,
        step_index: i,
        ms,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const ms = Date.now() - started;
      await updateGeneration(stepGen.id, {
        status: "failed",
        error: message,
        ms,
      });
      if (progress?.steps[i]) {
        progress.steps[i].status = "failed";
        progress.steps[i].note = `Couldn't add the ${step.garment}.`;
      }
      partialNote = `Couldn't add the ${step.garment} — here's how far we got.`;
      logTryonDress("error", "outfit_step_failed", {
        job_id: stepGen.id,
        parent_job_id: params.parentJobId,
        provider_key: params.providerKey,
        ref: step.ref,
        step_index: i,
        ms,
        error: message.slice(0, 300),
      });
      break;
    }
  }

  const totalMs = Date.now() - params.totalStarted;

  if (lastGoodUrl) {
    await updateGeneration(params.parentJobId, {
      status: "completed",
      outputUrl: lastGoodUrl,
      ms: totalMs,
      costEstimate:
        dressCostEstimateForProvider(provider.name) * params.chain.length,
      error: partialNote,
    });
    if (progress) progress.partial_note = partialNote;
    logTryonDress("info", "outfit_chain_completed", {
      job_id: params.parentJobId,
      provider_key: params.providerKey,
      look_id: params.lookId,
      ms: totalMs,
      partial: Boolean(partialNote),
    });
  } else {
    await updateGeneration(params.parentJobId, {
      status: "failed",
      error: "Couldn't dress this look — try another combination.",
      ms: totalMs,
    });
    logTryonDress("error", "outfit_chain_failed", {
      job_id: params.parentJobId,
      provider_key: params.providerKey,
      look_id: params.lookId,
      ms: totalMs,
    });
  }
}

export async function pollOutfitTryon(params: {
  jobId: string;
  userId: string;
}): Promise<TryonLookContract> {
  const row = await getGeneration(params.jobId, params.userId);
  if (!row) throw new Error("Job not found");

  if (row.provider === "compare") {
    const providerKeys =
      (row.inputRefs.provider_keys as DressProviderKey[] | undefined) ??
      resolveDressProviderKeys();
    const children = await listChildGenerations(params.jobId, params.userId);
    const variants = mergeOutfitCompareVariants(providerKeys, children);
    const status = aggregateCompareStatus(variants);
    const final_image_url = firstCompletedImage(variants);

    logTryonDress("info", "outfit_poll_status", {
      job_id: params.jobId,
      mode: "compare",
      status,
      look_id: row.lookId,
      providers: variants.map((v) => ({
        key: v.provider_key,
        status: v.status,
        ms: v.ms,
        has_image: Boolean(v.image_url),
        error: v.error,
      })),
    });

    return {
      status,
      compare: true,
      variants,
      steps: [],
      final_image_url,
      partial_note:
        status === "failed"
          ? "Both providers failed — try another combination."
          : undefined,
      disclaimer: TRYON_DISCLAIMER,
      job_id: row.id,
    };
  }

  const progress = outfitProgress.get(params.jobId);

  logTryonDress("info", "outfit_poll_status", {
    job_id: params.jobId,
    mode: "single",
    status: row.status,
    look_id: row.lookId,
    provider: row.provider,
    ms: row.ms,
    error: row.error ? String(row.error).slice(0, 120) : undefined,
  });

  return {
    status: row.status,
    steps: progress?.steps ?? [],
    final_image_url: row.outputUrl ?? undefined,
    partial_note: progress?.partial_note ?? row.error ?? undefined,
    disclaimer: TRYON_DISCLAIMER,
    job_id: row.id,
  };
}

function formatOutfitFailureMessage(stored: string | null | undefined): string {
  if (!stored?.trim()) {
    return "Couldn't dress this look — try another combination.";
  }
  const msg = stored.trim();
  if (/timed out|aborted/i.test(msg)) {
    return "This look is taking too long — try again in a moment.";
  }
  if (process.env.NODE_ENV === "development" || process.env.AGENT_DEBUG === "1") {
    return msg.length > 240 ? `${msg.slice(0, 240)}…` : msg;
  }
  return "Couldn't dress this look — try another combination.";
}
