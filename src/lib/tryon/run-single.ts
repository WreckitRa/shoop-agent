import { loadSearchState } from "@/lib/fashion-memory/curation/search-context";
import { writeInteractionSignal } from "@/lib/fashion-memory/curation/interaction-signals";
import { getStoredAvatar } from "./avatar/service";
import { isTryonEnabledForUser } from "./feature-flags";
import { isGarmentTypeSupported, mapSlotToGarmentType } from "./garment-type";
import {
  createGeneration,
  findCachedCompareTryon,
  findCachedSingleTryon,
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
import { fetchImageBytes } from "./providers/image-utils";
import { resolveAvatarContentType } from "./avatar/tryon-ready";
import {
  resolveTryonProductDetail,
  tryonProductContextFromCandidate,
} from "./dress/product-context";
import { persistProviderImage } from "./storage";
import { aggregateCompareStatus } from "./compare-variants";
import { TRYON_DISCLAIMER } from "./types";
import type { TryonCompareVariant, TryonPickContract } from "./types";
import type { TryOnProviderInput } from "./providers/types";
import { resolveTryonPersonId } from "./resolve-person";

export function resolvePickFromSearch(
  state: NonNullable<Awaited<ReturnType<typeof loadSearchState>>>,
  ref: string,
) {
  const entry = state.registry.get(ref);
  if (!entry) return null;
  const pick =
    state.curation.tiers.picks.find((p) => p.ref === ref) ??
    state.curation.tiers.verified.find((v) => v.ref === ref);
  const imageUrl =
    pick?.imageUrl ??
    entry.candidate.media_urls[0] ??
    entry.candidate.image_urls[0];
  return {
    entry,
    pick,
    candidate: entry.candidate,
    imageUrl,
    garment:
      pick?.garment ??
      state.plan.slots.find((s) => s.slot_id === entry.slot_id)?.garment ??
      entry.slot_id,
    title: pick?.title ?? entry.candidate.title,
    displayPrice: pick?.displayPrice,
  };
}

export async function buildPickTryonAvailability(params: {
  userId: string;
  personId: string;
  garment: string;
}): Promise<boolean> {
  if (!(await isTryonEnabledForUser(params.userId))) return false;
  const avatar = await getStoredAvatar(params.userId, params.personId);
  if (!avatar) return false;
  return isGarmentTypeSupported(params.garment);
}

function dressPlaceholderVariant(providerKey: DressProviderKey): TryonCompareVariant {
  return {
    provider_key: providerKey,
    provider: "fashn",
    label: dressProviderLabel(providerKey),
    job_id: `pending-${providerKey}`,
    status: "processing",
  };
}

function mergeDressCompareVariants(
  providerKeys: DressProviderKey[],
  children: Awaited<ReturnType<typeof listChildGenerations>>,
): TryonCompareVariant[] {
  return providerKeys.map((providerKey) => {
    const child = children.find(
      (c) => (c.inputRefs.provider_key as DressProviderKey | undefined) === providerKey,
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
        error: child.error ? formatTryonFailureMessage(child.error) : undefined,
      };
    }
    return dressPlaceholderVariant(providerKey);
  });
}

function variantsFromChildren(children: Awaited<ReturnType<typeof listChildGenerations>>): TryonCompareVariant[] {
  return children.map((child) => {
    const providerKey = (child.inputRefs.provider_key ?? "fashn") as DressProviderKey;
    return {
      provider_key: providerKey,
      provider: child.provider,
      label: dressProviderLabel(providerKey),
      job_id: child.id,
      status: child.status,
      image_url: child.outputUrl ?? undefined,
      ms: child.ms ?? undefined,
      error: child.error ? formatTryonFailureMessage(child.error) : undefined,
    };
  });
}

function firstCompletedImage(variants: TryonCompareVariant[]): string | undefined {
  return variants.find((v) => v.status === "completed" && v.image_url)?.image_url;
}

