import { getProduct, searchCatalog } from "./catalog";

export type CatalogClientOverride = {
  searchCatalog?: typeof searchCatalog;
  getProduct?: typeof getProduct;
};

let override: CatalogClientOverride | null = null;

/** Test/E2E seam — swap catalog I/O without module mocking. */
export function setCatalogClientOverride(next: CatalogClientOverride | null): void {
  override = next;
}

export function getCatalogClientOverride(): CatalogClientOverride | null {
  return override;
}

export function resolveSearchCatalog(): typeof searchCatalog {
  return override?.searchCatalog ?? searchCatalog;
}

export function resolveGetProduct(): typeof getProduct {
  return override?.getProduct ?? getProduct;
}
