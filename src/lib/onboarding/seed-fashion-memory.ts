/**
 * Project Prisma onboarding profile → fashion-memory (self person facts/signals).
 * Fashion search/hard-drops/curation read this store — not UserProfile directly.
 */
import { logAiChat } from "@/lib/ai-chat/observability";
import { isSupabaseAuthUserId } from "@/lib/fashion-memory/auth";
import { upsertFashionFact } from "@/lib/fashion-memory/facts";
import { genderFromUserProfile } from "@/lib/fashion-memory/intake/account-profile-bridge";
import { parseSizeValue } from "@/lib/fashion-memory/intake/parse-size-value";
import { ensureSelfPerson, updatePersonName } from "@/lib/fashion-memory/people";
import { upsertStyleSignal } from "@/lib/fashion-memory/signals";
import type {
  FashionFactNoGoKind,
  FashionFactSizeValue,
  StyleSignalType,
} from "@/lib/fashion-memory/types";
import type { PersonDepartment } from "@/lib/fashion-memory/department";
import {
  loadOnboardingProjectionSnapshot,
  type OnboardingProjectionSnapshot,
} from "@/lib/onboarding/projection-snapshot";

const MATERIAL_NO_GOS = new Set([
  "leather",
  "wool",
  "fur",
  "nickel",
  "silk",
  "cashmere",
  "suede",
  "polyester",
  "synthetic fragrances",
  "animal products",
]);

const COLOR_SIGNAL = new Set([
  "black",
  "white",
  "navy",
  "beige",
  "brown",
  "grey",
  "gray",
  "green",
  "blue",
  "red",
  "neutral tones",
  "bold colors",
  "neutral",
]);

const MATERIAL_SIGNAL = new Set([
  "leather",
  "wool",
  "linen",
  "cotton",
  "silk",
  "cashmere",
  "denim",
  "soft-fabrics",
]);

export type OnboardingSizeSeed = {
  topUsualSize?: string | null;
  bottomUsualSize?: string | null;
  bottomWaist?: string | null;
  bottomInseam?: string | null;
  shoeEU?: number | null;
  shoeUS?: number | null;
  shoeUK?: number | null;
};

/** Exported for tests — map onboarding gender → fashion department. */
export function mapOnboardingGender(
  raw: string | null | undefined,
): PersonDepartment | null {
  const t = raw?.trim().toLowerCase() ?? "";
  if (!t) return null;
  if (t === "androgynous" || t === "prefer not to say") return "mixed";
  return genderFromUserProfile(raw);
}

/** Exported for tests. */
export function sizeSeedsFromSizing(
  sizing: OnboardingSizeSeed | null | undefined,
): Array<{ bucket: "tops" | "bottoms" | "shoes"; value: FashionFactSizeValue; quote: string }> {
  if (!sizing) return [];
  const out: Array<{
    bucket: "tops" | "bottoms" | "shoes";
    value: FashionFactSizeValue;
    quote: string;
  }> = [];

  if (sizing.topUsualSize?.trim()) {
    const quote = sizing.topUsualSize.trim();
    out.push({ bucket: "tops", value: parseSizeValue(quote), quote });
  }

  if (sizing.bottomUsualSize?.trim()) {
    const quote = sizing.bottomUsualSize.trim();
    out.push({ bucket: "bottoms", value: parseSizeValue(quote), quote });
  } else if (sizing.bottomWaist?.trim()) {
    const waist = sizing.bottomWaist.trim();
    const inseam = sizing.bottomInseam?.trim();
    const quote = inseam ? `${waist}x${inseam}` : waist;
    out.push({ bucket: "bottoms", value: parseSizeValue(quote), quote });
  }

  if (sizing.shoeEU != null) {
    out.push({
      bucket: "shoes",
      value: { system: "eu", value: sizing.shoeEU },
      quote: `EU${sizing.shoeEU}`,
    });
  } else if (sizing.shoeUS != null) {
    out.push({
      bucket: "shoes",
      value: { system: "us", value: sizing.shoeUS },
      quote: `US${sizing.shoeUS}`,
    });
  } else if (sizing.shoeUK != null) {
    out.push({
      bucket: "shoes",
      value: { system: "uk", value: sizing.shoeUK },
      quote: `UK${sizing.shoeUK}`,
    });
  }

  return out;
}

/** Exported for tests. */
export function classifyHardAvoid(
  raw: string,
): { kind: FashionFactNoGoKind; value: string } | null {
  const value = raw.trim().toLowerCase();
  if (!value || value.length > 80) return null;
  if (MATERIAL_NO_GOS.has(value) || /\b(leather|wool|fur|silk|polyester)\b/.test(value)) {
    return { kind: "material", value };
  }
  if (/\b(red|blue|green|yellow|pink|orange|purple|white|black|navy)\b/.test(value)) {
    return { kind: "color", value };
  }
  if (/\b(shorts|skirt|dress|heels?|sandals?|tie|suit)\b/.test(value)) {
    return { kind: "garment", value };
  }
  return { kind: "style", value };
}

function classifyTasteSignalType(tag: string): StyleSignalType {
  const t = tag.trim().toLowerCase();
  if (COLOR_SIGNAL.has(t) || /\b(tones?|colors?)\b/.test(t)) return "color";
  if (MATERIAL_SIGNAL.has(t)) return "material";
  if (/\b(slim|relaxed|oversized|tailored|boxy)\b/.test(t)) return "silhouette";
  return "style";
}

