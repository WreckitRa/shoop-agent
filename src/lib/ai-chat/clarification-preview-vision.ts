/**
 * Cheap Haiku vision gate for clarification style/mood preview images.
 * Accepts only photos that clearly match the option label and look retail-ready.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createLightweightMessage } from "@/lib/ai-chat/anthropic";
import { logAiChat } from "@/lib/ai-chat/observability";
import { stripJsonFence, stripNullFields } from "@/lib/ai-chat/llm-json";
import { kvGet, kvSetex } from "@/lib/cache/kv-store";
import { catalogDisplayImageUrl } from "@/lib/shopify/catalog-display-image";

const VISION_CACHE_TTL_SEC = 14 * 24 * 60 * 60;
const VISION_MAX_PX = 384;
const FETCH_MAX_BYTES = 1_500_000;
const JPEG_QUALITY = 72;

export type PreviewVisionVerdict = {
  ok: boolean;
  reason?: string;
};

function visionCacheKey(label: string, url: string): string {
  const hash = createHash("sha256")
    .update(`${label.trim().toLowerCase()}|${url.trim()}`)
    .digest("hex")
    .slice(0, 32);
  return `clarification-vision:v1:${hash}`;
}

async function readCachedVerdict(
  label: string,
  url: string,
): Promise<PreviewVisionVerdict | null> {
  try {
    const cached = await kvGet(visionCacheKey(label, url));
    if (!cached) return null;
    const parsed = JSON.parse(cached) as PreviewVisionVerdict;
    if (typeof parsed?.ok === "boolean") return parsed;
  } catch {
    /* miss */
  }
  return null;
}

async function writeCachedVerdict(
  label: string,
  url: string,
  verdict: PreviewVisionVerdict,
): Promise<void> {
  try {
    await kvSetex(
      visionCacheKey(label, url),
      VISION_CACHE_TTL_SEC,
      JSON.stringify({ ok: verdict.ok, reason: verdict.reason?.slice(0, 120) }),
    );
  } catch {
    /* best-effort */
  }
}

async function fetchVisionImageBase64(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const fetchUrl = catalogDisplayImageUrl(imageUrl, VISION_MAX_PX, {
    crop: "center",
  });
  try {
    const res = await fetch(fetchUrl, {
      signal,
      headers: { Accept: "image/*" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > FETCH_MAX_BYTES) return null;
    const resized = await sharp(buf)
      .rotate()
      .resize({
        width: VISION_MAX_PX,
        height: VISION_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return resized.toString("base64");
  } catch (error) {
    if (signal?.aborted) return null;
    logAiChat("warn", "clarification_vision_image_prepare_failed", {
      url: imageUrl.slice(0, 120),
      error: String(error).slice(0, 160),
    });
    return null;
  }
}

function parseVerdict(text: string): PreviewVisionVerdict | null {
  try {
    const parsed = stripNullFields(JSON.parse(stripJsonFence(text))) as {
      ok?: unknown;
      reason?: unknown;
    };
    if (typeof parsed.ok !== "boolean") return null;
    return {
      ok: parsed.ok,
      reason:
        typeof parsed.reason === "string" ? parsed.reason.slice(0, 160) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Score whether a product photo is a good visual for the style/mood label.
 * Fail-open on transport/model errors (caller may still try next candidate).
 */
export async function scoreClarificationPreviewImage(params: {
  label: string;
  imageUrl: string;
  signal?: AbortSignal;
  deadlineAt?: number;
}): Promise<PreviewVisionVerdict> {
  const label = params.label.trim();
  const imageUrl = params.imageUrl.trim();
  if (!label || !imageUrl) return { ok: false, reason: "missing_input" };

  if (params.deadlineAt != null && Date.now() >= params.deadlineAt) {
    return { ok: false, reason: "deadline" };
  }

  const cached = await readCachedVerdict(label, imageUrl);
  if (cached) return cached;

  if (params.deadlineAt != null && Date.now() >= params.deadlineAt) {
    return { ok: false, reason: "deadline" };
  }

  const data = await fetchVisionImageBase64(imageUrl, params.signal);
  if (!data) return { ok: false, reason: "image_fetch_failed" };

  if (params.deadlineAt != null && Date.now() >= params.deadlineAt) {
    return { ok: false, reason: "deadline" };
  }

  try {
    const msg = await createLightweightMessage(
      {
        max_tokens: 80,
        temperature: 0,
        system: `You gate fashion quiz preview photos.
Return JSON only: {"ok":boolean,"reason":"short"}.
ok=true only when ALL are true:
1) Clean, attractive retail product/outfit photo (not collage spam, watermark-heavy, or tiny crop).
2) The garment/look clearly matches the mood/style label.
3) Subject is clothing/fashion (not random home goods).
Be strict — prefer ok=false when unsure.`,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data,
                },
              },
              {
                type: "text",
                text: `Mood/style label: ${JSON.stringify(label)}\nDoes this image accurately and attractively represent that label?`,
              },
            ],
          },
        ],
      },
      { signal: params.signal },
    );

    const block = msg.content.find((b) => b.type === "text");
    const verdict =
      block && block.type === "text"
        ? parseVerdict(block.text)
        : null;
    const resolved = verdict ?? { ok: false, reason: "parse_failed" };
    await writeCachedVerdict(label, imageUrl, resolved);
    return resolved;
  } catch (error) {
    if (params.signal?.aborted) {
      return { ok: false, reason: "aborted" };
    }
    logAiChat("warn", "clarification_vision_model_failed", {
      label: label.slice(0, 64),
      error: String(error).slice(0, 160),
    });
    // Fail open so a vision outage still shows a catalog image.
    return { ok: true, reason: "vision_error_fail_open" };
  }
}
