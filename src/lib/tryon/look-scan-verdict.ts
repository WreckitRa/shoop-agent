/**
 * Studying Scan — LLM verdict for a dressed try-on look.
 * Uses the try-on image + onboarding honesty/taste/no-list prefs.
 */

import { z } from "zod";
import { getAnthropicClient } from "@/lib/ai-chat/anthropic";
import { logAiChat } from "@/lib/ai-chat/observability";
import {
  parseLlmJsonObject,
  stripNullFields,
} from "@/lib/ai-chat/shopping-memory/llm-json";
import { fetchAndResizeCurationImage } from "@/lib/fashion-memory/curation/curation-images";
import { FASHION_CURATION_MODEL } from "@/lib/fashion-memory/models";
import {
  mapHonestyToVoice,
  honestyToneLine,
} from "@/lib/fashion-memory/router/profile-context-format";
import { HONESTY_OPTIONS } from "@/lib/onboarding/form-options";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import type { LookScanPiece, LookScanVerdict } from "@/lib/tryon/look-scan-types";

export type { LookScanPiece, LookScanVerdict } from "@/lib/tryon/look-scan-types";
export { formatScanEmphasis } from "@/lib/tryon/look-scan-types";

const checkEnum = z.enum(["pass", "caution", "fail"]);

const verdictSchema = z.object({
  verdict_title: z.string().min(1).max(80),
  verdict_body: z.string().min(1).max(600),
  annotations: z.array(z.string().min(1).max(48)).length(4),
  whispers: z.array(z.string().min(1).max(120)).length(4),
  checks: z.object({
    fit: checkEnum,
    palette: checkEnum,
    nolist: checkEnum,
  }),
});

const FALLBACK_ANNOS = [
  "checking the drape",
  "palette vs yours",
  "hem · proportion",
  "no-list · clear ✓",
] as const;

const FALLBACK_WHISPERS = [
  "stepping back for a look...",
  "mm... the shoulders. **interesting.**",
  "checking it against **your no-list...**",
  "one more angle...",
] as const;

function honestyQuote(honesty: string | null | undefined): string {
  const v = honesty?.trim().toLowerCase();
  const opt = HONESTY_OPTIONS.find((o) => o.value === v);
  return opt?.quote ?? "Talk like a sharp personal stylist.";
}

function buildShopperContext(status: Awaited<ReturnType<typeof getOnboardingStatus>>): string {
  const p = status.profile;
  const lines: string[] = [];

  if (p?.preferredName?.trim()) lines.push(`Name: ${p.preferredName.trim()}`);
  if (p?.genderPresentation?.trim()) {
    lines.push(`Presents as: ${p.genderPresentation.trim()}`);
  }
  if (p?.ageRange?.trim()) lines.push(`Age range: ${p.ageRange.trim()}`);
  if (p?.styleEra?.trim()) lines.push(`Style era: ${p.styleEra.trim()}`);
  if (p?.valuePhilosophy?.trim()) {
    lines.push(`Spend philosophy: ${p.valuePhilosophy.trim()}`);
  }
  if (p?.honestyPreference?.trim()) {
    const tone = honestyToneLine(p.honestyPreference);
    if (tone) lines.push(tone);
    lines.push(`Honesty quote to honor: "${honestyQuote(p.honestyPreference)}"`);
  }
  if (Array.isArray(p?.lifestyleTags) && p.lifestyleTags.length) {
    lines.push(`Lifestyle: ${p.lifestyleTags.slice(0, 8).join(", ")}`);
  }
  if (
    Array.isArray(p?.complimentPreferences) &&
    p.complimentPreferences.length
  ) {
    lines.push(
      `Compliment lean: ${p.complimentPreferences.slice(0, 6).join(", ")}`,
    );
  }

  const likes = status.brandPreferences
    ?.filter((b) => b.sentiment === "like" || b.sentiment === "love")
    .map((b) => b.brand)
    .slice(0, 10);
  const avoids = status.brandPreferences
    ?.filter((b) => b.sentiment === "avoid" || b.sentiment === "hate")
    .map((b) => b.brand)
    .slice(0, 8);
  if (likes?.length) lines.push(`Brand likes: ${likes.join(", ")}`);
  if (avoids?.length) lines.push(`Brand avoids: ${avoids.join(", ")}`);

  const noList = status.hardNegatives
    ?.map((n) => n.value)
    .filter(Boolean)
    .slice(0, 12);
  if (noList?.length) lines.push(`Hard no-list: ${noList.join("; ")}`);

  const loveTags = status.tasteTags
    ?.filter((t) => t.polarity === "positive")
    .map((t) => t.tag)
    .slice(0, 12);
  const vetoTags = status.tasteTags
    ?.filter((t) => t.polarity === "negative")
    .map((t) => t.tag)
    .slice(0, 12);
  if (loveTags?.length) lines.push(`Taste loves: ${loveTags.join(", ")}`);
  if (vetoTags?.length) lines.push(`Taste vetoes: ${vetoTags.join(", ")}`);

  const sizing = status.sizing;
  if (sizing) {
    const bits: string[] = [];
    if (sizing.topUsualSize) bits.push(`top ${sizing.topUsualSize}`);
    if (sizing.bottomUsualSize) bits.push(`bottom ${sizing.bottomUsualSize}`);
    if (sizing.shoeEU != null) bits.push(`shoe EU ${sizing.shoeEU}`);
    else if (sizing.shoeUS != null) bits.push(`shoe US ${sizing.shoeUS}`);
    else if (sizing.shoeUK != null) bits.push(`shoe UK ${sizing.shoeUK}`);
    if (bits.length) lines.push(`Sizes: ${bits.join(", ")}`);
  }

  return lines.length ? lines.join("\n") : "Limited profile — judge from the photo.";
}

