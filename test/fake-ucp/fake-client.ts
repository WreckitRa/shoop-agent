import type {
  CatalogProductDetail,
  CatalogProductSummary,
  CatalogSearchFilters,
  CatalogSearchResult,
  GetProductResult,
  SelectedOption,
} from "@/lib/shopify/catalog";
import type { FakeUcpCatalogConfig, FakeUcpMutation, FakeUcpRuntime } from "./types";


function productMatchesFilters(
  product: CatalogProductSummary,
  filters: CatalogSearchFilters | undefined,
  priceMode: "honor" | "soft",
): boolean {
  if (!filters) return true;

  if (filters.price?.max != null && priceMode === "honor") {
    const amount =
      product.variants?.[0]?.price?.amount ??
      product.price_range?.min.amount ??
      0;
    if (amount > filters.price.max) return false;
  }

  if (filters.available === true) {
    const v = product.variants?.[0];
    if (v?.availability?.available === false) return false;
  }

  if (filters.categories?.length) {
    const cat = product.metadata?.taxonomy_category;
    if (cat && !filters.categories.includes(cat)) return false;
  }

  if (filters.attributes?.length) {
    const attrs = product.metadata?.attributes as
      | Array<{ name?: string; value?: string }>
      | undefined;
    for (const f of filters.attributes) {
      const hits = attrs?.filter(
        (a) => a.name?.toLowerCase() === f.name.toLowerCase(),
      );
      if (!hits?.length) continue;
      const wanted = f.values.map((v) => v.toLowerCase());
      const val = String(hits[0]?.value ?? "").toLowerCase();
      if (!wanted.some((w) => val.includes(w))) return false;
    }
  }

  return true;
}

function summaryToDetail(summary: CatalogProductSummary): CatalogProductDetail {
  return {
    id: summary.id,
    title: summary.title,
    url: `https://example.com/products/${summary.id}`,
    brand: summary.seller?.name,
    options: summary.options?.map((o) => ({
      name: o.name,
      values: o.values.map((v) => ({ label: v.label, available: true, exists: true })),
    })),
    variants: summary.variants?.map((v) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      checkout_url: v.checkout_url,
      availability: v.availability,
      options: v.options,
      media: v.media,
    })),
    media: summary.media,
    metadata: summary.metadata,
    seller: summary.seller,
  };
}

function applyMutations(
  detail: CatalogProductDetail,
  mutations: FakeUcpMutation[],
  getProductCalls: number,
): CatalogProductDetail | null {
  for (const m of mutations) {
    if (m.productId !== detail.id) continue;
    if (m.kind === "not_found") {
      const after = m.afterStep ?? 0;
      if (getProductCalls > after) return null;
    }
    if (m.kind === "price_drift") {
      const v = detail.variants?.[0];
      if (v?.price) v.price = { ...v.price, amount: m.amount };
    }
    if (m.kind === "variant_unavailable") {
      for (const v of detail.variants ?? []) {
        if (!m.variantId || v.id === m.variantId) {
          v.availability = { available: false, status: "out_of_stock" };
          v.checkout_url = undefined;
        }
      }
    }
    if (m.kind === "checkout_missing") {
      for (const v of detail.variants ?? []) {
        v.checkout_url = undefined;
      }
    }
  }
  return detail;
}

function selectVariant(
  detail: CatalogProductDetail,
  selected?: SelectedOption[],
): CatalogProductDetail {
  if (!selected?.length || !detail.variants?.length) {
    return { ...detail, selected };
  }
  const labels = selected.map((s) => s.label.toLowerCase());
  const match =
    detail.variants.find((v) =>
      (v.options ?? []).every((o) => labels.includes(o.label.toLowerCase())),
    ) ?? detail.variants[0];
  return {
    ...detail,
    selected,
    variants: detail.variants.map((v) =>
      v.id === match?.id
        ? v
        : { ...v, availability: { available: false, status: "out_of_stock" } },
    ),
  };
}

export function createFakeUcpClient(runtime: FakeUcpRuntime) {
  const { catalog } = runtime;

  async function fakeSearchCatalog(
    _accessToken: string,
    _query: string,
    filters?: CatalogSearchFilters,
    options?: { limit?: number },
  ): Promise<CatalogSearchResult> {
    const limit = options?.limit ?? 50;
    const priceMode = catalog.priceFilterMode ?? "honor";

    const relevantFiltered = catalog.relevant.filter((p) =>
      productMatchesFilters(p, filters, priceMode),
    );
    const ordered: CatalogProductSummary[] = [];
    for (const p of relevantFiltered) {
      if (!ordered.some((x) => x.id === p.id)) ordered.push(p);
    }
    if (ordered.length < limit) {
      for (const p of catalog.noise ?? []) {
        if (ordered.length >= limit) break;
        if (ordered.some((x) => x.id === p.id)) continue;
        ordered.push(p);
      }
    }

    return {
      products: ordered.slice(0, limit),
      pagination: {
        has_next_page: ordered.length > limit,
        total_count: ordered.length,
      },
    };
  }

  async function fakeGetProduct(
    _accessToken: string,
    productId: string,
    selected?: SelectedOption[],
  ): Promise<GetProductResult> {
    runtime.getProductCalls += 1;
    const summary =
      catalog.relevant.find((p) => p.id === productId) ??
      catalog.noise?.find((p) => p.id === productId);
    if (!summary) return {};

    let detail = catalog.details?.[productId] ?? summaryToDetail(summary);
    detail = applyMutations(detail, catalog.mutations ?? [], runtime.getProductCalls);
    if (!detail) return {};
    return { product: selectVariant(detail, selected) };
  }

  return {
    searchCatalog: fakeSearchCatalog,
    getProduct: fakeGetProduct,
  };
}

export function shopDepartmentRowsFromSeed(
  seed: Record<string, "mens" | "womens" | "mixed" | "unknown">,
): import("@/lib/fashion-memory/shop-departments").ShopDepartmentRow[] {
  const rows: import("@/lib/fashion-memory/shop-departments").ShopDepartmentRow[] = [];
  for (const [name, dept] of Object.entries(seed)) {
    if (dept === "unknown") continue;
    const domain = `${name.toLowerCase().replace(/\s+/g, "")}.example`;
    rows.push({
      shop_gid: `domain:${domain}`,
      shop_domain: domain,
      department: dept === "kids" ? "kids" : dept,
      confidence: "manual",
      source_note: "e2e seed",
    });
  }
  return rows;
}

export function attachShopDomains(
  products: CatalogProductSummary[],
  shopName: string,
): CatalogProductSummary[] {
  const domain = `${shopName.toLowerCase().replace(/\s+/g, "")}.example`;
  return products.map((p) => ({
    ...p,
    seller: { name: shopName, domain },
    shop_domain: domain,
  }));
}
