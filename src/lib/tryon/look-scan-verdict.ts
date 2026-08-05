/**
 * Studying Scan — LLM verdict for a dressed try-on look.
 * Uses the try-on image + onboarding honesty/taste/no-list prefs.
 */

import { z } from "zod";
import { getAnthropicClient } from "@/lib/ai-chat/anthropic";
import { logAiChat } from "@/lib/ai-chat/observability";
import { parseLlmJsonObject } from "@/lib/ai-chat/shopping-memory/llm-json";
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

const verdictSchema = z.object({
  verdict_title: z.string().min(1).max(80),
  verdict_body: z.string().min(1).max(600),
  annotations: z.array(z.string().min(1).max(48)).length(4),
  whispers: z.array(z.string().min(1).max(120)).length(4),
  checks: z.object({
    fit: z.enum(["pass", "caution", "fail"]),
    palette: z.enum(["pass", "caution", "fail"]),
    nolist: z.enum(["pass", "caution", "fail"]),
  }),
});

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

Return ONLY a JSON object (no markdown fence) with this exact shape:
{
  "verdict_title": "short headline after 'Verdict:' — e.g. Love-it territory",
  "verdict_body": "2–4 sentences. Use **double asterisks** around the one or two key phrases the shopper must notice.",
  "annotations": ["4 short scan labels, ≤5 words each — what you're glancing at"],
  "whispers": ["4 rotating status lines while scanning — intimate, lowercase, can use **bold** sparingly"],
  "checks": {
    "fit": "pass|caution|fail",
    "palette": "pass|caution|fail",
    "nolist": "pass|caution|fail"
  }
}

Rules:
- Match the shopper's honesty preference exactly (gentle / straight / no-mercy).
- Be specific to THIS photo and THESE pieces — no generic praise.
- Honor hard no-list and taste vetoes; call out conflicts honestly.
- Palette check: against their known likes/palette signals when present.
- Fit check: what you can see in the photo (drape, length, shoulder, rise).
- Keep verdict_body under ~70 words.
- Never invent review counts or prices you weren't given.
- Language: English unless the shopper context clearly uses another.`;

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

Study the try-on photo and return the JSON verdict.`;

  try {
    const anthropic = getAnthropicClient();
    const msg = await anthropic.messages.create(
      {
        model: FASHION_CURATION_MODEL,
        max_tokens: 700,
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

    const parsed = parseLlmJsonObject(text);
    if (!parsed) {
      logAiChat("warn", "look_scan_parse_failed", {
        preview: text.slice(0, 200),
      });
      return null;
    }

    const validated = verdictSchema.safeParse(parsed);
    if (!validated.success) {
      logAiChat("warn", "look_scan_schema_failed", {
        issues: validated.error.issues.slice(0, 4),
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
