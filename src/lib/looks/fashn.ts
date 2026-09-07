import { FASHN_API_BASE, FASHN_TIMEOUT_MS } from "@/lib/tryon/config";
import { extractFashnOutputUrl } from "@/lib/tryon/providers/fashn-api";
import { fetchImageBytes } from "@/lib/tryon/providers/image-utils";
import { withFashnQueue } from "./queue";

const IMAGE_KEYS = ["model_image", "garment_image", "product_image"] as const;

export const FASHN_OUT_OF_CREDITS_NOTE =
  "Try-on credits ran out — add FASHN credits, then tap Retry.";

let fashnOutOfCredits = false;

export function isFashnOutOfCredits(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /outofcredits|out of credits/i.test(msg);
}

function mimeFromBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

/** FASHN cannot fetch private signed storage URLs — inline those. Public CDNs stay URLs. */
export function fashnNeedsInline(url: string): boolean {
  if (!url || url.startsWith("data:")) return false;
  if (/cdn\.shopify|shopifycdn|cdn\.fashn\.ai/i.test(url)) return false;
  return true;
}

async function toDataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const bytes = await fetchImageBytes(url);
  return `data:${mimeFromBytes(bytes)};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function inlineFashnInputs(
  inputs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out = { ...inputs };
  for (const key of IMAGE_KEYS) {
    const value = out[key];
    if (typeof value === "string" && fashnNeedsInline(value)) {
      out[key] = await toDataUri(value);
    }
  }
  return out;
}

type Waiter = {
  resolve: (value: { url: string; credits: number }) => void;
  reject: (err: Error) => void;
};

const waiters = new Map<string, Waiter>();

export function resolveFashnWebhook(payload: {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
  credits?: number;
}): boolean {
  const id = payload.id?.trim();
  if (!id) return false;
  const waiter = waiters.get(id);
  if (!waiter) return false;
  if (payload.status === "completed") {
    const url = extractFashnOutputUrl({
      status: payload.status,
      output: payload.output as string[] | { images?: string[] },
    });
    if (url) {
      waiters.delete(id);
      waiter.resolve({ url, credits: payload.credits ?? 0 });
      return true;
    }
  }
  if (payload.status === "failed") {
    waiters.delete(id);
    const err =
      typeof payload.error === "string"
        ? payload.error
        : payload.error && typeof payload.error === "object" && "message" in payload.error
          ? String((payload.error as { message?: unknown }).message)
          : "FASHN generation failed";
    waiter.reject(new Error(err));
    return true;
  }
  return false;
}

function webhookUrl(): string | undefined {
  const explicit = process.env.LOOKS_FASHN_WEBHOOK_URL?.trim();
  if (explicit) return explicit;
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "") ||
    "";
  if (!base || /localhost|127\.0\.0\.1/.test(base)) return undefined;
  return `${base}/api/tryon/fashn-webhook`;
}

function creditsFrom(res: Response): number {
  const raw = res.headers.get("x-fashn-credits-used");
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

async function pollUntilDone(
  predictionId: string,
  apiKey: string,
  deadlineMs: number,
): Promise<{ url: string; credits: number }> {
  const started = Date.now();
  let credits = 0;
  while (Date.now() - started < deadlineMs) {
    const remaining = deadlineMs - (Date.now() - started);
    const res = await fetch(`${FASHN_API_BASE}/status/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(Math.min(10_000, remaining)),
    });
    credits = Math.max(credits, creditsFrom(res));
    if (!res.ok) throw new Error(`FASHN status ${res.status}`);
    const body = (await res.json()) as {
      status?: string;
      output?: string[] | { images?: string[] };
      error?: string | { message?: string };
    };
    if (body.status === "completed") {
      const url = extractFashnOutputUrl(body);
      if (!url) throw new Error("FASHN completed without image URL");
      return { url, credits };
    }
    if (body.status === "failed") {
      const err =
        typeof body.error === "string"
          ? body.error
          : body.error?.message ?? "FASHN generation failed";
      throw new Error(err);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error("FASHN generation timed out");
}

export async function runLooksFashn(params: {
  modelName: string;
  inputs: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ url: string; credits: number }> {
  const apiKey = process.env.FASHN_API_KEY;
  if (!apiKey) throw new Error("FASHN_API_KEY not configured");
  const timeoutMs = params.timeoutMs ?? FASHN_TIMEOUT_MS;
  const hook = webhookUrl();

  return withFashnQueue(async () => {
    if (fashnOutOfCredits) {
      throw new Error(
        'FASHN run 429: {"error":"OutOfCredits","message":"You are out of credits. Please visit your account to purchase more."}',
      );
    }
    const inputs = await inlineFashnInputs(params.inputs);
    const runRes = await fetch(`${FASHN_API_BASE}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_name: params.modelName,
        inputs,
        ...(hook ? { webhook_url: hook } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const runText = await runRes.text().catch(() => "");
    if (!runRes.ok) {
      if (runRes.status === 429 && /outofcredits|out of credits/i.test(runText)) {
        fashnOutOfCredits = true;
      }
      throw new Error(`FASHN run ${runRes.status}: ${runText.slice(0, 300)}`);
    }
    const runBody = JSON.parse(runText) as { id?: string; error?: string };
    if (runBody.error) throw new Error(runBody.error);
    if (!runBody.id) throw new Error("FASHN missing prediction id");
    const id = runBody.id;
    const remaining = timeoutMs - 2_000;
    if (!hook) {
      return pollUntilDone(id, apiKey, Math.max(8_000, remaining));
    }

    const fromWebhook = new Promise<{ url: string; credits: number }>((resolve, reject) => {
      waiters.set(id, { resolve, reject });
    });
    const webhookWait = new Promise<{ url: string; credits: number }>((resolve, reject) => {
      const t = setTimeout(() => {
        waiters.delete(id);
        reject(new Error("webhook_timeout"));
      }, 30_000);
      fromWebhook.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });

    try {
      return await webhookWait;
    } catch (err) {
      if (!(err instanceof Error) || err.message !== "webhook_timeout") throw err;
      const remaining = timeoutMs - 30_000;
      return pollUntilDone(id, apiKey, Math.max(8_000, remaining));
    }
  });
}
