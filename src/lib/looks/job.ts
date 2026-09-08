import { prisma } from "@/lib/ai-chat/db";
import { logFitting } from "@/lib/onboarding/fitting-trace";
import { genderFromUserProfile } from "@/lib/fashion-memory/intake/account-profile-bridge";
import { TARGET_GENDER_FILTER_VALUES } from "@/lib/fashion-memory/department";
import { taxonomyCategoriesForGarment } from "@/lib/fashion-memory/catalog-search/garment-taxonomy";
import { fashionOwnerUserId } from "@/lib/fashion-memory/auth";
import { ensureSelfPerson } from "@/lib/fashion-memory/people";
import {
  parseFittingVerdict,
  FITTING_LOOK_COUNT,
  type StyleContract,
} from "@/lib/photo-analysis/style-contract";
import { hexForSwatch } from "@/lib/photo-analysis/family-hex";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import { resolveSearchCatalog } from "@/lib/shopify/catalog-client-override";
import {
  extractCatalogImageUrl,
  getProduct,
  searchCatalog,
  type CatalogSearchFilters,
} from "@/lib/shopify/catalog";
import { getStoredAvatar } from "@/lib/tryon/avatar/service";
import { dressLook, type DressPiece } from "./dress";
import { FASHN_OUT_OF_CREDITS_NOTE, isFashnOutOfCredits } from "./fashn";
import {
  isGarmentImageOk,
  resolveGarmentImages,
  type GarmentImageOk,
} from "./garment-image";
import { judgeLook } from "./judge";
import { retrieveCandidates, searchQueryFor, type RetrieveSearch } from "./retrieve";
import { mapLimit, pLimit } from "./limit";
import {
  loadLooksPublic,
  lookHasGarments,
  patchLookStatus,
  patchPiece,
  seedLookRows,
  seedSwatchRows,
  type ProductSnapshot,
} from "./store";
import { recolouredTeePng, renderColorSwatch } from "./swatches";
import { assessTwinCoverage } from "./twin-coverage";

export { loadLooksPublic };

/** A failed FASHN step is not a catalog miss — still dress anything with a garment photo. */
export function piecesForDress(
  pieces: Array<{
    slot: string;
    garmentImageUrl: string | null;
    garmentPhotoType: string | null;
    spec: unknown;
  }>,
): DressPiece[] {
  return pieces
    .filter((p) => p.garmentImageUrl)
    .map((p) => ({
      slot: p.slot as DressPiece["slot"],
      spec: p.spec as DressPiece["spec"],
      garmentImageUrl: p.garmentImageUrl!,
      garmentPhotoType: (p.garmentPhotoType === "flat-lay" ? "flat-lay" : "model") as
        | "flat-lay"
        | "model",
    }));
}

/** People/avatar rows store the uuid, not `guest-{uuid}`. */
export function looksTwinUserId(userId: string): string {
  return fashionOwnerUserId(userId) ?? userId;
}

/** Never put JSON-RPC / stack noise on the look card. */
export function looksPublicNote(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  const blob = `${msg} ${cause}`;
  if (isFashnOutOfCredits(err) || /outofcredits|out of credits/i.test(blob)) {
    return FASHN_OUT_OF_CREDITS_NOTE;
  }
  if (/rate limit|fetch failed|econnreset|etimedout|und_err/i.test(blob)) {
    return "Catalog is busy — tap Retry in a moment.";
  }
  if (/JSON-RPC|MCP /i.test(blob)) return "Couldn't reach the catalog — tap Retry.";
  return "Couldn't dress this look";
}

/** Face colours first; core/neutrals if Sol left near_face empty. */
export function swatchesToSeed(contract: Pick<StyleContract, "palette">): Array<{
  family: string;
  shade: string;
  hex: string;
  kind: "yes" | "no";
}> {
  const yesSrc = contract.palette.near_face.length
    ? contract.palette.near_face
    : [...contract.palette.core, ...contract.palette.neutrals];
  return [
    ...yesSrc.slice(0, 3).map((s) => ({
      family: s.family,
      shade: s.shade,
      hex: hexForSwatch(s),
      kind: "yes" as const,
    })),
    ...contract.palette.avoid_near_face.slice(0, 2).map((s) => ({
      family: s.family,
      shade: s.shade,
      hex: hexForSwatch(s),
      kind: "no" as const,
    })),
  ];
}

