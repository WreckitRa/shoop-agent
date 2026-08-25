import { kvGet, kvIncrBy } from "@/lib/cache/kv-store";
import { PHOTO_ERROR } from "@/lib/photo-analysis/errors";
import { alertDanny } from "./alert-danny";

export function photoModelDailySpendCap(): number {
  return Number(process.env.PHOTO_MODEL_DAILY_SPEND_CAP ?? "40");
}

/** Conservative USD estimates — vision + long JSON. Better to halt early. */
export const PHOTO_MODEL_COST_ESTIMATES = {
  preflight: 0.06,
  analysis: 0.45,
  verdict: 0.25,
} as const;

export class PhotoSpendCapError extends Error {
  readonly status = 429;
  constructor(message = PHOTO_ERROR.spend_cap) {
    super(message);
    this.name = "PhotoSpendCapError";
  }
}

function utcDayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function spendKey(): string {
  const ns = process.env.PHOTO_MODEL_SPEND_NS?.trim() || "default";
  return `spend:photo-model:${ns}:${utcDayStamp()}`;
}

function cents(usd: number): number {
  return Math.max(1, Math.round(usd * 100));
}

export async function photoModelSpendUsdToday(): Promise<number> {
  const raw = await kvGet(spendKey());
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n / 100 : 0;
}

/** Reserve estimated model spend. Throws when the daily ceiling would be crossed. */
export async function assertPhotoModelSpend(usd: number): Promise<void> {
  const cap = photoModelDailySpendCap();
  if (!(cap > 0) || !(usd > 0)) return;

  const nextCents = await kvIncrBy(spendKey(), cents(usd), 60 * 60 * 36);
  const nextUsd = nextCents / 100;
  if (nextUsd - usd < cap && nextUsd >= cap) {
    await alertDanny({
      subject: "Photo model daily spend cap hit",
      body: `OpenAI photo pipeline estimated spend reached $${nextUsd.toFixed(2)} (cap $${cap}) on ${utcDayStamp()} UTC.\nFurther analysis and stylist verdicts are blocked until tomorrow.`,
    });
  }
  if (nextUsd > cap) {
    throw new PhotoSpendCapError();
  }
}
