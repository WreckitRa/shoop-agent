import { createHash } from "node:crypto";
import type { ContractPiece, Slot } from "@/lib/photo-analysis/style-contract";
import { logFitting } from "@/lib/onboarding/fitting-trace";
import {
  createSignedUrl,
  uploadPrivateObject,
} from "@/lib/tryon/storage";
import { runLooksFashn, isFashnOutOfCredits, FASHN_OUT_OF_CREDITS_NOTE } from "./fashn";
import { verifyLookRender, type VerifyResult } from "./verify";

export type DressPiece = {
  slot: Slot;
  spec: ContractPiece;
  garmentImageUrl: string;
  garmentPhotoType: "flat-lay" | "model";
};

export type DressOutcome = {
  status: "ready" | "degraded" | "failed";
  renderPath: string | null;
  renderUrl: string | null;
  renderNote: string | null;
  credits: number;
  verify: VerifyResult | null;
  droppedSlots: Slot[];
};

function hashSeed(lookId: string): number {
  const n = parseInt(createHash("sha256").update(lookId).digest("hex").slice(0, 8), 16);
  return n % 1_000_000;
}

async function downloadJpeg(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function persistOutput(params: {
  userId: string;
  photoHash: string;
  lookId: string;
  url: string;
}): Promise<{ path: string; signed: string }> {
  const bytes = await downloadJpeg(params.url);
  const filename = `${params.lookId}-${Date.now()}.jpg`;
  const { path } = await uploadPrivateObject({
    userId: params.userId,
    personId: params.photoHash,
    kind: "tryon",
    filename,
    bytes,
    contentType: "image/jpeg",
  });
  const signed = await createSignedUrl(path, 60 * 60 * 24);
  return { path, signed };
}

function v16Category(slot: Slot): "tops" | "bottoms" | "one-pieces" | null {
  if (slot === "top") return "tops";
  if (slot === "bottom") return "bottoms";
  if (slot === "one_piece") return "one-pieces";
  return null;
}

export function dressShoesEnabled(): boolean {
  return process.env.LOOKS_DRESS_SHOES === "true";
}

function maxPrompt(slot: Slot): string {
  if (slot === "outerwear") {
    return "wear this open over the current top; keep the top underneath visible; keep trousers and shoes unchanged";
  }
  if (slot === "shoes") return "replace shoes only";
  if (slot === "bottom") {
    return "REPLACE the existing lower-body clothing completely with this product — do not layer it on top of the current pants. Preserve color, fabric, and cut from the product image.";
  }
  if (slot === "one_piece") {
    return "REPLACE the full current outfit with this one-piece. Preserve color, fabric, and cut from the product image.";
  }
  return "REPLACE the existing upper-body clothing completely with this product — do not layer it on top of the current shirt. Preserve color, fabric, and cut from the product image.";
}

function runMax(params: {
  modelImage: string;
  garmentImage: string;
  slot: Slot;
  seed: number;
}): Promise<{ url: string; credits: number }> {
  return runLooksFashn({
    modelName: "tryon-max",
    inputs: {
      model_image: params.modelImage,
      product_image: params.garmentImage,
      prompt: maxPrompt(params.slot),
      generation_mode: "fast",
      resolution: "1k",
      output_format: "jpeg",
      seed: params.seed,
    },
  });
}

async function runStep(params: {
  slot: Slot;
  modelImage: string;
  garmentImage: string;
  garmentPhotoType: "flat-lay" | "model";
  seed: number;
  segmentationFree: boolean;
}): Promise<{ url: string; credits: number }> {
  if (params.slot === "outerwear" || params.slot === "shoes") {
    return runMax(params);
  }
  const category = v16Category(params.slot);
  if (!category) throw new Error(`no fashn category for ${params.slot}`);
  try {
    return await runLooksFashn({
      modelName: "tryon-v1.6",
      inputs: {
        model_image: params.modelImage,
        garment_image: params.garmentImage,
        category,
        mode: "balanced",
        garment_photo_type: "auto",
        output_format: "jpeg",
        seed: params.seed,
        segmentation_free: params.segmentationFree,
      },
    });
  } catch (err) {
    logFitting("looks.fashn_v16_failed", {
      slot: params.slot,
      error: err instanceof Error ? err.message : "v1.6 failed",
    });
    if (isFashnOutOfCredits(err)) throw err;
    return runMax(params);
  }
}

export async function dressLook(params: {
  userId: string;
  photoHash: string;
  lookId: string;
  modelImageUrl: string;
  pieces: DressPiece[];
  twinCoverage: "full" | "upper";
}): Promise<DressOutcome> {
  const order: Slot[] = ["one_piece", "top", "bottom", "outerwear"];
  if (dressShoesEnabled() && params.twinCoverage === "full") order.push("shoes");
  const bySlot = new Map(params.pieces.map((p) => [p.slot, p]));
  const chain = order.filter((slot) => {
    if (slot === "bottom" && params.twinCoverage === "upper") return false;
    return bySlot.has(slot);
  });

  let model = params.modelImageUrl;
  let lastPath: string | null = null;
  let lastSigned: string | null = null;
  let credits = 0;
  const dropped: Slot[] = [];
  let note: string | null = null;
  const seed0 = hashSeed(params.lookId);

  const dressed: DressPiece[] = [];

  for (const slot of chain) {
    const piece = bySlot.get(slot);
    if (!piece) continue;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await runStep({
          slot,
          modelImage: model,
          garmentImage: piece.garmentImageUrl,
          garmentPhotoType: piece.garmentPhotoType,
          seed: seed0 + attempt,
          segmentationFree: attempt === 0,
        });
        credits += out.credits;
        const stored = await persistOutput({
          userId: params.userId,
          photoHash: params.photoHash,
          lookId: params.lookId,
          url: out.url,
        });
        // FASHN must see a public CDN URL or a data URI — not our signed storage URL.
        model = out.url;
        lastPath = stored.path;
        lastSigned = stored.signed;
        dressed.push(piece);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        logFitting("looks.dress_step_failed", {
          lookId: params.lookId,
          slot,
          attempt,
          error: err instanceof Error ? err.message : "dress step failed",
        });
        if (isFashnOutOfCredits(err)) break;
      }
    }
    if (lastErr) {
      if (isFashnOutOfCredits(lastErr) || slot === "top" || slot === "one_piece") {
        return {
          status: "failed",
          renderPath: null,
          renderUrl: null,
          renderNote: isFashnOutOfCredits(lastErr)
            ? FASHN_OUT_OF_CREDITS_NOTE
            : "top could not dress",
          credits,
          verify: null,
          droppedSlots: [...dropped, slot],
        };
      }
      dropped.push(slot);
      note = slot === "bottom" ? "shown without the trousers" : `shown without the ${slot}`;
    }
  }

  if (!dressed.some((p) => p.slot === "top" || p.slot === "one_piece")) {
    return {
      status: "failed",
      renderPath: null,
      renderUrl: null,
      renderNote: "top could not dress",
      credits,
      verify: null,
      droppedSlots: dropped,
    };
  }

  let verify: VerifyResult | null = null;
  try {
    verify = await verifyLookRender({
      renderUrl: model,
      pieces: dressed.map((p) => ({ slot: p.slot, spec: p.spec })),
    });
  } catch {
    verify = null;
  }

  if (verify?.baseTeeVisible || (verify && !verify.pass && dressed.some((p) => p.slot === "top" || p.slot === "one_piece"))) {
    const top = dressed.find((p) => p.slot === "top" || p.slot === "one_piece");
    if (top) {
      try {
        const retry = await runStep({
          slot: top.slot,
          modelImage: params.modelImageUrl,
          garmentImage: top.garmentImageUrl,
          garmentPhotoType: top.garmentPhotoType,
          seed: seed0 + 3,
          segmentationFree: false,
        });
        credits += retry.credits;
        const stored = await persistOutput({
          userId: params.userId,
          photoHash: params.photoHash,
          lookId: params.lookId,
          url: retry.url,
        });
        model = retry.url;
        lastPath = stored.path;
        lastSigned = stored.signed;
        verify = await verifyLookRender({
          renderUrl: retry.url,
          pieces: dressed.map((p) => ({ slot: p.slot, spec: p.spec })),
        });
      } catch {
        return {
          status: "failed",
          renderPath: null,
          renderUrl: null,
          renderNote: "base tee still visible",
          credits,
          verify,
          droppedSlots: dropped,
        };
      }
    }
  }

  if (verify?.baseTeeVisible || verify?.faceChanged || verify?.extraLimb) {
    return {
      status: "failed",
      renderPath: null,
      renderUrl: null,
      renderNote: verify.baseTeeVisible ? "base tee still visible" : "render artifacts",
      credits,
      verify,
      droppedSlots: dropped,
    };
  }

  const topCheck = verify?.pieces.find((p) => p.slot === "top" || p.slot === "one_piece");
  if (topCheck && (!topCheck.present || !topCheck.matches)) {
    return {
      status: "failed",
      renderPath: null,
      renderUrl: null,
      renderNote: "top colour did not match",
      credits,
      verify,
      droppedSlots: dropped,
    };
  }

  const bottomCheck = verify?.pieces.find((p) => p.slot === "bottom");
  if (bottomCheck && (!bottomCheck.present || !bottomCheck.matches)) {
    dropped.push("bottom");
    note = "shown without the trousers";
  }

  return {
    status: dropped.length ? "degraded" : "ready",
    renderPath: lastPath,
    renderUrl: lastSigned ?? model,
    renderNote: note,
    credits,
    verify,
    droppedSlots: dropped,
  };
}