function snapshotFromProduct(
  id: string,
  title: string,
  imageUrl: string,
  price: { amount: number; currency: string } | null,
): ProductSnapshot {
  return { id, title, imageUrl, price };
}

async function loadCtx(userId: string) {
  const [profile, negatives, brands] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        genderPresentation: true,
        currency: true,
        shippingCountry: true,
        valuePhilosophy: true,
      },
    }),
    prisma.hardNegative.findMany({
      where: { userId },
      select: { value: true },
    }),
    prisma.brandPreference.findMany({
      where: { userId, sentiment: { in: ["avoid", "hate"] } },
      select: { brand: true },
    }),
  ]);
  return {
    dept: genderFromUserProfile(profile?.genderPresentation ?? null),
    country: profile?.shippingCountry ?? null,
    spendTier: profile?.valuePhilosophy ?? null,
    hardNegatives: negatives.map((n) => n.value),
    brandAvoid: brands.map((b) => b.brand),
  };
}

async function twinForLooks(userId: string): Promise<{
  url: string;
  coverage: "full" | "upper";
} | null> {
  const ownerId = looksTwinUserId(userId);
  try {
    const self = await ensureSelfPerson(ownerId);
    const avatar = await getStoredAvatar(ownerId, self.id);
    if (!avatar?.url) return null;
    let coverage = avatar.twin_coverage ?? null;
    if (!coverage) {
      try {
        coverage = await assessTwinCoverage(avatar.url);
      } catch {
        coverage = "full";
      }
    }
    return { url: avatar.url, coverage };
  } catch (err) {
    logFitting("looks.twin_unavailable", {
      error: err instanceof Error ? err.message : "twin unavailable",
    });
    return null;
  }
}

async function failOpenLooks(userId: string, photoHash: string, note: string) {
  const rows = await prisma.verdictLook.findMany({
    where: {
      userId,
      photoHash,
      status: { in: ["queued", "products_ready", "rendering"] },
    },
    select: { id: true },
  });
  await Promise.all(
    rows.map((row) =>
      patchLookStatus(row.id, { status: "failed", renderNote: note }),
    ),
  );
}

async function shopColourLike(params: {
  token: string;
  query: string;
  filters: CatalogSearchFilters;
  png: Buffer;
}): Promise<ProductSnapshot[]> {
  const result = await searchCatalog(params.token, params.query, params.filters, {
    limit: 30,
    like: [
      {
        image: {
          content_type: "image/png",
          data: params.png.toString("base64"),
        },
      },
    ],
    context: { intent: "plain crew neck tee, no logo" },
  });
  const out: ProductSnapshot[] = [];
  for (const p of result.products ?? []) {
    const imageUrl = extractCatalogImageUrl(p);
    if (!p.id || !p.title || !imageUrl) continue;
    out.push({
      id: p.id,
      title: p.title,
      imageUrl,
      price: p.price_range?.min ?? null,
    });
    if (out.length >= 4) break;
  }
  return out;
}