export async function startSingleTryon(params: {
  userId: string;
  searchId: string;
  ref: string;
}): Promise<{
  jobId: string;
  status: string;
  imageUrl?: string;
  compare?: boolean;
  variants?: TryonCompareVariant[];
  disclaimer: typeof TRYON_DISCLAIMER;
}> {
  const state = await loadSearchState(params.searchId, params.userId);
  if (!state) throw new Error("Search not found");

  const resolved = resolvePickFromSearch(state, params.ref);
  if (!resolved?.imageUrl) throw new Error("Pick not found");

  const personId = await resolveTryonPersonId(
    params.userId,
    state.plan.brief.recipient_person_id,
  );
  if (!(await isTryonEnabledForUser(params.userId))) {
    throw new Error("Try-on not enabled");
  }
  const avatar = await getStoredAvatar(params.userId, personId);
  if (!avatar) throw new Error("Avatar required");

  const garmentType = mapSlotToGarmentType(resolved.garment);
  if (!garmentType) throw new Error("Garment type not supported for try-on");

  const providerKeys = resolveDressProviderKeys();
  if (!providerKeys.length) throw new Error("No try-on provider configured");

  if (isDressCompareMode()) {
    const cached = await findCachedCompareTryon({
      avatarVersion: avatar.version,
      productRef: params.ref,
      userId: params.userId,
    });
    if (cached) {
      const variants = variantsFromChildren(cached.children);
      return {
        jobId: cached.parent.id,
        status: "completed",
        compare: true,
        variants,
        imageUrl: firstCompletedImage(variants),
        disclaimer: TRYON_DISCLAIMER,
      };
    }

    const parent = await createGeneration({
      personId,
      userId: params.userId,
      kind: "single",
      provider: "compare",
      inputRefs: {
        avatar_version: avatar.version,
        garment_image: resolved.imageUrl,
        garment_type: garmentType,
        ref: params.ref,
        provider_keys: providerKeys,
        title: resolved.title,
        ...(resolved.candidate?.id
          ? { product_id: resolved.candidate.id }
          : resolved.pick?.id
            ? { product_id: resolved.pick.id }
            : {}),
      },
      searchId: params.searchId,
      productRef: params.ref,
      avatarVersion: avatar.version,
      skipCapCheck: true,
    });


    void processCompareTryonJob({
      parentJobId: parent.id,
      userId: params.userId,
      personId,
      avatarUrl: avatar.url,
      avatarContentType: avatar.content_type,
      avatarVersion: avatar.version,
      garmentImageUrl: resolved.imageUrl,
      garmentType,
      searchId: params.searchId,
      ref: params.ref,
      candidate: resolved.candidate,
      pick: resolved.pick,
      occasionContext: state.occasionContext,
      providerKeys,
    });

    return {
      jobId: parent.id,
      status: "pending",
      compare: true,
      variants: providerKeys.map((key) => dressPlaceholderVariant(key)),
      disclaimer: TRYON_DISCLAIMER,
    };
  }

  const cached = await findCachedSingleTryon({
    avatarVersion: avatar.version,
    productRef: params.ref,
    userId: params.userId,
  });
  if (cached?.outputUrl) {
    return {
      jobId: cached.id,
      status: "completed",
      imageUrl: cached.outputUrl,
      disclaimer: TRYON_DISCLAIMER,
    };
  }

  const providerKey = providerKeys[0]!;
  const provider = getDressProvider(providerKey);
  const gen = await createGeneration({
    personId,
    userId: params.userId,
    kind: "single",
    provider: provider.name,
    inputRefs: {
      avatar_version: avatar.version,
      garment_image: resolved.imageUrl,
      garment_type: garmentType,
      ref: params.ref,
      provider_key: providerKey,
      title: resolved.title,
      ...(resolved.candidate?.id
        ? { product_id: resolved.candidate.id }
        : resolved.pick?.id
          ? { product_id: resolved.pick.id }
          : {}),
    },
    searchId: params.searchId,
    productRef: params.ref,
    avatarVersion: avatar.version,
  });


  void processSingleProviderJob({
    jobId: gen.id,
    providerKey,
    userId: params.userId,
    personId,
    avatarUrl: avatar.url,
    avatarContentType: avatar.content_type,
    garmentImageUrl: resolved.imageUrl,
    garmentType,
    searchId: params.searchId,
    ref: params.ref,
    candidate: resolved.candidate,
    pick: resolved.pick,
    occasionContext: state.occasionContext,
  });

  return { jobId: gen.id, status: "pending", disclaimer: TRYON_DISCLAIMER };
}