function shouldSeedTasteCategory(category: string | null | undefined): boolean {
  if (!category?.trim()) return true;
  const c = category.trim().toLowerCase();
  // Fashion funnel only — drop home/tech/lifestyle noise from swipe deck.
  return c === "fashion" || c === "outfit" || c === "style" || c === "personality";
}

function noGoGarmentKey(kind: FashionFactNoGoKind, value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `nogo-${kind}-${slug || "x"}`;
}

/**
 * Idempotent projection of onboarding Prisma tables into fashion_facts + style_signals
 * for the self person. Safe to call on complete and on first fashion turn.
 */
export async function seedOnboardingIntoFashionMemory(
  userId: string,
  suppliedSnapshot?: OnboardingProjectionSnapshot,
): Promise<{ ok: boolean; seeded: boolean; reason?: string }> {
  if (!isSupabaseAuthUserId(userId)) {
    return { ok: false, seeded: false, reason: "not_auth_user" };
  }

  try {
    const snapshot =
      suppliedSnapshot ?? (await loadOnboardingProjectionSnapshot(userId));
    const {
      profile,
      sizing,
      brandPreferences: brands,
      hardNegatives,
      tasteTags,
    } = snapshot;

    if (!profile) {
      return { ok: true, seeded: false, reason: "no_profile" };
    }

    const person = await ensureSelfPerson(userId);

    if (profile.preferredName?.trim()) {
      await updatePersonName({
        userId,
        personId: person.id,
        name: profile.preferredName.trim(),
      }).catch(() => null);
    }

    const presentation = mapOnboardingGender(profile.genderPresentation);
    const writes: Promise<unknown>[] = [];
    if (presentation) {
      writes.push(upsertFashionFact({
        userId,
        personId: person.id,
        factType: "gender_presentation",
        garmentType: null,
        value: { presentation },
        sourceQuote: `onboarding:${profile.genderPresentation}`,
      }));
    }

    for (const size of sizeSeedsFromSizing(sizing)) {
      writes.push(upsertFashionFact({
        userId,
        personId: person.id,
        factType: "size",
        garmentType: size.bucket,
        value: size.value,
        sourceQuote: `onboarding:${size.quote}`,
      }));
    }

    if (profile.ageRange?.trim() || profile.valuePhilosophy?.trim()) {
      writes.push(upsertFashionFact({
        userId,
        personId: person.id,
        factType: "body_note",
        garmentType: "onboarding-meta",
        value: {
          ...(profile.ageRange?.trim()
            ? { age_range: profile.ageRange.trim() }
            : {}),
          ...(profile.valuePhilosophy?.trim()
            ? { value_philosophy: profile.valuePhilosophy.trim() }
            : {}),
        },
        sourceQuote: "onboarding:profile-meta",
      }));
    }

    for (const h of hardNegatives) {
      const classified = classifyHardAvoid(h.value);
      if (!classified) continue;
      writes.push(upsertFashionFact({
        userId,
        personId: person.id,
        factType: "no_go",
        garmentType: noGoGarmentKey(classified.kind, classified.value),
        value: classified,
        sourceQuote: `onboarding:hard_negative:${h.value}`,
      }));
    }

    for (const b of brands) {
      const brand = b.brand.trim();
      if (!brand) continue;
      const avoid =
        b.sentiment === "avoid" ||
        b.sentiment === "hate";
      writes.push(upsertStyleSignal({
        userId,
        personId: person.id,
        context: "general",
        signalType: "brand",
        value: brand,
        polarity: avoid ? -1 : 1,
        source: "stated",
        confidence: 0.85,
        sourceQuote: `onboarding:brand:${b.sentiment}`,
        incrementEvidence: false,
      }));
    }

    for (const t of tasteTags) {
      if (!shouldSeedTasteCategory(t.category)) continue;
      const tag = t.tag.trim();
      if (!tag) continue;
      writes.push(upsertStyleSignal({
        userId,
        personId: person.id,
        context: "general",
        signalType: classifyTasteSignalType(tag),
        value: tag,
        polarity: t.polarity === "negative" ? -1 : 1,
        source: "stated",
        confidence: Math.min(0.9, Math.max(0.6, t.score ?? 0.75)),
        sourceQuote: `onboarding:taste:${t.category ?? "general"}`,
        incrementEvidence: false,
      }));
    }

    // Soft aesthetic from budget philosophy — never invent a numeric budget_band.
    if (profile.valuePhilosophy?.trim()) {
      const vp = profile.valuePhilosophy.trim().toLowerCase();
      const aesthetic =
        vp === "luxury"
          ? "quiet luxury"
          : vp === "premium"
            ? "quality first"
            : vp === "best_value" || vp === "deal_hunter"
              ? "value conscious"
              : vp === "design_first"
                ? "design led"
                : null;
      if (aesthetic) {
        writes.push(upsertStyleSignal({
          userId,
          personId: person.id,
          context: "general",
          signalType: "aesthetic",
          value: aesthetic,
          polarity: 1,
          source: "inferred",
          confidence: 0.55,
          sourceQuote: `onboarding:valuePhilosophy:${vp}`,
          incrementEvidence: false,
        }));
      }
    }

    await Promise.all(writes);

    logAiChat("info", "onboarding_seeded_fashion_memory", {
      userId,
      personId: person.id,
      gender: presentation,
      sizes: sizeSeedsFromSizing(sizing).map((s) => s.bucket),
      brands: brands.length,
      hardNegatives: hardNegatives.length,
      tasteTags: tasteTags.length,
    });

    return { ok: true, seeded: true };
  } catch (error) {
    logAiChat("error", "onboarding_seed_fashion_memory_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      seeded: false,
      reason: error instanceof Error ? error.message : "seed_failed",
    };
  }
}