async function resolveOneLook(params: {
  lookId: string;
  lookName: string;
  search: RetrieveSearch;
  token: string;
  ctx: Awaited<ReturnType<typeof loadCtx>>;
  vetoes: string[];
}): Promise<{ productsMs: number; judgeMs: number }> {
  const look = await prisma.verdictLook.findUniqueOrThrow({
    where: { id: params.lookId },
    include: { pieces: true },
  });
  const t0 = Date.now();
  const retrieveCtx = {
    dept: params.ctx.dept,
    country: params.ctx.country,
    spendTier: params.ctx.spendTier,
    hardNegatives: params.ctx.hardNegatives,
    brandAvoid: params.ctx.brandAvoid,
    vetoes: params.vetoes,
  };

  const pieceRows = look.pieces;
  const surviving = await mapLimit(pieceRows, 2, async (row) => {
      const spec = row.spec as Parameters<typeof retrieveCandidates>[0];
      try {
        const found = await retrieveCandidates(spec, retrieveCtx, params.search);
        if (!found.ok) {
          await patchPiece(row.id, {
            status: "dropped",
            dropReason: found.dropReason,
          });
          return { row, spec, ok: [] as GarmentImageOk[] };
        }
        const imaged = await resolveGarmentImages(
          found.candidates,
          spec,
          async (id, selected) =>
            getProduct(params.token, id, selected, {
              preferences: ["Color"],
              filters: {
                available: true,
                ...(params.ctx.country && /^[A-Z]{2}$/i.test(params.ctx.country)
                  ? { ships_to: { country: params.ctx.country.toUpperCase() } }
                  : {}),
              },
            }),
        );
        const ok = imaged.filter(isGarmentImageOk);
        const dropped = imaged.filter((r) => !isGarmentImageOk(r));
        if (dropped.some((d) => "dropReason" in d && d.dropReason === "variant_image_color_mismatch")) {
          logFitting("looks.variant_image_color_mismatch", {
            lookId: params.lookId,
            slot: spec.slot,
            n: dropped.filter((d) => "dropReason" in d && d.dropReason === "variant_image_color_mismatch").length,
          });
        }
        if (ok.length < 1) {
          await patchPiece(row.id, {
            status: "dropped",
            dropReason: "variant_image_color_mismatch",
          });
          return { row, spec, ok: [] };
        }
        return { row, spec, ok };
      } catch (err) {
        logFitting("looks.piece_failed", {
          lookId: params.lookId,
          slot: spec.slot,
          error: err instanceof Error ? err.message : "piece failed",
        });
        await patchPiece(row.id, {
          status: "dropped",
          dropReason: "catalog_error",
        });
        return { row, spec, ok: [] as GarmentImageOk[] };
      }
    },
  );
  const productsMs = Date.now() - t0;

  const judgeable = surviving.filter((s) => s.ok.length > 0);
  if (judgeable.length === 0) {
    await patchLookStatus(params.lookId, {
      status: "failed",
      renderNote: "Couldn't find pieces for this look — tap Retry.",
    });
    return { productsMs, judgeMs: 0 };
  }
  const t1 = Date.now();
  let picks: Array<{ candidateIndex: number; garmentImageIndex: number; garmentPhotoType: "flat-lay" | "model"; observedColor: string; reason: string } | null> = [];
  try {
    picks = await judgeLook({
      lookName: params.lookName,
      pieces: judgeable.map((s) => ({ piece: s.spec, candidates: s.ok })),
    });
  } catch (err) {
    logFitting("looks.judge_failed", {
      lookId: params.lookId,
      error: err instanceof Error ? err.message : "judge failed",
    });
    picks = judgeable.map((s) =>
      s.ok[0]
        ? {
            candidateIndex: 0,
            garmentImageIndex: 0,
            garmentPhotoType: s.ok[0].garmentPhotoType,
            observedColor: s.ok[0].observedFamily,
            reason: "judge_fallback_first",
          }
        : null,
    );
  }
  const judgeMs = Date.now() - t1;

  for (let i = 0; i < judgeable.length; i++) {
    const s = judgeable[i]!;
    const pick = picks[i];
    if (!pick) {
      await patchPiece(s.row.id, { status: "dropped", dropReason: "judge_none" });
      continue;
    }
    const chosen = s.ok[pick.candidateIndex];
    if (!chosen) {
      await patchPiece(s.row.id, { status: "dropped", dropReason: "judge_none" });
      continue;
    }
    const image =
      chosen.garmentImageUrls[pick.garmentImageIndex] ?? chosen.garmentImageUrls[0] ?? "";
    const featured = chosen.product.variants?.[0];
    await patchPiece(s.row.id, {
      status: "picked",
      productId: chosen.product.id,
      variantId: chosen.variantId ?? featured?.id ?? null,
      productSnapshot: snapshotFromProduct(
        chosen.product.id,
        chosen.product.title,
        image,
        featured?.price ?? chosen.product.price_range?.min ?? null,
      ),
      garmentImageUrl: image,
      garmentPhotoType: pick.garmentPhotoType,
      observedFamily: chosen.observedFamily,
    });
    if (chosen.variantId) {
      try {
        const like = await searchCatalog(params.token, "", {}, {
          limit: 6,
          like: [{ id: chosen.variantId }],
        });
        const alts = (like.products ?? []).map((p) => p.id).filter(Boolean).slice(0, 6);
        if (alts.length) await patchPiece(s.row.id, { alternates: alts });
      } catch {
        /* retry material only */
      }
    }
  }

  await patchLookStatus(params.lookId, { status: "products_ready" });
  return { productsMs, judgeMs };
}

