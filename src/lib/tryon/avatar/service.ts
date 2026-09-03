import { fashionMemoryDb } from "@/lib/fashion-memory/db";
import {
  getPersonById,
  ensureSelfPerson,
  resolvePersonIdRef,
} from "@/lib/fashion-memory/people";
import type { PersonRow } from "@/lib/fashion-memory/types";
import { prisma } from "@/lib/ai-chat/db";
import { trackProductEvent } from "@/lib/analytics/track";
import { resolveAnalyticsSessionId } from "@/lib/analytics/session";
import { setTryonEnabledForUser } from "../feature-flags";
import { runAvatarIntake } from "./intake";
import {
  getAvatarProviderByKey,
  isAvatarCompareMode,
  avatarProviderLabel,
  avatarCostEstimateForProvider,
  resolveAvatarProviderKeys,
} from "../providers";
import type { AvatarProviderKey } from "../providers";
import {
  createGeneration,
  getGeneration,
  listChildGenerations,
  updateGeneration,
} from "../generations";
import { aggregateCompareStatus } from "../compare-variants";
import {
  createSignedUrl,
  deletePrivateObjects,
  downloadPrivateObject,
  persistProviderImage,
  uploadPrivateObject,
} from "../storage";
import type {
  AttributeIntakeResult,
  AvatarAttributes,
  AvatarCompareVariant,
  AvatarDraftStep,
  StoredAvatar,
} from "../types";
import {
  hasRequiredSilhouetteAttributes,
  missingSilhouetteAttributes,
  silhouetteOnlyAttributes,
} from "./attributes";
import {
  avatarPreviewFilename,
  resolveAvatarContentType,
} from "./tryon-ready";

export type AvatarDraft = {
  person_id: string;
  step: AvatarDraftStep;
  photo_path?: string;
  attributes?: AvatarAttributes;
  preview_url?: string;
  preview_path?: string;
  preview_variants?: AvatarCompareVariant[];
  selected_provider_key?: AvatarProviderKey;
  compare?: boolean;
  compare_job_id?: string;
  intake?: AttributeIntakeResult;
  regen_count: number;
};

async function resolveOwnedPerson(
  userId: string,
  personId: string,
): Promise<PersonRow> {
  const found = await getPersonById(userId, personId);
  if (found) return found;
  return ensureSelfPerson(userId);
}

async function ownedDraft(userId: string, personId: string) {
  const person = await resolveOwnedPerson(userId, personId);
  return { person, draft: await getDraft(userId, person.id) };
}

export async function startAvatarFlow(params: {
  userId: string;
  personId: string;
}): Promise<AvatarDraft> {
  const person = await resolveOwnedPerson(params.userId, params.personId);

  const existing = await getDraft(params.userId, person.id);
  if (existing) return existing;

  const draft: AvatarDraft = {
    person_id: person.id,
    step: "upload",
    regen_count: 0,
  };
  await upsertDraft(params.userId, draft);
  return draft;
}

