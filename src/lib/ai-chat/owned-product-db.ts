import { prisma } from "./db";

/** Row shape returned by `ownedProduct.findMany` / profile APIs. */
export type OwnedProductRow = {
  id?: string;
  category: string;
  subcategory: string;
  brand: string;
  productName: string;
  model: string;
  attributes: unknown;
  isCurrent: boolean;
  acquiredAt: Date | null;
  acquiredNote: string | null;
  notes: string | null;
};

/**
 * OwnedProduct Prisma delegate. Typed explicitly because IDE/tsserver can lag
 * behind `prisma generate` and not yet list `ownedProduct` on `PrismaClient`.
 */
export type OwnedProductDelegate = {
  findMany: (args: object) => Promise<OwnedProductRow[]>;
  findFirst: (args: object) => Promise<OwnedProductRow | null>;
  findUnique: (args: object) => Promise<OwnedProductRow | null>;
  create: (args: object) => Promise<OwnedProductRow>;
  update: (args: object) => Promise<OwnedProductRow>;
  updateMany: (args: object) => Promise<unknown>;
  delete: (args: object) => Promise<OwnedProductRow>;
  upsert: (args: object) => Promise<OwnedProductRow>;
};

const MISSING_DELEGATE_MESSAGE =
  "Prisma ownedProduct delegate is unavailable. Run `npx prisma generate` and restart `npm run dev`.";

function delegate(): OwnedProductDelegate | null {
  const d = (prisma as unknown as { ownedProduct?: unknown }).ownedProduct;
  if (!d || (typeof d !== "object" && typeof d !== "function")) return null;
  return d as OwnedProductDelegate;
}

function fallbackRead(prop: string | symbol) {
  if (prop === "findMany") return async () => [];
  if (prop === "findFirst" || prop === "findUnique") return async () => null;
  return undefined;
}

function missingDelegateMutation() {
  throw new Error(MISSING_DELEGATE_MESSAGE);
}

/** Lazy proxy mirroring `prisma.ownedProduct` with stable typings. */
export const ownedProduct: OwnedProductDelegate = new Proxy(
  {} as OwnedProductDelegate,
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