async function dressResolvedLook(params: {
  userId: string;
  photoHash: string;
  lookId: string;
  twin: { url: string; coverage: "full" | "upper" };
}): Promise<void> {
  const look = await prisma.verdictLook.findUnique({
    where: { id: params.lookId },
    include: { pieces: true },
  });
  if (!look || look.status === "ready") return;

  const dressPieces = piecesForDress(look.pieces);
  if (!dressPieces.some((p) => p.slot === "top" || p.slot === "one_piece")) {
    await patchLookStatus(look.id, { status: "failed", renderNote: "no top pick" });
    return;
  }

  await patchLookStatus(look.id, { status: "rendering" });
  try {
    const out = await dressLook({
      userId: params.userId,
      photoHash: params.photoHash,
      lookId: look.id,
      modelImageUrl: params.twin.url,
      pieces: dressPieces,
      twinCoverage: params.twin.coverage,
    });
    if (out.status !== "failed") {
      for (const slot of out.droppedSlots) {
        const piece = look.pieces.find((p) => p.slot === slot);
        if (piece) {
          await patchPiece(piece.id, { status: "dropped", dropReason: "render_check" });
        }
      }
      for (const p of look.pieces.filter((x) => x.status === "picked" || x.status === "verified")) {
        if (!out.droppedSlots.includes(p.slot as never)) {
          await patchPiece(p.id, { status: "verified" });
        }
      }
    }
    await patchLookStatus(look.id, {
      status: out.status,
      renderUrl: out.renderUrl,
      renderPath: out.renderPath,
      renderNote: out.renderNote,
      creditsUsed: look.creditsUsed + out.credits,
    });
    logFitting("looks.dressed", {
      lookId: look.id,
      status: out.status,
      credits: out.credits,
      observed: out.verify?.pieces.map((p) => ({
        slot: p.slot,
        family: p.observedFamily,
        matches: p.matches,
      })),
    });
  } catch (err) {
    await patchLookStatus(look.id, {
      status: "failed",
      renderNote: looksPublicNote(err),
    });
  }
}

