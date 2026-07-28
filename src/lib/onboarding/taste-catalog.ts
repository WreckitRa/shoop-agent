import {
  extractCatalogImageUrl,
  searchCatalog,
  type CatalogProductSummary,
  type CatalogSearchContext,
  type CatalogSearchFilters,
} from "@/lib/shopify/catalog";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import {
  TASTE_CATEGORY_LABELS,
  type TasteCardCategory,
} from "@/lib/onboarding/taste-cards";

export type TasteDeckContext = {
  styleLikes?: string;
  styleAvoids?: string;
  brandLikes?: string;
  brandAvoids?: string;
  genderPresentation?: string;
  valuePhilosophy?: string;
  shippingCountry?: string;
  currency?: string;
  topSize?: string;
};

export type TasteCatalogCard = {
  /** Catalog product id (UPID / GID). */
  id: string;
  productId: string;
  category: TasteCardCategory;
  categoryLabel: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  tasteTags: string[];
  searchQuery: string;
};

type SearchSlot = {
  query: string;
  intent: string;
  tasteTags: string[];
};

const COUNTRY_CODES: Record<string, string> = {
  lebanon: "LB",
  "united states": "US",
  usa: "US",
  "united kingdom": "GB",
  uk: "GB",
  france: "FR",
  germany: "DE",
  canada: "CA",
  australia: "AU",
  uae: "AE",
  "united arab emirates": "AE",
};

function guessCountryCode(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return COUNTRY_CODES[t.toLowerCase()];
}

function audiencePhrase(gender?: string): string {
  switch (gender?.trim().toLowerCase()) {
    case "feminine":
      return "women's";
    case "masculine":
      return "men's";
    case "androgynous":
    case "nonbinary":
      return "gender-neutral";
    default:
      return "";
  }
}

function readSignals(ctx: TasteDeckContext) {
  const blob = [ctx.styleLikes, ctx.brandLikes, ctx.styleAvoids, ctx.brandAvoids]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const vpParts = (ctx.valuePhilosophy ?? "")
    .toLowerCase()
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const vpSet = new Set(vpParts);
  return {
    blob,
    sporty: /sport|athletic|nike|gym|sneaker|running|workout/.test(blob),
    minimal: /minimal|clean|modern|neutral|sleek|apple|simple/.test(blob),
    luxury:
      /luxury|premium|hermes|chanel|elegant|refined|designer|quiet/.test(blob) ||
      vpSet.has("premium") ||
      vpSet.has("luxury") ||
      vpSet.has("design_first"),
    cozy: /cozy|warm|comfort|soft|homey/.test(blob),
    techy: /tech|gadget|apple|dyson|smart|electronics/.test(blob),
    outdoor: /outdoor|hike|active|travel|adventure/.test(blob),
    deal: vpSet.has("deal_hunter") || /affordable|budget|value/.test(blob),
  };
}

function valueHint(signals: ReturnType<typeof readSignals>): string {
  if (signals.luxury) return "premium quality";
  if (signals.deal) return "best value affordable";
  return "well-made";
}

