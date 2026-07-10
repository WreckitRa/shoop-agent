import type {
  MemoryObservationSignalType,
  MemoryObservationSource,
  ShoppingMemoryScope,
  ShoppingMemoryType,
} from "../prisma-types";

const SIGNAL_MAP: Record<string, MemoryObservationSignalType> = {
  profile: "profile",
  size: "size",
  fit: "fit",
  fit_dislike: "fit",
  fit_like: "fit",
  style_like: "style_like",
  style_dislike: "style_dislike",
  color_like: "style_like",
  color_dislike: "style_dislike",
  product_type_like: "style_like",
  product_type_dislike: "style_dislike",
  brand_like: "brand_like",
  brand_dislike: "brand_dislike",
  budget: "budget",
  product_owned: "product_owned",
  product_feedback: "product_feedback",
  purchase: "purchase",
  return: "product_return",
  product_return: "product_return",
  wishlist: "wishlist",
  gift_recipient: "gift_recipient",
  shipping: "shipping",
  occasion: "occasion",
  constraint: "constraint",
  hard_negative: "hard_negative",
};

const SOURCE_MAP: Record<string, MemoryObservationSource> = {
  explicit: "explicit",
  inferred: "inferred",
  behavioral: "behavioral",
  purchase: "purchase",
  return: "product_return_source",
  product_return: "product_return_source",
};

const SCOPE_MAP: Record<string, ShoppingMemoryScope> = {
  global: "global",
  category: "category",
  brand: "brand",
  product_type: "product_type",
  recipient: "recipient",
  session: "session",
  temporary: "temporary",
};

export function mapObservationSignal(raw: string): MemoryObservationSignalType {
  const k = raw.trim().toLowerCase();
  return SIGNAL_MAP[k] ?? "constraint";
}

export function mapObservationSource(
  raw: string,
): MemoryObservationSource {
  const k = raw.trim().toLowerCase();
  return SOURCE_MAP[k] ?? "inferred";
}

export function mapMemoryScope(raw: string): ShoppingMemoryScope {
  const k = raw.trim().toLowerCase();
  return SCOPE_MAP[k] ?? "global";
}

export function memoryTypeFromSignal(
  signal: MemoryObservationSignalType,
): ShoppingMemoryType {
  switch (signal) {
    case "profile":
      return "profile";
    case "size":
      return "size";
    case "fit":
      return "fit";
    case "style_like":
    case "wishlist":
      return "preference";
    case "style_dislike":
    case "hard_negative":
      return "dislike";
    case "brand_like":
    case "brand_dislike":
      return "brand";
    case "budget":
      return "budget";
    case "shipping":
    case "occasion":
    case "constraint":
      return "constraint";
    case "product_owned":
      return "owned_product";
    case "gift_recipient":
      return "recipient";
    case "purchase":
    case "product_return":
    case "product_feedback":
      return "preference";
    default:
      return "preference";
  }
}