function piecesBlock(pieces: LookScanPiece[]): string {
  if (!pieces.length) return "Pieces on the look: (not listed — judge from the photo).";
  return [
    "Pieces on the look:",
    ...pieces.map((p, i) => {
      const price = p.priceLabel ? ` · ${p.priceLabel}` : "";
      const g = p.garment ? ` [${p.garment}]` : "";
      return `${i + 1}. ${p.title}${g}${price}`;
    }),
  ].join("\n");
}

const SYSTEM = `You are Shoop's mirror stylist. You study a try-on photo of the shopper wearing an outfit and deliver a short, specific verdict.

Return ONLY a JSON object (no markdown fence) with this exact shape and these exact keys:
{
  "verdict_title": "short headline after 'Verdict:' — e.g. Love-it territory",
  "verdict_body": "2–4 sentences. Use **double asterisks** around the one or two key phrases the shopper must notice.",
  "annotations": ["label1", "label2", "label3", "label4"],
  "whispers": ["line1", "line2", "line3", "line4"],
  "checks": {
    "fit": "pass",
    "palette": "pass",
    "nolist": "pass"
  }
}

Field rules (required — never omit):
- verdict_title: string, ≤12 words
- verdict_body: string, under ~70 words
- annotations: exactly 4 short scan labels, ≤5 words each
- whispers: exactly 4 rotating status lines (intimate, lowercase; **bold** sparingly)
- checks.fit / checks.palette / checks.nolist: each exactly "pass", "caution", or "fail"

Match the shopper's honesty preference (gentle / straight / no-mercy). Be specific to THIS photo and THESE pieces. Honor hard no-list and taste vetoes. Never invent review counts or prices you weren't given.`;

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t || undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function asStringList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const out = v
      .map((x) => asTrimmedString(x))
      .filter((x): x is string => Boolean(x));
    return out.length ? out : undefined;
  }
  if (typeof v === "string" && v.trim()) {
    const out = v
      .split(/\n|;/)
      .map((s) => s.replace(/^[-–•\d.)\s]+/, "").trim())
      .filter(Boolean);
    return out.length ? out : undefined;
  }
  return undefined;
}

function padFour(
  list: string[] | undefined,
  fallback: readonly [string, string, string, string],
  maxLen: number,
): [string, string, string, string] {
  const cleaned = (list ?? [])
    .map((s) => s.trim().slice(0, maxLen))
    .filter(Boolean);
  return [
    cleaned[0] ?? fallback[0],
    cleaned[1] ?? fallback[1],
    cleaned[2] ?? fallback[2],
    cleaned[3] ?? fallback[3],
  ];
}

function coerceCheck(v: unknown): "pass" | "caution" | "fail" | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (t === "pass" || t === "ok" || t === "good" || t === "clear") return "pass";
  if (t === "caution" || t === "warn" || t === "warning" || t === "maybe") {
    return "caution";
  }
  if (t === "fail" || t === "no" || t === "bad" || t === "conflict") return "fail";
  return undefined;
}

/**
 * Models often rename keys (camelCase / nested / shorter aliases) or drop
 * annotations/whispers. Normalize before Zod so a usable verdict still ships.
 */
