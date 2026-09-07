import { prisma } from "@/lib/ai-chat/db";
import type { ContractPiece, Slot } from "@/lib/photo-analysis/style-contract";
import { createSignedUrl } from "@/lib/tryon/storage";
import { Prisma, type LookStatus } from "@prisma/client";

export type ProductSnapshot = {
  id: string;
  title: string;
  imageUrl: string;
  price: { amount: number; currency: string } | null;
};

/** Shopped / mid-try-on — a full job must not wipe these. */
export function looksNeedResume(
  looks: Array<{
    status: string;
    pieces: Array<{
      status: string;
      garmentImageUrl?: string | null;
      product?: unknown;
    }>;
  }>,
): boolean {
  return looks.some((look) => {
    if (look.status === "products_ready" || look.status === "rendering") return true;
    if (look.status !== "queued") return false;
    return look.pieces.some(
      (p) =>
        p.status === "picked" ||
        Boolean(p.garmentImageUrl) ||
        Boolean(p.product),
    );
  });
}

export function lookHasGarments(
  pieces: Array<{ garmentImageUrl?: string | null }>,
): boolean {
  return pieces.some((p) => Boolean(p.garmentImageUrl));
}

export async function seedLookRows(params: {
  userId: string;
  photoHash: string;
  looks: Array<{ name: string; pieces: ContractPiece[] }>;
}): Promise<void> {
  for (let i = 0; i < params.looks.length; i++) {
    const look = params.looks[i]!;
    const existing = await prisma.verdictLook.findUnique({
      where: {
        userId_photoHash_lookIndex: {
          userId: params.userId,
          photoHash: params.photoHash,
          lookIndex: i,
        },
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.verdictLook.create({
      data: {
        userId: params.userId,
        photoHash: params.photoHash,
        lookIndex: i,
        name: look.name,
        status: "queued",
        pieces: {
          create: look.pieces.map((spec) => ({
            slot: spec.slot,
            spec,
            status: "pending",
          })),
        },
      },
    });
  }
}

export async function seedSwatchRows(params: {
  userId: string;
  photoHash: string;
  rows: Array<{ family: string; shade: string; hex: string; kind: "yes" | "no" }>;
}): Promise<void> {
  for (const row of params.rows) {
    await prisma.colorSwatchRender.upsert({
      where: {
        userId_photoHash_family_kind_hex: {
          userId: params.userId,
          photoHash: params.photoHash,
          family: row.family,
          kind: row.kind,
          hex: row.hex,
        },
      },
      create: {
        userId: params.userId,
        photoHash: params.photoHash,
        family: row.family,
        shade: row.shade,
        hex: row.hex,
        kind: row.kind,
        status: "queued",
      },
      update: { status: "queued", renderUrl: null, dropReason: null },
    });
  }
}

export async function queueLookRetry(
  userId: string,
  photoHash: string,
  lookIndex: number,
): Promise<void> {
  const looks = await prisma.verdictLook.findMany({
    where: { userId, photoHash, lookIndex },
    select: { id: true },
  });
  const ids = looks.map((l) => l.id);
  if (!ids.length) return;
  await prisma.verdictLook.updateMany({
    where: { id: { in: ids } },
    data: { status: "queued", renderNote: null },
  });
  await prisma.verdictLookPiece.updateMany({
    where: { lookId: { in: ids }, dropReason: "render_check" },
    data: { status: "picked", dropReason: null },
  });
}

export async function patchLookStatus(
  id: string,
  data: {
    status?: LookStatus;
    renderUrl?: string | null;
    renderPath?: string | null;
    renderNote?: string | null;
    creditsUsed?: number;
    timings?: Record<string, number>;
  },
) {
  await prisma.verdictLook.update({ where: { id }, data });
}

export async function patchPiece(
  id: string,
  data: {
    status?: string;
    productId?: string | null;
    variantId?: string | null;
    productSnapshot?: ProductSnapshot | null;
    garmentImageUrl?: string | null;
    garmentPhotoType?: string | null;
    observedFamily?: string | null;
    alternates?: string[];
    dropReason?: string | null;
  },
) {
  await prisma.verdictLookPiece.update({
    where: { id },
    data: {
      ...data,
      productSnapshot:
        data.productSnapshot === undefined
          ? undefined
          : data.productSnapshot === null
            ? Prisma.DbNull
            : data.productSnapshot,
      alternates: data.alternates === undefined ? undefined : data.alternates,
    },
  });
}

export type LookRowPublic = {
  id: string;
  lookIndex: number;
  name: string;
  status: LookStatus;
  renderUrl: string | null;
  renderNote: string | null;
  pieces: Array<{
    id: string;
    slot: Slot;
    spec: ContractPiece;
    status: string;
    dropReason: string | null;
    observedFamily: string | null;
    product: ProductSnapshot | null;
  }>;
};

export type SwatchRowPublic = {
  family: string;
  shade: string;
  hex: string;
  kind: "yes" | "no";
  status: string;
  renderUrl: string | null;
  shopProducts: ProductSnapshot[] | null;
};

export async function loadLooksPublic(
  userId: string,
  photoHash: string,
): Promise<{
  looks: LookRowPublic[];
  swatches: SwatchRowPublic[];
  pending: boolean;
  stuckQueued: boolean;
  needsResume: boolean;
}> {
  const [looks, swatches] = await Promise.all([
    prisma.verdictLook.findMany({
      where: { userId, photoHash },
      include: { pieces: true },
      orderBy: { lookIndex: "asc" },
    }),
    prisma.colorSwatchRender.findMany({
      where: { userId, photoHash },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const lookOut: LookRowPublic[] = [];
  for (const look of looks) {
    let renderUrl = look.renderUrl;
    if (look.renderPath && (!renderUrl || /cdn\.fashn\.ai/i.test(renderUrl))) {
      try {
        renderUrl = await createSignedUrl(look.renderPath, 60 * 60 * 12);
      } catch {
        renderUrl = look.renderUrl;
      }
    }
    lookOut.push({
      id: look.id,
      lookIndex: look.lookIndex,
      name: look.name,
      status: look.status,
      renderUrl,
      renderNote: look.renderNote,
      pieces: look.pieces.map((p) => ({
        id: p.id,
        slot: p.slot as Slot,
        spec: p.spec as ContractPiece,
        status: p.status,
        dropReason: p.dropReason,
        observedFamily: p.observedFamily,
        product: (p.productSnapshot as ProductSnapshot | null) ?? null,
      })),
    });
  }

  const swatchOut: SwatchRowPublic[] = [];
  for (const s of swatches) {
    let renderUrl = s.renderUrl;
    if (s.renderPath && (!renderUrl || /cdn\.fashn\.ai/i.test(renderUrl))) {
      try {
        renderUrl = await createSignedUrl(s.renderPath, 60 * 60 * 12);
      } catch {
        renderUrl = s.renderUrl;
      }
    }
    swatchOut.push({
      family: s.family,
      shade: s.shade,
      hex: s.hex,
      kind: s.kind as "yes" | "no",
      status: s.status,
      renderUrl,
      shopProducts: (s.shopProducts as ProductSnapshot[] | null) ?? null,
    });
  }

  const pending = looks.some(
    (l) =>
      l.status === "queued" ||
      l.status === "products_ready" ||
      l.status === "rendering",
  ) || swatches.some((s) => s.status === "queued" || s.status === "rendering");

  const stuckQueued =
    looks.length > 0 &&
    looks.every((l) => l.status === "queued") &&
    looks.every((l) => l.pieces.every((p) => p.status === "pending")) &&
    looks.every((l) => Date.now() - l.updatedAt.getTime() >= 120_000);

  const needsResume = looksNeedResume(looks);

  return { looks: lookOut, swatches: swatchOut, pending, stuckQueued, needsResume };
}