function buildSearchSlots(ctx: TasteDeckContext): Array<{
  category: TasteCardCategory;
  slots: SearchSlot[];
}> {
  const aud = audiencePhrase(ctx.genderPresentation);
  const sig = readSignals(ctx);
  const vh = valueHint(sig);
  const brands = ctx.brandLikes?.trim();
  const brandHint = brands ? `brands like ${brands}` : "";
  const sizeHint = ctx.topSize?.trim() ? `size ${ctx.topSize.trim()}` : "";
  const avoidHint = ctx.styleAvoids?.trim()
    ? `avoiding ${ctx.styleAvoids.slice(0, 120)}`
    : "";

  const outfitPrimary: SearchSlot = sig.sporty
    ? {
        query: `${aud} sporty streetwear sneakers athletic outfit ${vh} ${brandHint} ${sizeHint}`.trim(),
        intent: "onboarding taste — sporty outfit direction",
        tasteTags: ["sporty", "streetwear", "sneakers", "athletic"],
      }
    : sig.luxury
      ? {
          query: `${aud} quiet luxury tailored clothing premium fabrics ${brandHint} ${sizeHint}`.trim(),
          intent: "onboarding taste — elevated outfit direction",
          tasteTags: ["quiet-luxury", "tailored", "premium", "refined"],
        }
      : {
          query: `${aud} modern minimal everyday outfit neutral colors ${vh} ${brandHint} ${sizeHint}`.trim(),
          intent: "onboarding taste — minimal outfit direction",
          tasteTags: ["minimal", "modern", "neutral", "everyday"],
        };

  const outfitContrast: SearchSlot =
    sig.sporty && !sig.luxury
      ? {
          query: `${aud} smart casual polished blazer chinos elevated basics ${vh}`.trim(),
          intent: "onboarding taste — polished contrast outfit",
          tasteTags: ["smart-casual", "polished", "elevated-basics"],
        }
      : sig.luxury
        ? {
            query: `${aud} relaxed premium weekend outfit soft fabrics ${vh}`.trim(),
            intent: "onboarding taste — relaxed luxury outfit",
            tasteTags: ["relaxed", "premium-casual", "soft-fabrics"],
          }
        : {
            query: `${aud} casual comfortable weekend outfit layers ${vh}`.trim(),
            intent: "onboarding taste — casual contrast outfit",
            tasteTags: ["casual", "comfortable", "weekend"],
          };

  const furniturePrimary: SearchSlot = sig.minimal
    ? {
        query: `scandinavian minimal living room furniture light wood ${vh} ${avoidHint}`.trim(),
        intent: "onboarding taste — minimal home",
        tasteTags: ["scandinavian", "minimal", "light-wood"],
      }
    : sig.cozy
      ? {
          query: `cozy living room sofa textiles warm home furniture ${vh}`.trim(),
          intent: "onboarding taste — cozy home",
          tasteTags: ["cozy", "textiles", "warm-home"],
        }
      : {
          query: `modern living room furniture clean lines ${vh} ${avoidHint}`.trim(),
          intent: "onboarding taste — modern home",
          tasteTags: ["modern", "clean-lines", "living-room"],
        };

  const furnitureContrast: SearchSlot = sig.minimal
    ? {
        query: `mid-century accent chair walnut character home decor ${vh}`.trim(),
        intent: "onboarding taste — character home contrast",
        tasteTags: ["mid-century", "walnut", "character"],
      }
    : {
        query: `minimal desk organization home office storage ${vh}`.trim(),
        intent: "onboarding taste — organized home contrast",
        tasteTags: ["organized", "home-office", "storage"],
      };

  const techPrimary: SearchSlot = sig.techy || sig.minimal
    ? {
        query: `minimal desk setup monitor accessories clean workspace gadgets ${vh}`.trim(),
        intent: "onboarding taste — minimal tech",
        tasteTags: ["minimal-tech", "desk-setup", "clean-workspace"],
      }
    : {
        query: `premium everyday tech accessories quality design ${vh} ${brandHint}`.trim(),
        intent: "onboarding taste — premium tech",
        tasteTags: ["premium-tech", "quality-design", "everyday-tech"],
      };

  const techContrast: SearchSlot = sig.techy
    ? {
        query: `gaming desk setup rgb keyboard headphones performance gear`.trim(),
        intent: "onboarding taste — performance tech contrast",
        tasteTags: ["gaming-setup", "performance", "rgb"],
      }
    : {
        query: `smart home gadget useful kitchen tech ${vh}`.trim(),
        intent: "onboarding taste — practical tech contrast",
        tasteTags: ["smart-home", "practical", "useful-tech"],
      };

  const lifestylePrimary: SearchSlot = sig.outdoor
    ? {
        query: `outdoor active lifestyle gear hiking water bottle utility ${vh}`.trim(),
        intent: "onboarding taste — active lifestyle",
        tasteTags: ["outdoors", "active", "utility"],
      }
    : {
        query: `urban lifestyle coffee travel everyday carry ${vh} ${brandHint}`.trim(),
        intent: "onboarding taste — urban lifestyle",
        tasteTags: ["urban", "everyday-carry", "travel"],
      };

  const lifestyleContrast: SearchSlot = sig.luxury
    ? {
        query: `luxury lifestyle gift set candle fragrance home ${vh}`.trim(),
        intent: "onboarding taste — elevated lifestyle contrast",
        tasteTags: ["luxury-lifestyle", "fragrance", "gift-quality"],
      }
    : {
        query: `fitness wellness lifestyle accessories gym bottle ${vh}`.trim(),
        intent: "onboarding taste — wellness lifestyle contrast",
        tasteTags: ["wellness", "fitness", "self-care"],
      };

  const personalityPrimary: SearchSlot = sig.luxury
    ? {
        query: `${aud} understated luxury watch leather accessories ${vh}`.trim(),
        intent: "onboarding taste — quiet luxury personality",
        tasteTags: ["understated", "luxury-accessories", "refined"],
      }
    : sig.sporty
      ? {
          query: `${aud} sporty watch cap everyday accessories athletic vibe`.trim(),
          intent: "onboarding taste — sporty personality",
          tasteTags: ["sporty-accessories", "athletic-vibe", "casual"],
        }
      : {
          query: `${aud} minimal watch simple jewelry clean accessories ${vh}`.trim(),
          intent: "onboarding taste — minimal personality",
          tasteTags: ["minimal-accessories", "clean", "simple"],
        };

  const personalityContrast: SearchSlot = sig.minimal
    ? {
        query: `bold statement decor art colorful personality home accent`.trim(),
        intent: "onboarding taste — bold personality contrast",
        tasteTags: ["bold", "statement", "colorful"],
      }
    : {
        query: `warm social home entertaining decor candles hosting`.trim(),
        intent: "onboarding taste — warm personality contrast",
        tasteTags: ["warm", "social", "hosting"],
      };

  return [
    { category: "outfit", slots: [outfitPrimary, outfitContrast] },
    { category: "furniture", slots: [furniturePrimary, furnitureContrast] },
    { category: "tech", slots: [techPrimary, techContrast] },
    { category: "lifestyle", slots: [lifestylePrimary, lifestyleContrast] },
    { category: "personality", slots: [personalityPrimary, personalityContrast] },
  ];
}