export function coerceLookScanPayload(raw: unknown): unknown {
  // Defensive: callers must pass parseLlmJsonObject(...).value — unwrap if they forgot.
  let cleaned = stripNullFields(raw);
  if (
    cleaned &&
    typeof cleaned === "object" &&
    !Array.isArray(cleaned) &&
    "value" in cleaned &&
    "salvaged" in cleaned &&
    (cleaned as { salvaged: unknown }).salvaged !== undefined
  ) {
    cleaned = stripNullFields((cleaned as { value: unknown }).value);
  }
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
    return cleaned;
  }

  const root = cleaned as Record<string, unknown>;
  const nested =
    root.verdict &&
    typeof root.verdict === "object" &&
    !Array.isArray(root.verdict)
      ? (root.verdict as Record<string, unknown>)
      : null;

  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (root[key] !== undefined) return root[key];
      if (nested && nested[key] !== undefined) return nested[key];
    }
    return undefined;
  };

  const title =
    asTrimmedString(pick("verdict_title", "verdictTitle", "title", "headline")) ??
    asTrimmedString(root.verdict); // rare: verdict as plain string
  const body = asTrimmedString(
    pick("verdict_body", "verdictBody", "body", "summary", "reason", "text"),
  );

  const annotations = padFour(
    asStringList(pick("annotations", "annos", "labels", "scan_labels")),
    FALLBACK_ANNOS,
    48,
  );
  const whispers = padFour(
    asStringList(pick("whispers", "status_lines", "statusLines", "scan_whispers")),
    FALLBACK_WHISPERS,
    120,
  );

  const checksRaw = pick("checks", "scores", "gates");
  const checksObj =
    checksRaw && typeof checksRaw === "object" && !Array.isArray(checksRaw)
      ? (checksRaw as Record<string, unknown>)
      : {};

  const fit =
    coerceCheck(checksObj.fit) ??
    coerceCheck(checksObj.Fit) ??
    "pass";
  const palette =
    coerceCheck(checksObj.palette) ??
    coerceCheck(checksObj.color) ??
    coerceCheck(checksObj.Palette) ??
    "pass";
  const nolist =
    coerceCheck(checksObj.nolist) ??
    coerceCheck(checksObj.no_list) ??
    coerceCheck(checksObj.noList) ??
    coerceCheck(checksObj.veto) ??
    "pass";

  return {
    verdict_title: title?.slice(0, 80),
    verdict_body: body?.slice(0, 600),
    annotations,
    whispers,
    checks: { fit, palette, nolist },
  };
}

export async function runLookScanVerdict(params: {
  userId: string;
  imageUrl: string;
  pieces: LookScanPiece[];
  signal?: AbortSignal;
}): Promise<LookScanVerdict | null> {
  const image = await fetchAndResizeCurationImage(
    params.imageUrl,
    params.signal,
  );
  if (!image) {
    logAiChat("warn", "look_scan_image_prepare_failed", {
      url: params.imageUrl.slice(0, 120),
    });
    return null;
  }

  const status = await getOnboardingStatus(params.userId);
  const honesty = status.profile?.honestyPreference ?? null;
  const voice = mapHonestyToVoice(honesty);
  const shopper = buildShopperContext(status);

  const userText = `Shopper context:
${shopper}

Honesty mode: ${voice ?? "balanced"}

${piecesBlock(params.pieces)}

Study the try-on photo and return the JSON verdict with ALL required keys.`;

  try {
    const anthropic = getAnthropicClient();
    const msg = await anthropic.messages.create(
      {
        model: FASHION_CURATION_MODEL,
        max_tokens: 900,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              image,
              { type: "text", text: userText },
            ],
          },
        ],
      },
      { signal: params.signal },
    );

    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();

    const parsedResult = parseLlmJsonObject(text);
    if (!parsedResult) {
      logAiChat("warn", "look_scan_parse_failed", {
        preview: text.slice(0, 200),
      });
      return null;
    }

    const parsed = parsedResult.value;
    const coerced = coerceLookScanPayload(parsed);
    const validated = verdictSchema.safeParse(coerced);
    if (!validated.success) {
      logAiChat("warn", "look_scan_schema_failed", {
        salvaged: parsedResult.salvaged,
        keys:
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? Object.keys(parsed as object).slice(0, 12)
            : [],
        issues: validated.error.issues.slice(0, 6).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        preview: text.slice(0, 240),
      });
      return null;
    }

    const v = validated.data;
    return {
      verdict_title: v.verdict_title.trim(),
      verdict_body: v.verdict_body.trim(),
      annotations: v.annotations.map((a) => a.trim()) as LookScanVerdict["annotations"],
      whispers: v.whispers.map((w) => w.trim()) as LookScanVerdict["whispers"],
      checks: v.checks,
    };
  } catch (error) {
    if (params.signal?.aborted) return null;
    logAiChat("warn", "look_scan_llm_failed", {
      error: String(error).slice(0, 200),
    });
    return null;
  }
}
