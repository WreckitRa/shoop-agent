import type {
  CatalogProductRating,
  CatalogProductSummary,
  CatalogVariantSummary,
  SelectedOption,
} from "@/lib/shopify/catalog";

export type MakeProductOverrides = Partial<CatalogProductSummary> & {
  priceUsd?: number;
  size?: string;
  color?: string;
  gender?: string;
  category?: string;
  shopName?: string;
  available?: boolean;
  variantId?: string;
};

const DEFAULT_SHOP = {
  name: "Test Menswear Co",
  domain: "test-mens.example",
};

/** Readable catalog factory — prices in minor units (cents). */
export function makeProduct(
  id: string,
  title: string,
  overrides: MakeProductOverrides = {},
): CatalogProductSummary {
  const priceUsd = overrides.priceUsd ?? 49.99;
  const amount = Math.round(priceUsd * 100);
  const currency = "USD";
  const size = overrides.size ?? "M";
  const color = overrides.color ?? "Navy";
  const variantId =
    overrides.variantId ?? `gid://shopify/ProductVariant/${id.replace(/\D/g, "") || "1"}`;

  const options: SelectedOption[] = [
    { name: "Size", label: size },
    { name: "Color", label: color },
  ];

  const variant: CatalogVariantSummary = {
    id: variantId,
    title: `${color} / ${size}`,
    price: { amount, currency },
    checkout_url: `https://checkout.shopify.com/${id}`,
    options,
    availability: {
      available: overrides.available !== false,
      status: overrides.available === false ? "out_of_stock" : "in_stock",
    },
  };

  const rating: CatalogProductRating | undefined =
    overrides.rating != null
      ? (overrides.rating as CatalogProductRating)
      : { value: 4.2, scaleMax: 5, count: 120 };

  const attrs = [];
  if (overrides.gender) attrs.push({ name: "Target gender", value: overrides.gender });
  if (overrides.color) attrs.push({ name: "Color", value: overrides.color });
  if (overrides.size) attrs.push({ name: "Size", value: overrides.size });

  return {
    id,
    title,
    options: [
      { name: "Size", values: [{ label: size }] },
      { name: "Color", values: [{ label: color }] },
    ],
    variants: [variant],
    price_range: {
      min: { amount, currency },
      max: { amount, currency },
    },
    media: [{ url: `https://cdn.example.com/${id}.jpg` }],
    rating,
    metadata: {
      attributes: attrs.length ? attrs : undefined,
      taxonomy_category: overrides.category,
    },
    ...overrides,
    seller: overrides.shopName
      ? { name: overrides.shopName, domain: `${overrides.shopName}.example` }
      : { name: DEFAULT_SHOP.name, domain: DEFAULT_SHOP.domain },
  };
}

/** Noise product for junk-fill scenarios (wrong department/category). */
export function makeNoiseProduct(
  id: string,
  title: string,
  overrides: MakeProductOverrides = {},
): CatalogProductSummary {
  return makeProduct(id, title, {
    priceUsd: 3.99,
    gender: "womens",
    category: "gid://shopify/TaxonomyCategory/aa-1-1-1",
    shopName: "Discount Bazaar",
    ...overrides,
  });
}
