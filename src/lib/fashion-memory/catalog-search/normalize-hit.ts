import {
  parseCatalogRating,
  type CatalogMediaItem,
  type CatalogProductSummary,
  type CatalogVariantSummary,
} from "@/lib/shopify/catalog";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import { preNormalize } from "../normalize/pre-normalize";
import type { FashionSlotCatalogProduct } from "./types";

export type FashionCatalogVariantOption = {
  name: string;
  value: string;
};

function mediaUrl(item: CatalogMediaItem | string | undefined): string | undefined {
  if (!item) return undefined;
  if (typeof item === "string") return item.trim() || undefined;
  return (
    item.url?.trim() ||
    item.src?.trim() ||
    item.href?.trim() ||
    item.preview?.url?.trim() ||
    item.preview?.src?.trim() ||
    undefined
  );
}

function collectImageUrls(product: CatalogProductSummary): string[] {
  const urls = new Set<string>();
  for (const item of product.media ?? []) {
    const url = mediaUrl(item);
    if (url) urls.add(url);
  }
  const featured = mediaUrl(product.featured_image);
  if (featured) urls.add(featured);
  const image = mediaUrl(product.image);
  if (image) urls.add(image);
  for (const variant of product.variants ?? []) {
    const vFeatured = mediaUrl(variant.featured_image);
    if (vFeatured) urls.add(vFeatured);
    const vImage = mediaUrl(variant.image);
    if (vImage) urls.add(vImage);
    for (const item of variant.media ?? []) {
      const url = mediaUrl(item);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

function collectVariantOptions(product: CatalogProductSummary): FashionCatalogVariantOption[] {
  const out: FashionCatalogVariantOption[] = [];
  for (const option of product.options ?? []) {
    for (const value of option.values ?? []) {
      const label = value.label?.trim();
      if (!label) continue;
      out.push({ name: option.name, value: label });
    }
  }
  for (const variant of product.variants ?? []) {
    for (const option of variant.options ?? []) {
      const label = option.label?.trim();
      if (!label) continue;
      out.push({ name: option.name, value: label });
    }
  }
  return out;
}

function primaryVariant(product: CatalogProductSummary): CatalogVariantSummary | undefined {
  return (
    product.variants?.find((v) => v.checkout_url) ??
    product.variants?.[0]
  );
}

function readCompareAtPrice(variant: CatalogVariantSummary | undefined): {
  amount: number;
  currency: string;
} | undefined {
  if (!variant) return undefined;
  const raw = variant as CatalogVariantSummary & {
    compare_at_price?: { amount: number; currency: string };
    compareAtPrice?: { amount: number; currency: string };
  };
  const compare = raw.compare_at_price ?? raw.compareAtPrice;
  if (!compare?.amount || !compare.currency) return undefined;
  return { amount: compare.amount, currency: compare.currency };
}

function readNativeCheckout(product: CatalogProductSummary): boolean | undefined {
  const raw = product as CatalogProductSummary & {
    eligible?: { native_checkout?: boolean };
    url?: string;
  };
  if (typeof raw.eligible?.native_checkout === "boolean") {
    return raw.eligible.native_checkout;
  }
  return undefined;
}

function readProductUrl(product: CatalogProductSummary): string | undefined {
  const raw = product as CatalogProductSummary & { url?: string };
  if (raw.url?.trim()) return raw.url.trim();
  const variant = primaryVariant(product);
  return variant?.checkout_url?.trim() || undefined;
}

function readMerchant(product: CatalogProductSummary): {
  merchant_id?: string;
  shop_domain?: string;
} {
  const raw = product as CatalogProductSummary & {
    seller?: { name?: string; domain?: string; id?: string };
    shop?: { id?: string; domain?: string; name?: string };
    brand?: string;
  };
  const seller = raw.seller ?? raw.shop;
  const url = readProductUrl(product);
  let shop_domain = seller?.domain?.trim();
  if (!shop_domain && url) {
    try {
      shop_domain = new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      /* ignore */
    }
  }
  return {
    merchant_id: seller?.id?.trim() || seller?.name?.trim() || raw.brand?.trim(),
    shop_domain,
  };
}

function readTaxonomyCategory(product: CatalogProductSummary): string | undefined {
  const raw = product as CatalogProductSummary & {
    taxonomy_category?: string;
    category?: string;
    product_type?: string;
    metadata?: { taxonomy_category?: string; category?: string };
  };
  return (
    raw.taxonomy_category?.trim() ||
    raw.category?.trim() ||
    raw.product_type?.trim() ||
    raw.metadata?.taxonomy_category?.trim() ||
    raw.metadata?.category?.trim() ||
    undefined
  );
}

export function normalizeCatalogHit(params: {
  raw: CatalogProductSummary;
  upid: string;
  matched_by: number[];
  matched_by_color_variant: boolean;
  matched_by_lanes?: import("./category-hedge").CatalogLane[];
}): FashionSlotCatalogProduct {
  const variant = primaryVariant(params.raw);
  const rating = parseCatalogRating(params.raw.rating);
  const merchant = readMerchant(params.raw);
  const price = variant?.price ?? params.raw.price_range?.min;

  return {
    id: params.raw.id,
    upid: params.upid,
    matched_by: params.matched_by,
    matched_by_color_variant: params.matched_by_color_variant,
    matched_by_lanes: params.matched_by_lanes,
    title: params.raw.title,
    variant_options: collectVariantOptions(params.raw),
    price,
    compare_at_price: readCompareAtPrice(variant),
    rating_value: rating?.value,
    rating_scale_max: rating?.scaleMax,
    review_count: rating?.count,
    merchant_id: merchant.merchant_id,
    shop_domain: merchant.shop_domain,
    native_checkout: readNativeCheckout(params.raw),
    product_url: readProductUrl(params.raw),
    image_urls: collectImageUrls(params.raw),
    taxonomy_category: readTaxonomyCategory(params.raw),
    raw: params.raw,
  };
}

export type CatalogFieldCoverage = {
  products: number;
  with_rating: number;
  with_review_count: number;
  with_variant_options: number;
  with_price: number;
  with_compare_at: number;
  with_merchant: number;
  with_native_checkout: number;
  with_product_url: number;
  with_images: number;
  with_taxonomy: number;
  with_target_gender_attr: number;
  matched_by_color_variant: number;
};

function productHasTargetGenderAttr(product: FashionSlotCatalogProduct): boolean {
  return extractCatalogAttributes(product.raw).some((a) => {
    const name = preNormalize(a.name);
    return (
      name === "target gender" ||
      name === "gender" ||
      name === "targetgender"
    );
  });
}

export function summarizeCatalogFieldCoverage(
  products: FashionSlotCatalogProduct[],
): CatalogFieldCoverage {
  const coverage: CatalogFieldCoverage = {
    products: products.length,
    with_rating: 0,
    with_review_count: 0,
    with_variant_options: 0,
    with_price: 0,
    with_compare_at: 0,
    with_merchant: 0,
    with_native_checkout: 0,
    with_product_url: 0,
    with_images: 0,
    with_taxonomy: 0,
    with_target_gender_attr: 0,
    matched_by_color_variant: 0,
  };

  for (const product of products) {
    if (product.rating_value != null) coverage.with_rating += 1;
    if (product.review_count != null && product.review_count > 0) {
      coverage.with_review_count += 1;
    }
    if (product.variant_options.length > 0) coverage.with_variant_options += 1;
    if (product.price?.amount != null) coverage.with_price += 1;
    if (product.compare_at_price?.amount != null) coverage.with_compare_at += 1;
    if (product.merchant_id || product.shop_domain) coverage.with_merchant += 1;
    if (product.native_checkout != null) coverage.with_native_checkout += 1;
    if (product.product_url) coverage.with_product_url += 1;
    if (product.image_urls.length > 0) coverage.with_images += 1;
    if (product.taxonomy_category) coverage.with_taxonomy += 1;
    if (productHasTargetGenderAttr(product)) coverage.with_target_gender_attr += 1;
    if (product.matched_by_color_variant) coverage.matched_by_color_variant += 1;
  }

  return coverage;
}