async function renderSwatchesJob(params: {
  userId: string;
  photoHash: string;
  modelUrl: string;
  token: string;
  ctx: Awaited<ReturnType<typeof loadCtx>>;
}): Promise<void> {
  const rows = await prisma.colorSwatchRender.findMany({
    where: { userId: params.userId, photoHash: params.photoHash },
  });
  const gender = params.ctx.dept
    ? TARGET_GENDER_FILTER_VALUES[params.ctx.dept]
    : null;
  const country = params.ctx.country?.trim().toUpperCase();
  const filters: CatalogSearchFilters = {
    available: true,
    categories: taxonomyCategoriesForGarment("tee"),
    ...(country && /^[A-Z]{2}$/.test(country) ? { ships_to: { country } } : {}),
    ...(gender?.length
      ? { attributes: [{ name: "Target gender", values: [...gender] }] }
      : {}),
  };

  await Promise.all(
    rows.map(async (row) => {
      await prisma.colorSwatchRender.update({
        where: { id: row.id },
        data: { status: "rendering" },
      });
      const result = await renderColorSwatch({
        userId: params.userId,
        photoHash: params.photoHash,
        kind: row.kind as "yes" | "no",
        modelImageUrl: params.modelUrl,
        swatch: {
          family: row.family as never,
          shade: row.shade,
          hex: row.hex,
        },
      });
      let shop: ProductSnapshot[] | undefined;
      try {
        const png = await recolouredTeePng(row.hex);
        shop = await shopColourLike({
          token: params.token,
          query: searchQueryFor({
            slot: "top",
            garment_type: "tee",
            color_family: row.family as never,
            shade: row.shade || row.family,
            fallback_family: null,
            fit: "regular",
            neckline: "crew",
            must_have: [],
            must_not: [],
          }),
          filters,
          png,
        });
      } catch {
        shop = undefined;
      }
      await prisma.colorSwatchRender.update({
        where: { id: row.id },
        data: {
          status: result.status === "ready" ? "ready" : "chip",
          renderUrl: result.renderUrl,
          renderPath: result.renderPath,
          templateUrl: result.templateUrl,
          creditsUsed: result.credits,
          shopProducts: shop ?? undefined,
          dropReason: result.status === "chip" ? "swatch_hex_fallback" : null,
        },
      });
    }),
  );
}

async function looksSearchSetup(userId: string): Promise<{
  ctx: Awaited<ReturnType<typeof loadCtx>>;
  twin: Awaited<ReturnType<typeof twinForLooks>>;
  token: string;
  search: RetrieveSearch;
}> {
  const [ctx, twin, token] = await Promise.all([
    loadCtx(userId),
    twinForLooks(userId),
    accessTokenForCatalogMcp(),
  ]);
  const searchImpl = resolveSearchCatalog();
  const search: RetrieveSearch = (query, filters, options) =>
    searchImpl(token, query, filters, {
      limit: options.limit,
      context: options.context,
    });
  return { ctx, twin, token, search };
}

const looksJobs = new Map<string, Promise<void>>();

export function looksJobRunning(userId: string, photoHash: string): boolean {
  return looksJobs.has(`${userId}:${photoHash}`);
}

export async function resolveLooksJob(userId: string, photoHash: string): Promise<void> {
  const key = `${userId}:${photoHash}`;
  const running = looksJobs.get(key);
  if (running) return running;

  const started = Date.now();
  const work = (async () => {
    const row = await prisma.photoAnalysis.findUnique({
      where: { userId_photoHash: { userId, photoHash } },
    });
    const fitting = parseFittingVerdict(row?.verdict);
    if (!fitting) {
      logFitting("looks.skip", { reason: "no_contract", photoHash });
      return;
    }

    try {
      await runLooksJob({ userId, photoHash, fitting, started });
    } catch (err) {
      await failOpenLooks(userId, photoHash, looksPublicNote(err));
      throw err;
    }
  })().finally(() => {
    looksJobs.delete(key);
  });
  looksJobs.set(key, work);
  return work;
}

async function awaitLooksJob(userId: string, photoHash: string): Promise<void> {
  const running = looksJobs.get(`${userId}:${photoHash}`);
  if (running) await running.catch(() => {});
}