function formatPrice(product: CatalogProductSummary): string {
  const r = product.price_range;
  if (!r) return "From catalog";
  const min = r.min.amount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: r.min.currency,
      maximumFractionDigits: min % 1 === 0 ? 0 : 2,
    }).format(min);
  } catch {
    return `${min.toFixed(0)} ${r.min.currency}`;
  }
}

function toCard(
  product: CatalogProductSummary,
  category: TasteCardCategory,
  slot: SearchSlot,
): TasteCatalogCard | null {
  const imageUrl = extractCatalogImageUrl(product);
  if (!imageUrl) return null;
  return {
    id: product.id,
    productId: product.id,
    category,
    categoryLabel: TASTE_CATEGORY_LABELS[category],
    title: product.title,
    subtitle: formatPrice(product),
    imageUrl,
    tasteTags: slot.tasteTags,
    searchQuery: slot.query,
  };
}

function catalogFilters(ctx: TasteDeckContext): CatalogSearchFilters {
  const filters: CatalogSearchFilters = { available: true };
  const country = guessCountryCode(ctx.shippingCountry);
  if (country) filters.ships_to = { country };
  return filters;
}

function catalogContext(ctx: TasteDeckContext): CatalogSearchContext | undefined {
  const country = guessCountryCode(ctx.shippingCountry);
  const ctxOut: CatalogSearchContext = {};
  if (country) ctxOut.address_country = country;
  if (ctx.currency?.trim()) {
    ctxOut.currency = ctx.currency.trim().toUpperCase().slice(0, 6);
  }
  return Object.keys(ctxOut).length ? ctxOut : undefined;
}

async function searchProductsForSlot(
  accessToken: string,
  slot: SearchSlot,
  filters: CatalogSearchFilters,
  context: CatalogSearchContext | undefined,
  signal: AbortSignal,
): Promise<CatalogProductSummary[]> {
  const run = async (query: string) => {
    const result = await searchCatalog(accessToken, query, filters, {
      context: { ...context, intent: slot.intent },
      limit: 10,
      signal,
    });
    return (result.products ?? []).filter((p) =>
      Boolean(extractCatalogImageUrl(p)),
    );
  };

  let products = await run(slot.query);
  if (products.length === 0 && !signal.aborted) {
    const short = slot.query.split(" ").slice(0, 8).join(" ");
    if (short !== slot.query) products = await run(short);
  }
  return products;
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<Array<R | null>> {
  const results: Array<R | null> = Array(values.length).fill(null);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        results[index] = await mapper(values[index]!);
      } catch {
        results[index] = null;
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );
  return results;
}

/** Build swipe deck from live Shopify catalog searches personalized to onboarding answers. */
export async function buildCatalogTasteDeck(
  ctx: TasteDeckContext,
  options: { signal?: AbortSignal; deadlineMs?: number } = {},
): Promise<TasteCatalogCard[]> {
  const accessToken = await accessTokenForCatalogMcp();
  const filters = catalogFilters(ctx);
  const context = catalogContext(ctx);
  const plans = buildSearchSlots(ctx);
  const seen = new Set<string>();
  const deck: TasteCatalogCard[] = [];
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error("taste_deck_deadline")),
    options.deadlineMs ?? 8_000,
  );

  try {
    for (const slotIndex of [0, 1]) {
      if (controller.signal.aborted) break;
      const wave = plans.map((plan) => ({
        category: plan.category,
        slot: plan.slots[slotIndex]!,
      }));
      const results = await mapWithConcurrency(wave, 3, ({ slot }) =>
        searchProductsForSlot(
          accessToken,
          slot,
          filters,
          context,
          controller.signal,
        ),
      );
      for (let index = 0; index < wave.length; index++) {
        const entry = wave[index]!;
        const product = results[index]?.find((candidate) => !seen.has(candidate.id));
        if (!product) continue;
        seen.add(product.id);
        const card = toCard(product, entry.category, entry.slot);
        if (card) deck.push(card);
      }
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }

  return deck;
}