export async function uploadAvatarPhoto(params: {
  userId: string;
  personId: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<AvatarDraft> {
  const person = await resolveOwnedPerson(params.userId, params.personId);

  const { path } = await uploadPrivateObject({
    userId: params.userId,
    personId: person.id,
    kind: "source-photo",
    filename: `source-${Date.now()}.jpg`,
    bytes: params.bytes,
    contentType: params.contentType,
  });

  const draft: AvatarDraft = {
    person_id: person.id,
    step: "attributes",
    photo_path: path,
    regen_count: 0,
  };
  await upsertDraft(params.userId, draft);
  return draft;
}

export async function checkAvatarAttributes(params: {
  userId: string;
  personId: string;
  statedAttributes?: Partial<AvatarAttributes>;
  traceId?: string;
}): Promise<AvatarDraft> {
  const { person, draft } = await ownedDraft(params.userId, params.personId);
  if (!draft) throw new Error("Avatar flow not started");

  let photoUrl: string | undefined;
  if (draft.photo_path) {
    photoUrl = await createSignedUrl(draft.photo_path, 600);
  }

  const intake = await runAvatarIntake({
    traceId: params.traceId,
    photoSignedUrl: photoUrl,
    statedAttributes: params.statedAttributes,
  });

  if (intake.minor_refused) {
    if (draft.photo_path) {
      await deletePrivateObjects([draft.photo_path]);
    }
    await deleteDraft(person.id);
    return {
      person_id: person.id,
      step: "refused_minor",
      regen_count: 0,
      intake,
    };
  }

  const merged: AvatarAttributes = {
    ...intake.clear,
    ...params.statedAttributes,
  };
  const next: AvatarDraft = {
    ...draft,
    step: intake.missing.length > 0 ? "attributes" : "generate",
    attributes: merged,
    intake,
  };
  await upsertDraft(params.userId, next);
  return next;
}

export async function submitAvatarAttributes(params: {
  userId: string;
  personId: string;
  attributes: AvatarAttributes;
}): Promise<AvatarDraft> {
  const attributes = silhouetteOnlyAttributes(params.attributes);
  if (!hasRequiredSilhouetteAttributes(attributes)) {
    const missing = missingSilhouetteAttributes(attributes);
    throw new Error(
      `Please select: ${missing.map((k) => k.replace(/_/g, " ")).join(", ")}.`,
    );
  }
  const { person: submitPerson, draft: submitExisting } = await ownedDraft(
    params.userId,
    params.personId,
  );
  let draft = submitExisting;
  if (!draft) {
    draft = await startAvatarFlow({
      userId: params.userId,
      personId: submitPerson.id,
    });
  }
  if (!draft) {
    throw new Error("Avatar flow not started — go back and try again.");
  }
  const next: AvatarDraft = {
    ...draft,
    step: "generate",
    attributes: {
      ...silhouetteOnlyAttributes(draft.attributes ?? {}),
      ...attributes,
    },
  };
  await upsertDraft(params.userId, next);
  return next;
}

export async function generateAvatarPreview(params: {
  userId: string;
  personId: string;
  attributes?: AvatarAttributes;
}): Promise<AvatarDraft> {
  const { person: genPerson, draft: genExisting } = await ownedDraft(
    params.userId,
    params.personId,
  );
  let draft = genExisting;
  if (!draft) {
    draft = await startAvatarFlow({
      userId: params.userId,
      personId: genPerson.id,
    });
  }
  if (!draft) {
    throw new Error("Avatar flow not started — go back and try again.");
  }

  const mergedAttributes = silhouetteOnlyAttributes({
    ...(draft.attributes ?? {}),
    ...(params.attributes ?? {}),
  });

  if (!hasRequiredSilhouetteAttributes(mergedAttributes)) {
    const missing = missingSilhouetteAttributes(mergedAttributes);
    throw new Error(
      `Attributes required before generate: ${missing.join(", ")}.`,
    );
  }

  draft = {
    ...draft,
    attributes: mergedAttributes,
    step: "generate",
  };
  await upsertDraft(params.userId, draft);

  const hasPhoto = Boolean(draft.photo_path);
  if (!hasPhoto) {
    throw new Error(
      "A face photo is required for avatar creation with FASHN.",
    );
  }
  const providerKeys = resolveAvatarProviderKeys(hasPhoto);
  if (!providerKeys.length) {
    throw new Error("FASHN_API_KEY not configured for avatar generation");
  }

  let photoUrl: string | undefined;
  let photoBytes: Uint8Array | undefined;
  let photoContentType: string | undefined;
  if (draft.photo_path) {
    const downloaded = await downloadPrivateObject(draft.photo_path);
    photoBytes = downloaded.bytes;
    photoContentType = downloaded.contentType;
    photoUrl = await createSignedUrl(draft.photo_path, 600);
  }

  const oldPreviewPaths = collectPreviewPaths(draft);

  if (isAvatarCompareMode(hasPhoto)) {
    const parent = await createGeneration({
      personId: params.personId,
      userId: params.userId,
      kind: "avatar",
      provider: "compare",
      inputRefs: {
        photo_path: draft.photo_path ?? null,
        attributes: mergedAttributes,
        provider_keys: providerKeys,
      },
      skipCapCheck: true,
    });
    await updateGeneration(parent.id, { status: "processing" });

    const placeholders = buildAvatarComparePlaceholders(providerKeys);
    const next: AvatarDraft = {
      ...draft,
      step: "generate",
      compare: true,
      compare_job_id: parent.id,
      preview_variants: placeholders,
      selected_provider_key: "fashn",
      regen_count: draft.regen_count + 1,
    };
    await upsertDraft(params.userId, next);
    if (oldPreviewPaths.length) await deletePrivateObjects(oldPreviewPaths);

    void processAvatarCompareJob({
      parentJobId: parent.id,
      userId: params.userId,
      personId: params.personId,
      photoUrl,
      photoBytes,
      photoContentType,
      attributes: mergedAttributes!,
      providerKeys,
    });

    return next;
  }

  const providerKey = providerKeys[0]!;
  const variant = await runAvatarProviderLeg({
    userId: params.userId,
    personId: params.personId,
    providerKey,
    photoUrl,
    photoBytes,
    photoContentType,
    attributes: mergedAttributes!,
  });

  if (!variant.preview_url || !variant.preview_path) {
    throw new Error(variant.error ?? "Avatar generation failed");
  }

  const next: AvatarDraft = {
    ...draft,
    step: "approval",
    compare: false,
    preview_variants: undefined,
    selected_provider_key: providerKey,
    preview_url: variant.preview_url,
    preview_path: variant.preview_path,
    regen_count: draft.regen_count + 1,
  };
  await upsertDraft(params.userId, next);
  if (oldPreviewPaths.length) await deletePrivateObjects(oldPreviewPaths);
  return next;
}

async function runAvatarProviderLeg(params: {
  userId: string;
  personId: string;
  providerKey: AvatarProviderKey;
  photoUrl?: string;
  photoBytes?: Uint8Array;
  photoContentType?: string;
  attributes: AvatarAttributes;
  parentJobId?: string;
}): Promise<AvatarCompareVariant> {
  const provider = getAvatarProviderByKey(params.providerKey);
  const sessionId = await resolveAnalyticsSessionId();
  const gen = await createGeneration({
    personId: params.personId,
    userId: params.userId,
    kind: "avatar",
    provider: provider.name,
    inputRefs: {
      photo_path: params.photoUrl ?? null,
      attributes: params.attributes,
      provider_key: params.providerKey,
      ...(sessionId ? { analytics_session_id: sessionId } : {}),
    },
    parentJobId: params.parentJobId,
    skipCapCheck: Boolean(params.parentJobId),
  });

  await updateGeneration(gen.id, { status: "processing" });
  trackProductEvent({
    name: "twin_render_started",
    userId: params.userId,
    sessionId,
    props: {
      generation_id: gen.id,
      person_id: params.personId,
      provider: provider.name,
      parent_job_id: params.parentJobId ?? null,
    },
  });
  const started = Date.now();

  try {
    const result = await provider.createAvatar({
      photoUrl: params.photoUrl,
      photoBytes: params.photoBytes,
      photoContentType: params.photoContentType,
      attributes: params.attributes,
    });
    const persisted = await persistProviderImage({
      userId: params.userId,
      personId: params.personId,
      kind: "avatar",
      filename: avatarPreviewFilename(
        params.providerKey,
        result.contentType ?? "image/jpeg",
      ),
      imageUrl: result.imageUrl,
      imageBytes: result.imageBytes,
      contentType: result.contentType,
    });
    const ms = Date.now() - started;
    await updateGeneration(gen.id, {
      status: "completed",
      outputUrl: persisted.signedUrl,
      outputPath: persisted.path,
      ms,
      costEstimate: avatarCostEstimateForProvider(provider.name),
    });
    trackProductEvent({
      name: "twin_render_completed",
      userId: params.userId,
      sessionId,
      props: {
        generation_id: gen.id,
        person_id: params.personId,
        provider: provider.name,
        ms,
      },
    });
    return {
      provider_key: params.providerKey,
      provider: provider.name,
      label: avatarProviderLabel(params.providerKey),
      job_id: gen.id,
      status: "completed",
      preview_url: persisted.signedUrl,
      preview_path: persisted.path,
      ms,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateGeneration(gen.id, {
      status: "failed",
      error: message,
      ms: Date.now() - started,
    });
    trackProductEvent({
      name: "twin_render_failed",
      userId: params.userId,
      sessionId,
      props: {
        generation_id: gen.id,
        person_id: params.personId,
        provider: provider.name,
        error: message.slice(0, 200),
      },
    });
    return {
      provider_key: params.providerKey,
      provider: provider.name,
      label: avatarProviderLabel(params.providerKey),
      job_id: gen.id,
      status: "failed",
      error: message,
      ms: Date.now() - started,
    };
  }
}

function buildAvatarComparePlaceholders(
  providerKeys: AvatarProviderKey[],
): AvatarCompareVariant[] {
  return providerKeys.map((providerKey) => ({
    provider_key: providerKey,
    provider: "face-to-model",
    label: avatarProviderLabel(providerKey),
    job_id: `pending-${providerKey}`,
    status: "processing" as const,
  }));
}

function mergeAvatarCompareVariants(
  providerKeys: AvatarProviderKey[],
  children: Awaited<ReturnType<typeof listChildGenerations>>,
): AvatarCompareVariant[] {
  return providerKeys.map((providerKey) => {
    const child = children.find(
      (c) => (c.inputRefs.provider_key as AvatarProviderKey | undefined) === providerKey,
    );
    if (!child) return buildAvatarComparePlaceholders([providerKey])[0]!;
    return {
      provider_key: providerKey,
      provider: child.provider,
      label: avatarProviderLabel(providerKey),
      job_id: child.id,
      status: child.status,
      preview_url: child.outputUrl ?? undefined,
      preview_path: child.outputPath ?? undefined,
      ms: child.ms ?? undefined,
      error: child.error ?? undefined,
    };
  });
}

function defaultAvatarProviderKey(
  variants: AvatarCompareVariant[],
  fallback: AvatarProviderKey,
): AvatarProviderKey {
  return (
    variants.find((v) => v.preview_url)?.provider_key ?? fallback
  );
}

async function syncAvatarCompareDraft(params: {
  userId: string;
  personId: string;
  parentJobId: string;
  providerKeys: AvatarProviderKey[];
}): Promise<AvatarDraft | null> {
  const draft = await getDraft(params.userId, params.personId);
  if (!draft) return null;

  const children = await listChildGenerations(params.parentJobId, params.userId);
  const variants = mergeAvatarCompareVariants(params.providerKeys, children);
  const status = aggregateCompareStatus(variants);
  const anySuccess = variants.some((v) => v.preview_url);
  const defaultKey =
    draft.selected_provider_key ??
    defaultAvatarProviderKey(variants, params.providerKeys[0]!);
  const defaultVariant = variants.find(
    (v) => v.provider_key === defaultKey && v.preview_url,
  );

  const next: AvatarDraft = {
    ...draft,
    step:
      status === "processing" || status === "pending"
        ? "generate"
        : anySuccess
          ? "approval"
          : "generate",
    compare: true,
    compare_job_id: params.parentJobId,
    preview_variants: variants,
    selected_provider_key: defaultKey,
    preview_url: defaultVariant?.preview_url ?? draft.preview_url,
    preview_path: defaultVariant?.preview_path ?? draft.preview_path,
  };
  await upsertDraft(params.userId, next);
  return next;
}

async function processAvatarCompareJob(params: {
  parentJobId: string;
  userId: string;
  personId: string;
  photoUrl?: string;
  photoBytes?: Uint8Array;
  photoContentType?: string;
  attributes: AvatarAttributes;
  providerKeys: AvatarProviderKey[];
}): Promise<void> {
  await updateGeneration(params.parentJobId, { status: "processing" });

  await Promise.all(
    params.providerKeys.map(async (providerKey) => {
      await runAvatarProviderLeg({
        userId: params.userId,
        personId: params.personId,
        providerKey,
        photoUrl: params.photoUrl,
        photoBytes: params.photoBytes,
        photoContentType: params.photoContentType,
        attributes: params.attributes,
        parentJobId: params.parentJobId,
      });
      await syncAvatarCompareDraft({
        userId: params.userId,
        personId: params.personId,
        parentJobId: params.parentJobId,
        providerKeys: params.providerKeys,
      });
    }),
  );

  const children = await listChildGenerations(params.parentJobId, params.userId);
  const anySuccess = children.some((c) => c.status === "completed" && c.outputUrl);
  await updateGeneration(params.parentJobId, {
    status: anySuccess ? "completed" : "failed",
    ms: children.reduce((max, c) => Math.max(max, c.ms ?? 0), 0),
  });
  await syncAvatarCompareDraft({
    userId: params.userId,
    personId: params.personId,
    parentJobId: params.parentJobId,
    providerKeys: params.providerKeys,
  });
}

export async function pollAvatarCompare(params: {
  jobId: string;
  userId: string;
  personId: string;
}): Promise<{
  status: string;
  draft: AvatarDraft | null;
  variants: AvatarCompareVariant[];
}> {
  const row = await getGeneration(params.jobId, params.userId);
  if (!row || row.provider !== "compare") {
    throw new Error("Avatar job not found");
  }

  const providerKeys =
    (row.inputRefs.provider_keys as AvatarProviderKey[] | undefined) ??
    resolveAvatarProviderKeys(Boolean(row.inputRefs.photo_path));

  const draft = await syncAvatarCompareDraft({
    userId: params.userId,
    personId: params.personId,
    parentJobId: params.jobId,
    providerKeys,
  });

  const variants = draft?.preview_variants ?? buildAvatarComparePlaceholders(providerKeys);
  const status = aggregateCompareStatus(variants);

  return {
    status,
    draft,
    variants,
  };
}

function collectPreviewPaths(draft: AvatarDraft): string[] {
  const paths = new Set<string>();
  if (draft.preview_path) paths.add(draft.preview_path);
  for (const v of draft.preview_variants ?? []) {
    if (v.preview_path) paths.add(v.preview_path);
  }
  return [...paths];
}

function resolveSelectedVariant(draft: AvatarDraft): AvatarCompareVariant | null {
  if (draft.preview_variants?.length) {
    const key = draft.selected_provider_key;
    const byKey = key
      ? draft.preview_variants.find(
          (v) => v.provider_key === key && v.preview_url && v.preview_path,
        )
      : undefined;
    return (
      byKey ??
      draft.preview_variants.find((v) => v.preview_url && v.preview_path) ??
      null
    );
  }
  if (draft.preview_url && draft.preview_path) {
    return {
      provider_key: draft.selected_provider_key ?? "fashn",
      provider: "",
      label: "",
      job_id: "",
      status: "completed",
      preview_url: draft.preview_url,
      preview_path: draft.preview_path,
    };
  }
  return null;
}

export async function approveAvatar(params: {
  userId: string;
  personId: string;
  selectedProviderKey?: AvatarProviderKey;
}): Promise<StoredAvatar> {
  const { person, draft } = await ownedDraft(params.userId, params.personId);
  if (!draft?.attributes) {
    throw new Error("No preview to approve");
  }

  const selectedKey = params.selectedProviderKey ?? draft.selected_provider_key;
  const variant = resolveSelectedVariant({
    ...draft,
    selected_provider_key: selectedKey,
  });
  if (!variant?.preview_path) {
    throw new Error("No preview to approve");
  }

  const freshUrl = await createSignedUrl(variant.preview_path);
  const oldPaths = await collectOldAvatarPaths(person);
  const version = `av_${Date.now()}`;
  const stored: StoredAvatar = {
    url: freshUrl,
    storage_path: variant.preview_path,
    content_type: resolveAvatarContentType(
      undefined,
      variant.preview_path,
    ),
    attributes: draft.attributes,
    created_at: new Date().toISOString(),
    version,
  };

  const db = fashionMemoryDb();
  const { error } = await db
    .from("people")
    .update({
      avatar: stored,
      avatar_source_photo_path: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", params.userId)
    .eq("id", params.personId);
  if (error) {
    throw new Error(`Could not save avatar: ${error.message}`);
  }

  const keepPaths = new Set(
    [variant.preview_path].filter(Boolean) as string[],
  );
  const unusedPreviewPaths = collectPreviewPaths(draft).filter(
    (path) => !keepPaths.has(path),
  );
  const toDelete = [
    ...oldPaths.filter((path) => !keepPaths.has(path)),
    ...unusedPreviewPaths,
  ];
  if (draft.photo_path) toDelete.push(draft.photo_path);
  await deleteDraft(params.personId);
  if (toDelete.length) await deletePrivateObjects(toDelete);

  if (person.relation === "self") {
    await setTryonEnabledForUser(params.userId, true);
    await prisma.userProfile.upsert({
      where: { userId: params.userId },
      create: { userId: params.userId, tryonEnabled: true, tryonOutfitsEnabled: true },
      update: { tryonEnabled: true, tryonOutfitsEnabled: true },
    });
  }

  return stored;
}

/** True when a person row has avatar bytes on file — does not sign a URL. */
export function personHasStoredAvatar(
  avatar:
    | { url?: string | null; storage_path?: string | null }
    | null
    | undefined,
): boolean {
  return Boolean(avatar?.storage_path?.trim() || avatar?.url?.trim());
}

export async function hasStoredAvatar(
  userId: string,
  personId: string,
): Promise<boolean> {
  const resolved = await resolvePersonIdRef(userId, personId);
  if (!resolved) return false;
  const person = await getPersonById(userId, resolved);
  if (!person) return false;
  return personHasStoredAvatar(
    (person as PersonRow & { avatar?: StoredAvatar | null }).avatar,
  );
}

export async function getStoredAvatar(
  userId: string,
  personId: string,
): Promise<StoredAvatar | null> {
  const resolved = await resolvePersonIdRef(userId, personId);
  if (!resolved) return null;
  const person = await getPersonById(userId, resolved);
  if (!person) return null;
  const avatar = (person as PersonRow & { avatar?: StoredAvatar }).avatar;
  if (!avatar) return null;
  if (!personHasStoredAvatar(avatar)) return null;
  const content_type = resolveAvatarContentType(
    avatar.content_type,
    avatar.storage_path,
  );
  if (!avatar.storage_path) {
    return { ...avatar, content_type };
  }
  try {
    const signed = await createSignedUrl(avatar.storage_path);
    return { ...avatar, url: signed, content_type };
  } catch {
    // Bytes are on file — callers can still serve /api/avatar/:id/image.
    return { ...avatar, content_type };
  }
}

async function collectOldAvatarPaths(person: PersonRow): Promise<string[]> {
  const paths: string[] = [];
  const p = person as PersonRow & {
    avatar?: StoredAvatar;
    avatar_source_photo_path?: string;
  };
  if (p.avatar?.storage_path) paths.push(p.avatar.storage_path);
  if (p.avatar_source_photo_path) paths.push(p.avatar_source_photo_path);
  return paths;
}

async function upsertDraft(userId: string, draft: AvatarDraft): Promise<void> {
  const db = fashionMemoryDb();
  const { error } = await db.from("avatar_drafts").upsert({
    person_id: draft.person_id,
    user_id: userId,
    step: draft.step,
    photo_path: draft.photo_path ?? null,
    attributes: draft.attributes ?? null,
    preview_url: draft.preview_url ?? null,
    preview_path: draft.preview_path ?? null,
    preview_variants: draft.preview_variants ?? null,
    selected_provider_key: draft.selected_provider_key ?? null,
    regen_count: draft.regen_count,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`Could not save avatar progress: ${error.message}`);
  }
}

async function getDraft(
  userId: string,
  personId: string,
): Promise<AvatarDraft | null> {
  const db = fashionMemoryDb();
  const { data, error } = await db
    .from("avatar_drafts")
    .select("*")
    .eq("person_id", personId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not load avatar progress: ${error.message}`);
  }
  if (!data) return null;
  return {
    person_id: data.person_id,
    step: data.step,
    photo_path: data.photo_path ?? undefined,
    attributes: data.attributes ?? undefined,
    preview_url: data.preview_url ?? undefined,
    preview_path: data.preview_path ?? undefined,
    preview_variants: data.preview_variants ?? undefined,
    selected_provider_key: data.selected_provider_key ?? undefined,
    compare: Array.isArray(data.preview_variants) && data.preview_variants.length > 1,
    regen_count: data.regen_count ?? 0,
  };
}

async function deleteDraft(personId: string): Promise<void> {
  const db = fashionMemoryDb();
  await db.from("avatar_drafts").delete().eq("person_id", personId);
}

export { getDraft as getAvatarDraftForTests };