async function runLooksJob(params: {
  userId: string;
  photoHash: string;
  fitting: NonNullable<ReturnType<typeof parseFittingVerdict>>;
  started: number;
}): Promise<void> {
  const { userId, photoHash, fitting, started } = params;
  const looks = fitting.contract.looks.slice(0, FITTING_LOOK_COUNT);
  await seedLookRows({
    userId,
    photoHash,
    looks: looks.map((l) => ({ name: l.name, pieces: l.pieces })),
  });

  await seedSwatchRows({
    userId,
    photoHash,
    rows: swatchesToSeed(fitting.contract),
  });

  const { ctx, twin, token, search } = await looksSearchSetup(userId);

  const swatchPromise = twin
    ? renderSwatchesJob({
        userId,
        photoHash,
        modelUrl: twin.url,
        token,
        ctx,
      })
    : Promise.resolve();

  const lookRows = await prisma.verdictLook.findMany({
    where: { userId, photoHash },
    include: { pieces: true },
    orderBy: { lookIndex: "asc" },
  });

  const tRetrieve = Date.now();
  const dressLimit = pLimit(2);
  const dresses: Promise<void>[] = [];

  await mapLimit(lookRows, 2, async (look) => {
    if (look.status === "ready" || look.status === "degraded") return;
    if (look.status === "failed" && !lookHasGarments(look.pieces)) return;

    if (!lookHasGarments(look.pieces)) {
      try {
        const ms = await resolveOneLook({
          lookId: look.id,
          lookName: look.name,
          search,
          token,
          ctx,
          vetoes: fitting.contract.vetoes,
        });
        logFitting("looks.products_ready", {
          lookId: look.id,
          lookIndex: look.lookIndex,
          productsMs: ms.productsMs,
          judgeMs: ms.judgeMs,
        });
      } catch (err) {
        logFitting("looks.products_failed", {
          lookId: look.id,
          lookIndex: look.lookIndex,
          error: err instanceof Error ? err.message : "products failed",
        });
        await patchLookStatus(look.id, {
          status: "failed",
          renderNote: looksPublicNote(err),
        });
        return;
      }
    } else {
      logFitting("looks.products_ready", {
        lookId: look.id,
        lookIndex: look.lookIndex,
        productsMs: 0,
        judgeMs: 0,
        reused: true,
      });
    }

    if (!twin) {
      await patchLookStatus(look.id, {
        status: "degraded",
        renderNote: "no twin",
      });
      return;
    }

    dresses.push(
      dressLimit(() =>
        dressResolvedLook({
          userId,
          photoHash,
          lookId: look.id,
          twin,
        }),
      ),
    );
  });
  logFitting("looks.products_visible", {
    photoHash,
    ms: Date.now() - tRetrieve,
    totalMs: Date.now() - started,
  });

  if (!twin) {
    logFitting("looks.no_twin", { photoHash });
    await swatchPromise;
    return;
  }

  await Promise.all(dresses);
  await swatchPromise;
  logFitting("looks.done", { photoHash, ms: Date.now() - started });
}

export async function retryLookRender(params: {
  userId: string;
  photoHash: string;
  lookIndex: number;
}): Promise<void> {
  await awaitLooksJob(params.userId, params.photoHash);

  let current = await prisma.verdictLook.findUnique({
    where: {
      userId_photoHash_lookIndex: {
        userId: params.userId,
        photoHash: params.photoHash,
        lookIndex: params.lookIndex,
      },
    },
    include: { pieces: true },
  });
  if (!current || current.status === "ready") return;

  const row = await prisma.photoAnalysis.findUnique({
    where: {
      userId_photoHash: { userId: params.userId, photoHash: params.photoHash },
    },
  });
  const fitting = parseFittingVerdict(row?.verdict);
  if (!fitting) {
    await patchLookStatus(current.id, {
      status: "failed",
      renderNote: "no contract",
    });
    return;
  }

  const { ctx, twin, token, search } = await looksSearchSetup(params.userId);
  if (!lookHasGarments(current.pieces)) {
    try {
      await resolveOneLook({
        lookId: current.id,
        lookName: current.name,
        search,
        token,
        ctx,
        vetoes: fitting.contract.vetoes,
      });
    } catch (err) {
      await patchLookStatus(current.id, {
        status: "failed",
        renderNote: looksPublicNote(err),
      });
      return;
    }
    current = await prisma.verdictLook.findUniqueOrThrow({
      where: { id: current.id },
      include: { pieces: true },
    });
    if (current.status === "failed") return;
  }

  if (!twin) {
    await patchLookStatus(current.id, {
      status: "degraded",
      renderNote: "no twin",
    });
    return;
  }

  await dressResolvedLook({
    userId: params.userId,
    photoHash: params.photoHash,
    lookId: current.id,
    twin,
  });
}
