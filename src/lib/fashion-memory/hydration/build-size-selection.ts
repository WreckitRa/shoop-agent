import type { SelectedOption } from "@/lib/shopify/catalog";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import { garmentToSizeBucket } from "../intake/garment-size-fields";
import {
  classifyOptionName,
  garmentToSizeCategory,
} from "../normalize/option-classifier";
import { sizeCorresponds } from "../hard-drops/size-match";
import type { FashionFactSizeValue } from "../types";
import type { FashionSearchBrief } from "../router/types";
import {
  isAmbiguousDressNumericMapping,
  normalizedSizeMatchesField,
  tryUnambiguousSizeConversion,
} from "./size-conversion";
import type { SizeSelectionBuild } from "./types";

function findSizeOptionName(
  product: FashionSlotCatalogProduct,
  garment: string,
): string {
  const category = garmentToSizeCategory(garment);
  for (const opt of product.variant_options) {
    if (classifyOptionName(opt.name) === "size") return opt.name;
  }
  for (const opt of product.variant_options) {
    const byValue = classifyOptionName(opt.value);
    if (byValue === "size") return opt.name;
  }
  void category;
  return "Size";
}

function pickRawLabelForRecipientSize(params: {
  product: FashionSlotCatalogProduct;
  recipient: FashionFactSizeValue;
  department: FashionSearchBrief["knowledge_state"] extends infer K
    ? K extends { department: infer D }
      ? D
      : "mens" | "womens" | "mixed"
    : "mens" | "womens" | "mixed";
  garment: string;
  optionName: string;
}): SizeSelectionBuild {
  const sizes = params.product.normalized?.sizes ?? [];
  const category = garmentToSizeBucket(params.garment) ?? "tops";
  const department =
    params.department === "mens" || params.department === "womens"
      ? params.department
      : "mixed";

  for (const field of sizes) {
    if (field.status !== "resolved" || !field.size) continue;
    if (sizeCorresponds(field.size, params.recipient) === "exact") {
      return {
        selected: [{ name: params.optionName, label: field.raw }],
        hadSizeSelection: true,
      };
    }
  }

  if (isAmbiguousDressNumericMapping(department, category)) {
    return { selected: [], hadSizeSelection: false };
  }

  const conversion = tryUnambiguousSizeConversion({
    recipient: params.recipient,
    department,
    category,
  });
  if (conversion) {
    for (const field of sizes) {
      if (field.status !== "resolved") continue;
      if (normalizedSizeMatchesField(conversion.target, field)) {
        return {
          selected: [{ name: params.optionName, label: field.raw }],
          hadSizeSelection: true,
          convertedFrom: conversion.convertedFrom,
        };
      }
    }
  }

  return { selected: [], hadSizeSelection: false };
}

/** Build the pointed size question for get_product from normalization annotations. */
export function buildSizeSelection(params: {
  product: FashionSlotCatalogProduct;
  garment: string;
  brief: FashionSearchBrief;
  recipientSize: FashionFactSizeValue | null;
}): SizeSelectionBuild {
  if (!params.recipientSize) {
    return { selected: [], hadSizeSelection: false };
  }

  const optionName = findSizeOptionName(params.product, params.garment);
  const department = params.brief.knowledge_state?.department ?? "mens";

  return pickRawLabelForRecipientSize({
    product: params.product,
    recipient: params.recipientSize,
    department,
    garment: params.garment,
    optionName,
  });
}

export function relaxationOrder(selected: SelectedOption[]): string[] {
  const sizeish = (n: string) => /size|fit|waist|inseam|length|ring/i.test(n);
  const sized = selected.filter((o) => sizeish(o.name)).map((o) => o.name);
  const rest = selected.filter((o) => !sizeish(o.name)).map((o) => o.name);
  return [...rest, ...sized];
}

function labelsEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Whether get_product relaxed away our size selection (fallback). */
export function isSizeSelectionFallback(
  requested: SelectedOption[],
  effective: SelectedOption[] | undefined,
): boolean {
  const sizeReq = requested.find((o) => /size/i.test(o.name));
  if (!sizeReq) return false;
  const eff = effective?.find((o) => labelsEqual(o.name, sizeReq.name));
  if (!eff) return true;
  return !labelsEqual(eff.label, sizeReq.label);
}

/** Selected variant size value availability from option matrix. */
export function sizeOptionAvailability(
  detail: import("@/lib/shopify/catalog").CatalogProductDetail,
  sizeSelection: SelectedOption,
): { available: boolean | null; exists: boolean | null } {
  const opt = detail.options?.find((o) => labelsEqual(o.name, sizeSelection.name));
  const value = opt?.values.find((v) => labelsEqual(v.label, sizeSelection.label));
  return {
    available: value?.available ?? null,
    exists: value?.exists ?? null,
  };
}

/** True when no offered size corresponds to the recipient. */
export function recipientExcludedByOfferedSizes(params: {
  product: FashionSlotCatalogProduct;
  recipient: FashionFactSizeValue;
  offeredLabels: string[];
}): boolean {
  const offered = new Set(params.offeredLabels.map((l) => l.trim().toLowerCase()));
  const sizes = params.product.normalized?.sizes ?? [];
  const resolved = sizes.filter((s) => s.status === "resolved" && s.size);
  if (!resolved.length) return false;

  for (const field of resolved) {
    if (offered.size > 0 && !offered.has(field.raw.trim().toLowerCase())) {
      continue;
    }
    const corr = sizeCorresponds(field.size!, params.recipient);
    if (corr === "exact" || corr === "possible") return false;
  }
  return true;
}

/** Any unresolved size labels on the product. */
export function hasPartiallyUnknownSizes(
  product: FashionSlotCatalogProduct,
): boolean {
  const sizes = product.normalized?.sizes ?? [];
  return sizes.some((s) => s.status === "unknown");
}