type DressJobContext = {
  userId: string;
  personId: string;
  avatarUrl: string;
  avatarContentType?: string;
  garmentImageUrl: string;
  garmentType: import("./types").GarmentType;
  searchId: string;
  ref: string;
  candidate: import("@/lib/fashion-memory/hydration/types").HydratedCandidate;
  pick?: {
    id: string;
    title?: string;
    stylist_line?: string;
    corrected_color?: string;
    badges?: Array<{ kind: string; [key: string]: unknown }>;
    catalogAttributes?: import("@/lib/ai-chat/types").ProductCard["catalogAttributes"];
  };
  occasionContext: string;
};

async function buildDressInput(
  ctx: DressJobContext & { avatarContentType?: string },
): Promise<TryOnProviderInput> {
  const detail = await resolveTryonProductDetail(ctx.candidate);
  const product = tryonProductContextFromCandidate({
    candidate: ctx.candidate,
    garmentType: ctx.garmentType,
    garmentImageUrl: ctx.garmentImageUrl,
    detail,
    pick: ctx.pick,
    occasionContext: ctx.occasionContext,
  });

  let avatarBytes: Uint8Array | undefined;
  let avatarContentType =
    ctx.avatarContentType ?? "image/jpeg";
  try {
    avatarBytes = await fetchImageBytes(ctx.avatarUrl);
    if (ctx.avatarUrl.startsWith("data:")) {
      const match = ctx.avatarUrl.match(/^data:([^;]+);/);
      if (match) avatarContentType = match[1];
    }
  } catch {
    avatarBytes = undefined;
  }

  return {
    avatarUrl: ctx.avatarUrl,
    avatarBytes,
    avatarContentType,
    garmentImageUrl: ctx.garmentImageUrl,
    garmentType: ctx.garmentType,
    product,
  };
}

