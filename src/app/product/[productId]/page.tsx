import type { Metadata } from "next";
import { ProductPageView } from "@/components/commerce/ProductPageView";
import { PageShell } from "@/components/layout/PageShell";
import { resolveProductBackHref } from "@/lib/shared/productNavigation";
import { createPageMetadata, DEFAULT_OG_IMAGE_PATH } from "@/lib/seo/site";
import type { SelectedOption } from "@/lib/shopify/catalog";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ title?: string; image?: string }>;
}): Promise<Metadata> {
  const { productId } = await params;
  const q = await searchParams;
  const productTitle = q.title?.trim() || "Product";
  const description = `See ${productTitle} on Shoop — variant details, curated fit notes, and a clear buy or wait verdict.`;

  return createPageMetadata({
    title: productTitle,
    description,
    path: `/product/${encodeURIComponent(productId)}`,
    noIndex: true,
    ogImagePath: q.image?.trim() ? q.image.trim() : DEFAULT_OG_IMAGE_PATH,
  });
}

/** Parse the `?opts=` query param emitted by chat-side product cards. */
function parsePreferredOptions(raw: string | undefined): SelectedOption[] {
  if (!raw) return [];
  try {
    const decoded = JSON.parse(raw) as unknown;
    if (!Array.isArray(decoded)) return [];
    const out: SelectedOption[] = [];
    for (const entry of decoded) {
      if (!entry || typeof entry !== "object") continue;
      const o = entry as Record<string, unknown>;
      if (typeof o.name === "string" && typeof o.label === "string") {
        out.push({ name: o.name, label: o.label });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{
    title?: string;
    image?: string;
    from?: string;
    opts?: string;
    priceMin?: string;
    priceMax?: string;
    currency?: string;
    variantId?: string;
  }>;
}) {
  const { productId } = await params;
  const q = await searchParams;
  const decodedId = decodeURIComponent(productId);
  const backHref = resolveProductBackHref(q.from);
  const prefilledOptions = parsePreferredOptions(q.opts);
  const priceMinCents = parsePriceCents(q.priceMin);
  const priceMaxCents = parsePriceCents(q.priceMax);
  const currency = q.currency?.trim() || undefined;
  const chatPriceRange =
    priceMinCents != null && currency
      ? {
          min: { amount: priceMinCents, currency },
          max: {
            amount: priceMaxCents ?? priceMinCents,
            currency,
          },
        }
      : undefined;
  const featuredVariantId = q.variantId?.trim()
    ? decodeURIComponent(q.variantId.trim())
    : undefined;

  return (
    <PageShell>
      <ProductPageView
        productId={decodedId}
        featuredVariantId={featuredVariantId}
        fallbackTitle={q.title}
        fallbackImageUrl={q.image}
        backHref={backHref}
        prefilledOptions={prefilledOptions}
        chatPriceRange={chatPriceRange}
      />
    </PageShell>
  );
}

function parsePriceCents(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}
