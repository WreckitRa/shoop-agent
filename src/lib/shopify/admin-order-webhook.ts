/**
 * Shopify Admin REST order webhooks (`orders/create`, `orders/updated`, etc.) ship the
 * Order resource JSON. Use {@link summarizeShopifyAdminOrderWebhook} to project the
 * payload to a stable, fully-typed summary for downstream consumers.
 * @see https://shopify.dev/docs/api/admin-rest/latest/resources/order
 */

export type ShopifyAdminWebhookOrderSummary = {
  source: "shopify_admin_webhook";
  /** Numeric id from Shopify (may exceed safe JS integer — see `idString`). */
  id: number | null;
  idString: string | null;
  name: string | null;
  orderNumber: number | null;
  email: string | null;
  currency: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  totalPrice: string | null;
  subtotalPrice: string | null;
  totalTax: string | null;
  taxesIncluded: boolean | null;
  orderStatusUrl: string | null;
  customerLocale: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  customerId: number | null;
  lineItems: Array<{
    title: string;
    quantity: number;
    sku: string | null;
    price: string | null;
    vendor: string | null;
    fulfillmentStatus: string | null;
  }>;
  fulfillments: Array<{
    status: string | null;
    createdAt: string | null;
    trackingCompany: string | null;
    trackingNumbers: string[];
  }>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function pickString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

function pickNumber(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickBool(o: Record<string, unknown>, key: string): boolean | null {
  const v = o[key];
  if (typeof v === "boolean") return v;
  return null;
}

/** Prefer string id for very large Shopify IDs that JSON may coerce imprecisely. */
function pickOrderIdString(o: Record<string, unknown>): string | null {
  const raw = o.id;
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  return null;
}

function summarizeLineItems(raw: unknown): ShopifyAdminWebhookOrderSummary["lineItems"] {
  if (!Array.isArray(raw)) return [];
  const out: ShopifyAdminWebhookOrderSummary["lineItems"] = [];
  for (const li of raw) {
    const o = asRecord(li);
    if (!o) continue;
    const title = pickString(o, "title") ?? pickString(o, "name") ?? "Item";
    const qty = pickNumber(o, "quantity") ?? 0;
    out.push({
      title,
      quantity: qty,
      sku: pickString(o, "sku"),
      price: pickString(o, "price"),
      vendor: pickString(o, "vendor"),
      fulfillmentStatus: pickString(o, "fulfillment_status"),
    });
  }
  return out;
}

function summarizeFulfillments(raw: unknown): ShopifyAdminWebhookOrderSummary["fulfillments"] {
  if (!Array.isArray(raw)) return [];
  const out: ShopifyAdminWebhookOrderSummary["fulfillments"] = [];
  for (const f of raw) {
    const o = asRecord(f);
    if (!o) continue;
    let trackingNumbers: string[] = [];
    const tn = o.tracking_numbers;
    if (Array.isArray(tn)) {
      trackingNumbers = tn.filter((x): x is string => typeof x === "string" && x.length > 0);
    } else {
      const single = pickString(o, "tracking_number");
      if (single) trackingNumbers = [single];
    }
    out.push({
      status: pickString(o, "status"),
      createdAt: pickString(o, "created_at"),
      trackingCompany: pickString(o, "tracking_company"),
      trackingNumbers,
    });
  }
  return out;
}

/**
 * Build a stable log/summary object from a webhook JSON body (root should be the Order resource).
 * Unknown shapes return a minimal summary with empty line items rather than throwing.
 */
export function summarizeShopifyAdminOrderWebhook(payload: unknown): ShopifyAdminWebhookOrderSummary {
  const o = asRecord(payload);
  if (!o) {
    return {
      source: "shopify_admin_webhook",
      id: null,
      idString: null,
      name: null,
      orderNumber: null,
      email: null,
      currency: "USD",
      financialStatus: null,
      fulfillmentStatus: null,
      totalPrice: null,
      subtotalPrice: null,
      totalTax: null,
      taxesIncluded: null,
      orderStatusUrl: null,
      customerLocale: null,
      createdAt: null,
      updatedAt: null,
      customerId: null,
      lineItems: [],
      fulfillments: [],
    };
  }

  const idString = pickOrderIdString(o);
  const idNum = pickNumber(o, "id");

  const customer = asRecord(o.customer);
  const customerId = customer ? pickNumber(customer, "id") : null;
  const email = pickString(o, "email") ?? (customer ? pickString(customer, "email") : null);

  return {
    source: "shopify_admin_webhook",
    id: idNum,
    idString,
    name: pickString(o, "name"),
    orderNumber: pickNumber(o, "order_number"),
    email,
    currency: pickString(o, "currency") ?? "USD",
    financialStatus: pickString(o, "financial_status"),
    fulfillmentStatus: pickString(o, "fulfillment_status"),
    totalPrice: pickString(o, "total_price"),
    subtotalPrice: pickString(o, "subtotal_price"),
    totalTax: pickString(o, "total_tax"),
    taxesIncluded: pickBool(o, "taxes_included"),
    orderStatusUrl: pickString(o, "order_status_url"),
    customerLocale: pickString(o, "customer_locale"),
    createdAt: pickString(o, "created_at"),
    updatedAt: pickString(o, "updated_at"),
    customerId,
    lineItems: summarizeLineItems(o.line_items),
    fulfillments: summarizeFulfillments(o.fulfillments),
  };
}