async function processSingleProviderJob(
  params: DressJobContext & { jobId: string; providerKey: DressProviderKey },
): Promise<void> {
  const provider = getDressProvider(params.providerKey);
  await updateGeneration(params.jobId, { status: "processing" });
  const started = Date.now();


  try {
    const dressInput = await buildDressInput(params);
    const result = await provider.dress(dressInput);
    const persisted = await persistProviderImage({
      userId: params.userId,
      personId: params.personId,
      kind: "tryon",
      filename: `single-${params.providerKey}-${params.ref}-${Date.now()}.jpg`,
      imageUrl: result.imageUrl,
      imageBytes: result.imageBytes,
      contentType: result.contentType,
    });
    const ms = Date.now() - started;
    await updateGeneration(params.jobId, {
      status: "completed",
      outputUrl: persisted.signedUrl,
      outputPath: persisted.path,
      ms,
      costEstimate: dressCostEstimateForProvider(provider.name),
    });
    await writeTryonTapSignal(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const ms = Date.now() - started;
    await updateGeneration(params.jobId, {
      status: "failed",
      error: message,
      ms,
    });
  }
}

async function processCompareTryonJob(
  params: DressJobContext & {
    parentJobId: string;
    avatarVersion: string;
    providerKeys: DressProviderKey[];
  },
): Promise<void> {
  await updateGeneration(params.parentJobId, { status: "processing" });


  const dressInput = await buildDressInput(params);
  let signalWritten = false;

  await Promise.all(
    params.providerKeys.map(async (providerKey) => {
      const provider = getDressProvider(providerKey);
      const child = await createGeneration({
        personId: params.personId,
        userId: params.userId,
        kind: "single",
        provider: provider.name,
        inputRefs: {
          avatar_version: dressInput.avatarUrl,
          garment_image: params.garmentImageUrl,
          garment_type: params.garmentType,
          ref: params.ref,
          provider_key: providerKey,
        },
        searchId: params.searchId,
        productRef: params.ref,
        avatarVersion: params.avatarVersion,
        parentJobId: params.parentJobId,
      });

      await updateGeneration(child.id, { status: "processing" });
      const started = Date.now();


      try {
        const result = await provider.dress(dressInput);
        const persisted = await persistProviderImage({
          userId: params.userId,
          personId: params.personId,
          kind: "tryon",
          filename: `compare-${providerKey}-${params.ref}-${Date.now()}.jpg`,
          imageUrl: result.imageUrl,
          imageBytes: result.imageBytes,
          contentType: result.contentType,
        });
        const ms = Date.now() - started;
        await updateGeneration(child.id, {
          status: "completed",
          outputUrl: persisted.signedUrl,
          outputPath: persisted.path,
          ms,
          costEstimate: dressCostEstimateForProvider(provider.name),
        });
        if (!signalWritten && params.pick) {
          signalWritten = true;
          await writeTryonTapSignal(params);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const ms = Date.now() - started;
        await updateGeneration(child.id, {
          status: "failed",
          error: message,
          ms,
        });
      }
    }),
  );

  const children = await listChildGenerations(params.parentJobId, params.userId);
  const anySuccess = children.some((c) => c.status === "completed" && c.outputUrl);
  const parentMs = children.reduce((max, c) => Math.max(max, c.ms ?? 0), 0);
  await updateGeneration(params.parentJobId, {
    status: anySuccess ? "completed" : "failed",
    ms: parentMs,
  });

}

async function writeTryonTapSignal(params: DressJobContext): Promise<void> {
  if (!params.pick) return;
  await writeInteractionSignal({
    userId: params.userId,
    searchId: params.searchId,
    interaction: "tryon_tap",
    ref: params.ref,
    product: params.pick as import("@/lib/ai-chat/types").ProductCard,
    occasionContext: params.occasionContext,
  });
}

export async function pollSingleTryon(params: {
  jobId: string;
  userId: string;
}): Promise<{
  status: string;
  imageUrl?: string;
  error?: string;
  compare?: boolean;
  variants?: TryonCompareVariant[];
  disclaimer: typeof TRYON_DISCLAIMER;
}> {
  const row = await getGeneration(params.jobId, params.userId);
  if (!row) throw new Error("Job not found");

  if (row.provider === "compare") {
    const providerKeys =
      (row.inputRefs.provider_keys as DressProviderKey[] | undefined) ??
      resolveDressProviderKeys();
    const children = await listChildGenerations(params.jobId, params.userId);
    const variants = mergeDressCompareVariants(providerKeys, children);
    const status = aggregateCompareStatus(variants);
    const imageUrl = firstCompletedImage(variants);
    return {
      status,
      compare: true,
      variants,
      imageUrl,
      error:
        status === "failed"
          ? "Both try-on providers failed — try another piece."
          : undefined,
      disclaimer: TRYON_DISCLAIMER,
    };
  }


  return {
    status: row.status,
    imageUrl: row.outputUrl ?? undefined,
    error:
      row.status === "failed"
        ? formatTryonFailureMessage(row.error)
        : undefined,
    disclaimer: TRYON_DISCLAIMER,
  };
}

function formatTryonFailureMessage(stored: string | null | undefined): string {
  if (!stored?.trim()) {
    return "Couldn't dress this one — try another piece.";
  }
  const msg = stored.trim();
  if (/timed out|aborted/i.test(msg)) {
    return "This one is taking too long — try another piece.";
  }
  return "Couldn't dress this one — try another piece.";
}

export function toPickTryonContract(
  available: boolean,
  generated?: { imageUrl?: string; jobId?: string; compare?: boolean },
): TryonPickContract {
  return {
    available,
    image_url: generated?.imageUrl,
    job_id: generated?.jobId,
    compare: generated?.compare,
    disclaimer: TRYON_DISCLAIMER,
  };
}
