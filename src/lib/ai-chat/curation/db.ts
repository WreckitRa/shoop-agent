import { prisma } from "../db";
import type { CurationSlot, CurationVerdict } from "../types";

/** Row shape returned by `productCuration.findUnique` etc. */
export type ProductCurationRow = {
  id: string;
  userId: string;
  productExternalId: string;
  slot: CurationSlot;
  reason: string;
  verdict: CurationVerdict;
  retailerCheckNote: string | null;
  fitReasons: string[];
  checkedItems: string[];
  pickStory: string | null;
  changeMindItems: string[];
  conversationId: string | null;
  messageId: string | null;
  searchQuery: string | null;
  productTitle: string | null;
  productImageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Typed delegate for `prisma.productCuration`. We bind to the proxy explicitly
 * because the generated Prisma client may lag the schema in dev (the
 * `ProductCuration` model was added without a migration run yet). Mirror of
 * `owned-product-db.ts`.
 */
export type ProductCurationDelegate = {
  findUnique: (args: object) => Promise<ProductCurationRow | null>;
  findFirst: (args: object) => Promise<ProductCurationRow | null>;
  findMany: (args: object) => Promise<ProductCurationRow[]>;
  upsert: (args: object) => Promise<ProductCurationRow>;
  update: (args: object) => Promise<ProductCurationRow>;
  delete: (args: object) => Promise<ProductCurationRow>;
};

const MISSING_DELEGATE_MESSAGE =
  "Prisma productCuration delegate is unavailable. Run `npm run db:generate` and restart `npm run dev`.";

function delegate(): ProductCurationDelegate | null {
  const d = (prisma as unknown as { productCuration?: unknown })
    .productCuration;
  if (!d || (typeof d !== "object" && typeof d !== "function")) return null;
  return d as ProductCurationDelegate;
}

function fallbackRead(prop: string | symbol) {
  if (prop === "findMany") return async () => [];
  if (prop === "findFirst" || prop === "findUnique") return async () => null;
  return undefined;
}

function missingDelegateMutation() {
  throw new Error(MISSING_DELEGATE_MESSAGE);
}

export const productCuration: ProductCurationDelegate = new Proxy(
  {} as ProductCurationDelegate,
  {
    get(_target, prop: string | symbol) {
      const d = delegate();
      if (!d) {
        const readFallback = fallbackRead(prop);
        if (readFallback) return readFallback;
        return missingDelegateMutation;
      }
      const value = Reflect.get(d, prop);
      if (typeof value === "function") {
        return (value as (...args: unknown[]) => unknown).bind(d);
      }
      return value;
    },
  },
);
